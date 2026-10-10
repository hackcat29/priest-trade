/**
 * CandleEngine — Single-writer candle service for Perpes.fun
 *
 * Responsibilities:
 *   1. Subscribe to Redis price_update and trade events from all markets.
 *   2. Maintain an in-memory OHLCV accumulator per (mint, resolution) for all 6
 *      resolutions: 1m, 5m, 15m, 1h, 4h, 1d.
 *   3. On bucket boundary: flush the closed bar to PostgreSQL and publish a
 *      candle_update to Redis so the API's WebSocket bridge can forward it.
 *   4. Every LIVE_TICK_MS: publish the current (open) bar from the in-memory
 *      accumulator to Redis — no DB write, <1ms latency to the frontend.
 *   5. On startup: seed accumulators from the last known candle for each
 *      active market and resolution so live bars pick up mid-bucket.
 *
 * This replaces the race-prone dual-writer pattern where both the indexer and
 * the keeper wrote to the candles table concurrently. With a single writer:
 *   - high/low accumulation is correct (no read-modify-write races).
 *   - volume from trade events and price continuity from keeper ticks are merged
 *     in memory before hitting the DB.
 *   - live bar updates are published every second without a DB round-trip.
 *
 * Inputs (Redis psubscribe):
 *   market:*:price_update  — from keeper PriceEngine.persistPriceState()
 *   market:*:trade         — from indexer insertTrade() (primary markets)
 *
 * Outputs:
 *   PostgreSQL candles table — one upsert per bucket close per resolution
 *   Redis market:{mint}:candle_update — live bar every LIVE_TICK_MS + on close
 */

import type { Pool } from 'pg';
import type Redis from 'ioredis';

import {
  createHealthServer,
  createLogger,
  createPgPool,
  createRedisClient,
  publishJson,
  queryRows,
  redisChannels,
  requireEnv,
} from '@perpes/offchain';

const SERVICE_NAME = '@perpes/candle-engine';
const logger = createLogger(SERVICE_NAME);

const DATABASE_URL  = requireEnv('DATABASE_URL');
const REDIS_URL     = requireEnv('REDIS_URL');
const PORT          = Number.parseInt(process.env['CANDLE_ENGINE_PORT'] ?? '3005', 10);
const LIVE_TICK_MS  = Number.parseInt(process.env['CANDLE_LIVE_TICK_MS'] ?? '1000', 10);
const FLUSH_LAG_MS  = Number.parseInt(process.env['CANDLE_FLUSH_LAG_MS'] ?? '5000', 10);

// ── Resolution table ────────────────────────────────────────────────────────

// '1s' gives new launches a pump.fun-style tick chart. Those bars are pruned
// after ONE_SECOND_RETENTION so the candles table doesn't grow 86k rows per
// market per day.
const RESOLUTIONS = ['1s', '1m', '5m', '15m', '1h', '4h', '1d'] as const;
type Resolution = typeof RESOLUTIONS[number];
const ONE_SECOND_RETENTION = '6 hours';
const PRUNE_EVERY_MS = 10 * 60_000;

const RESOLUTION_MS: Record<Resolution, number> = {
  '1s':  1_000,
  '1m':  60_000,
  '5m':  300_000,
  '15m': 900_000,
  '1h':  3_600_000,
  '4h':  14_400_000,
  '1d':  86_400_000,
};

// ── Bar state ───────────────────────────────────────────────────────────────

interface BarState {
  bucketTs: number;
  open:     number;
  high:     number;
  low:      number;
  close:    number;
  volume:   number;
  oi:       number;
  dirty:    boolean;
}

// ── CandleEngine ────────────────────────────────────────────────────────────

class CandleEngine {
  // accum.get(mint)?.get(resolution) = current open bar
  private readonly accum = new Map<string, Map<Resolution, BarState>>();

  // Buckets that have been closed and need to be flushed to DB.
  // Keyed by `${mint}:${resolution}:${bucketTs}` to deduplicate.
  private readonly flushQueue = new Map<string, { mint: string; resolution: Resolution; bar: BarState }>();

  private liveTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly pub: Redis,
    private readonly sub: Redis,
  ) {}

  async start(): Promise<void> {
    await this.seedFromDb();

    // Pattern-subscribe to price updates and raw trade events
    await this.sub.psubscribe(
      'market:*:price_update',
      'market:*:trade',
    );

    this.sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const mint = this.mintFromChannel(channel);
      if (!mint) return;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(message) as Record<string, unknown>;
      } catch {
        return;
      }

      if (channel.endsWith(':price_update')) {
        this.onPrice(mint, payload);
      } else if (channel.endsWith(':trade')) {
        this.onTrade(mint, payload);
      }
    });

    // Publish live bar updates every LIVE_TICK_MS
    this.liveTimer = setInterval(() => {
      void this.publishLiveBars();
    }, LIVE_TICK_MS);

    // Flush closed bars to DB every FLUSH_LAG_MS
    this.flushTimer = setInterval(() => {
      void this.drainFlushQueue();
    }, FLUSH_LAG_MS);

    this.pruneTimer = setInterval(() => {
      void queryRows(this.pool, `DELETE FROM candles WHERE resolution = '1s' AND ts < NOW() - INTERVAL '${ONE_SECOND_RETENTION}'`)
        .catch((err: unknown) => logger.warn('1s candle prune failed', { err: String(err) }));
    }, PRUNE_EVERY_MS);

    logger.info('CandleEngine started', {
      liveTickMs: LIVE_TICK_MS,
      flushLagMs: FLUSH_LAG_MS,
    });
  }

  async stop(): Promise<void> {
    if (this.liveTimer)  clearInterval(this.liveTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    await this.sub.punsubscribe();
    await this.drainFlushQueue();
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  private onPrice(mint: string, payload: Record<string, unknown>): void {
    const price = this.toNumber(payload['markPrice'] ?? payload['mark_price']);
    const oi    = this.toNumber(payload['totalOi'] ?? 0);
    if (price <= 0) return;
    this.update(mint, price, 0, oi, Date.now());
  }

  private onTrade(mint: string, payload: Record<string, unknown>): void {
    const price  = this.toNumber(payload['executionPrice'] ?? payload['execution_price'] ?? payload['price']);
    const volume = this.toNumber(payload['notional'] ?? 0);
    const oi     = this.toNumber(payload['oi'] ?? 0);
    if (price <= 0) return;
    // Use trade timestamp when available for accurate bucket placement
    const ts = payload['timestamp']
      ? Date.parse(String(payload['timestamp']))
      : Date.now();
    const nowMs = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
    this.update(mint, price, volume, oi, nowMs);
  }

  // ── Core accumulation ───────────────────────────────────────────────────

  private update(mint: string, price: number, volume: number, oi: number, nowMs: number): void {
    if (!this.accum.has(mint)) {
      this.accum.set(mint, new Map());
    }
    const mintBars = this.accum.get(mint)!;

    for (const resolution of RESOLUTIONS) {
      const bucketMs = RESOLUTION_MS[resolution];
      const bucketTs = Math.floor(nowMs / bucketMs) * bucketMs;

      const existing = mintBars.get(resolution);

      if (!existing) {
        mintBars.set(resolution, {
          bucketTs, open: price, high: price, low: price,
          close: price, volume, oi, dirty: true,
        });
        continue;
      }

      if (bucketTs > existing.bucketTs) {
        // Bucket closed — queue the completed bar for DB flush
        this.enqueueFlush(mint, resolution, { ...existing });

        // Publish the closed bar immediately so the frontend closes the candle
        void this.publishBar(mint, resolution, { ...existing }, false);

        // Open next bar — open = previous close for continuity
        mintBars.set(resolution, {
          bucketTs,
          open:   existing.close,
          high:   Math.max(existing.close, price),
          low:    Math.min(existing.close, price),
          close:  price,
          volume,
          oi,
          dirty:  true,
        });
      } else {
        existing.high    = Math.max(existing.high, price);
        existing.low     = Math.min(existing.low,  price);
        existing.close   = price;
        existing.volume += volume;
        existing.oi      = oi > 0 ? oi : existing.oi;
        existing.dirty   = true;
      }
    }
  }

  // ── Live publish ─────────────────────────────────────────────────────────

  private async publishLiveBars(): Promise<void> {
    const publishes: Promise<void>[] = [];
    for (const [mint, mintBars] of this.accum) {
      for (const [resolution, bar] of mintBars) {
        if (!bar.dirty) continue;
        bar.dirty = false;
        publishes.push(this.publishBar(mint, resolution as Resolution, bar, true));
      }
    }
    await Promise.allSettled(publishes);
  }

  private async publishBar(
    mint: string,
    resolution: Resolution,
    bar: BarState,
    isLive: boolean,
  ): Promise<void> {
    await publishJson(this.pub, redisChannels.marketCandle(mint), {
      mint,
      resolution,
      time:   new Date(bar.bucketTs).toISOString(),
      open:   bar.open,
      high:   bar.high,
      low:    bar.low,
      close:  bar.close,
      volume: bar.volume,
      oi:     bar.oi,
      live:   isLive,
    });
  }

  // ── DB flush ─────────────────────────────────────────────────────────────

  private enqueueFlush(mint: string, resolution: Resolution, bar: BarState): void {
    const key = `${mint}:${resolution}:${bar.bucketTs}`;
    this.flushQueue.set(key, { mint, resolution, bar });
  }

  private async drainFlushQueue(): Promise<void> {
    if (this.flushQueue.size === 0) return;

    const batch = [...this.flushQueue.values()];
    this.flushQueue.clear();

    // Batch into groups of 50 to avoid enormous multi-row queries
    for (let i = 0; i < batch.length; i += 50) {
      const chunk = batch.slice(i, i + 50);
      await Promise.allSettled(chunk.map(({ mint, resolution, bar }) =>
        this.upsertCandle(mint, resolution, bar),
      ));
    }
  }

  private async upsertCandle(mint: string, resolution: Resolution, bar: BarState): Promise<void> {
    const ts = new Date(bar.bucketTs).toISOString();
    try {
      await queryRows(
        this.pool,
        `INSERT INTO candles (market, resolution, ts, open, high, low, close, volume, oi)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (market, resolution, ts) DO UPDATE SET
           high   = GREATEST(candles.high,  EXCLUDED.high),
           low    = LEAST(candles.low,       EXCLUDED.low),
           close  = EXCLUDED.close,
           volume = GREATEST(candles.volume, EXCLUDED.volume),
           oi     = EXCLUDED.oi`,
        [mint, resolution, ts, bar.open, bar.high, bar.low, bar.close, bar.volume, bar.oi],
      );
    } catch (err) {
      logger.error('upsertCandle failed', { mint, resolution, ts, err: String(err) });
    }
  }

  // ── Startup seed ──────────────────────────────────────────────────────────

  private async seedFromDb(): Promise<void> {
    let rows: Array<{ mint: string; resolution: string; ts: Date; open: string; high: string; low: string; close: string; volume: string; oi: string }>;
    try {
      rows = await queryRows(
        this.pool,
        `SELECT DISTINCT ON (market, resolution)
           market AS mint, resolution, ts,
           open, high, low, close, volume, oi
         FROM candles
         WHERE market IN (
           SELECT mint FROM markets WHERE status IN ('Active', 'Warmup')
         )
         ORDER BY market, resolution, ts DESC`,
      );
    } catch (err) {
      logger.warn('seedFromDb failed — starting with empty accumulators', { err: String(err) });
      return;
    }

    for (const row of rows) {
      const resolution = row.resolution as Resolution;
      if (!RESOLUTIONS.includes(resolution)) continue;

      const bucketMs = RESOLUTION_MS[resolution];
      const rowTs    = new Date(row.ts).getTime();
      const nowMs    = Date.now();
      const nowBucket = Math.floor(nowMs / bucketMs) * bucketMs;

      if (!this.accum.has(row.mint)) {
        this.accum.set(row.mint, new Map());
      }
      const mintBars = this.accum.get(row.mint)!;

      if (rowTs === nowBucket) {
        // We are still in the same bucket — resume accumulation from the DB values
        mintBars.set(resolution, {
          bucketTs: rowTs,
          open:   parseFloat(row.open),
          high:   parseFloat(row.high),
          low:    parseFloat(row.low),
          close:  parseFloat(row.close),
          volume: parseFloat(row.volume),
          oi:     parseFloat(row.oi),
          dirty:  false,
        });
      } else {
        // The DB row is from a previous bucket — open a new bar at the last close price
        const close = parseFloat(row.close);
        mintBars.set(resolution, {
          bucketTs: nowBucket,
          open: close, high: close, low: close, close, volume: 0, oi: parseFloat(row.oi),
          dirty: false,
        });
      }
    }

    logger.info('Seeded accumulators from DB', {
      markets: this.accum.size,
      bars:    rows.length,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private mintFromChannel(channel: string): string | null {
    // channel = "market:{mint}:{event}"
    const parts = channel.split(':');
    return parts.length >= 3 ? (parts[1] ?? null) : null;
  }

  private toNumber(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

const pool = createPgPool(DATABASE_URL, SERVICE_NAME);
const pub  = createRedisClient(REDIS_URL, `${SERVICE_NAME}:pub`);
const sub  = createRedisClient(REDIS_URL, `${SERVICE_NAME}:sub`);

const engine = new CandleEngine(pool, pub, sub);

createHealthServer({
  port: PORT,
  serviceName: SERVICE_NAME,
  getReadiness: async () => (await pub.ping()) === 'PONG',
});

// Backstop against unguarded RPC/network calls anywhere below — an uncaught
// error is otherwise fatal, and nothing here supervises the process back to
// life if `tsx watch` doesn't respawn the crashed child (observed in
// keeper/indexer: the container stays "Up" while the app inside goes
// silently dark indefinitely).
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — candle engine continues running', {
    err: err instanceof Error ? (err.stack ?? err.message) : String(err),
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection — candle engine continues running', {
    reason: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  });
});

void engine.start().catch(async (err: unknown) => {
  logger.error('CandleEngine fatal error', { err: String(err) });
  await engine.stop();
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void engine.stop().finally(() => process.exit(0));
  });
}
