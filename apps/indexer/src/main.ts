/**
 * EVM indexer — mirrors a PerpesEngine deployment (Monad) into the same
 * Postgres tables and Redis channels for Monad block events and market state.
 *
 * Differences from apps/indexer:
 *   - Pulls logs by block range (eth_getLogs) from a block cursor in
 *     service_cursors, instead of a signature subscription.
 *   - Positions are mirrored from the engine's `PositionState` event, which
 *     carries the full post-change state, so partial closes, funding and
 *     collateral changes are exact without re-deriving them.
 *   - Addresses are lowercased; markets.chain / launches.chain carry the chain key.
 *   - Every log is idempotent via processed_transactions ("<chain>:<tx>:<logIndex>").
 */
import { createPublicClient, decodeEventLog, encodeAbiParameters, erc20Abi, http, keccak256, type Address, type Log } from 'viem';

import {
  createHealthServer,
  createLogger,
  createPgPool,
  createRedisClient,
  decimalString,
  execute,
  publishJson,
  queryRows,
  redisChannels,
  requireEnv,
} from '@perpes/offchain';
import {
  EVM_CHAINS,
  evmRpcUrl,
  MarketStatus,
  OrderStatus,
  fromE6,
  getEvmDeployment,
  isEvmChainKey,
  orderTypeName,
  perpesEngineAbi,
  sideName,
  type EvmChainKey,
} from '@perpes/evm';

const SERVICE_NAME = '@perpes/evm-indexer';
const logger = createLogger(SERVICE_NAME);

const CHAIN_RAW = requireEnv('EVM_CHAIN');
if (!isEvmChainKey(CHAIN_RAW)) throw new Error(`EVM_CHAIN must be monad-testnet or monad, got ${CHAIN_RAW}`);
const CHAIN: EvmChainKey = CHAIN_RAW;
const deployment = getEvmDeployment(CHAIN, {
  ...(process.env['EVM_ENGINE_ADDRESS'] ? { engine: process.env['EVM_ENGINE_ADDRESS'] as Address } : {}),
  ...(process.env['EVM_USDC_ADDRESS'] ? { usdc: process.env['EVM_USDC_ADDRESS'] as Address } : {}),
  ...(process.env['EVM_DEPLOY_BLOCK'] ? { deployBlock: Number(process.env['EVM_DEPLOY_BLOCK']) } : {}),
});
if (!deployment) throw new Error(`No PerpesEngine deployment for ${CHAIN}; set EVM_ENGINE_ADDRESS`);
const ENGINE = deployment.engine;

const RPC_URL = evmRpcUrl(CHAIN, { rpcUrl: process.env['EVM_RPC_URL'], alchemyApiKey: process.env['ALCHEMY_API_KEY'] });
const PORT = Number.parseInt(process.env['EVM_INDEXER_PORT'] ?? '3021', 10);
const POLL_MS = Number.parseInt(process.env['EVM_INDEXER_POLL_MS'] ?? '1000', 10);
// Public Monad RPCs cap eth_getLogs ranges; 100 blocks ≈ 40s of chain time.
const MAX_RANGE = BigInt(process.env['EVM_INDEXER_MAX_BLOCK_RANGE'] ?? '100');
const SYNC_MS = Number.parseInt(process.env['EVM_INDEXER_SYNC_MS'] ?? '10000', 10);
const DATABASE_URL = requireEnv('DATABASE_URL');
const REDIS_URL = requireEnv('REDIS_URL');
const CURSOR_KEY = `evm-indexer:${CHAIN}:${ENGINE}`;
const LAUNCH_BONUS_POINTS = 500;

const client = createPublicClient({ chain: EVM_CHAINS[CHAIN], transport: http(RPC_URL, { retryCount: 3, timeout: 20_000 }) });
const pool = createPgPool(DATABASE_URL, SERVICE_NAME);
const redis = createRedisClient(REDIS_URL, `${SERVICE_NAME}:redis`);

type Args = Record<string, unknown>;
const lc = (v: unknown): string => String(v ?? '').toLowerCase();
const big = (v: unknown): bigint => (typeof v === 'bigint' ? v : BigInt(String(v ?? 0)));
const usd = (v: unknown): string => decimalString(fromE6(big(v)));
const iso = (v: unknown): string => new Date(Number(big(v)) * 1000).toISOString();

let lastBlock = 0n;
let eventsTotal = 0;
let eventsFailed = 0;
/** Close label set by PositionTriggerExecuted, consumed by the PositionState that follows in the same tx. */
const pendingCloseLabel = new Map<string, string>();

// ── Cursor ─────────────────────────────────────────────────────────────────────

async function readCursor(): Promise<bigint> {
  const rows = await queryRows<{ cursor_value: string }>(
    pool,
    `SELECT cursor_value FROM service_cursors WHERE service_name = $1`,
    [CURSOR_KEY],
  );
  if (rows[0]) return BigInt(rows[0].cursor_value);
  return BigInt(Math.max(0, deployment!.deployBlock - 1));
}

async function writeCursor(block: bigint): Promise<void> {
  await execute(
    pool,
    `INSERT INTO service_cursors (service_name, cursor_type, cursor_value, updated_at)
     VALUES ($1, 'block', $2, NOW())
     ON CONFLICT (service_name) DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = NOW()`,
    [CURSOR_KEY, block.toString()],
  );
}

// ── Log loop ───────────────────────────────────────────────────────────────────

// Providers cap eth_getLogs differently (Alchemy's free tier: 10 blocks), so a
// range the RPC rejects is halved until it's accepted, and stays that size.
let logRange = MAX_RANGE;

async function getLogsInRange(from: bigint, head: bigint): Promise<{ to: bigint; logs: Log[] }> {
  for (;;) {
    const to = from + logRange - 1n < head ? from + logRange - 1n : head;
    try {
      return { to, logs: await client.getLogs({ address: ENGINE, fromBlock: from, toBlock: to }) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (logRange <= 1n || !/block range|range (is )?too|limited to|too many (blocks|results|logs)|query returned more than/i.test(message)) {
        throw err;
      }
      logRange /= 2n;
      logger.warn('eth_getLogs range rejected; narrowing', { range: logRange.toString() });
    }
  }
}

async function pollOnce(): Promise<void> {
  const head = await client.getBlockNumber();
  let from = (await readCursor()) + 1n;
  while (from <= head) {
    const { to, logs } = await getLogsInRange(from, head);
    logs.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || (a.logIndex! - b.logIndex!));
    for (const log of logs) {
      await processLog(log);
    }
    await writeCursor(to);
    lastBlock = to;
    from = to + 1n;
  }
}

async function processLog(log: Log): Promise<void> {
  const id = `${CHAIN}:${log.transactionHash}:${log.logIndex}`;
  const seen = await queryRows(pool, `SELECT 1 FROM processed_transactions WHERE tx_signature = $1`, [id]);
  if (seen.length > 0) return;

  let decoded: { eventName: string; args: Args };
  try {
    decoded = decodeEventLog({ abi: perpesEngineAbi, data: log.data, topics: log.topics }) as unknown as {
      eventName: string;
      args: Args;
    };
  } catch {
    return; // proxy admin events (Upgraded, OwnershipTransferred, ...) aren't ours to mirror
  }

  try {
    await handle(decoded.eventName, decoded.args, id, log.transactionHash ?? id);
    eventsTotal += 1;
    await execute(
      pool,
      `INSERT INTO processed_transactions (tx_signature, program_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, `evm:${CHAIN}`],
    );
  } catch (err) {
    eventsFailed += 1;
    logger.error('event handler failed', { event: decoded.eventName, id, err: err instanceof Error ? err.stack : String(err) });
    throw err; // stop the range so the cursor doesn't skip it; the next poll retries
  }
}

async function handle(name: string, a: Args, id: string, txHash: string): Promise<void> {
  switch (name) {
    case 'TokenLaunched':
      return onTokenLaunched(a, txHash);
    case 'MarketInitialized':
      return onMarketInitialized(a);
    case 'MarketPriceUpdated':
      return onMarketPrice(a);
    case 'MarketDelisted':
      await execute(pool, `UPDATE markets SET status = 'Delisted', updated_at = NOW() WHERE mint = $1`, [lc(a['market'])]);
      return;
    case 'PositionOpened':
      return onPositionOpened(a, id);
    case 'PositionClosed':
      return onPositionClosed(a, id);
    case 'PositionLiquidated':
      return onPositionLiquidated(a, txHash);
    case 'PositionState':
      return onPositionState(a);
    case 'PositionTriggerExecuted':
      return onTriggerExecuted(a, txHash);
    case 'TradingFeeAccrued':
      return onTradingFee(a, id);
    case 'PayoutHaircut':
      return onPayoutHaircut(a, id);
    case 'PayoutDeferred':
      return settlementEvent(id, 'payout_deferred', a, 'deferredUsdc', 'totalUnsettledUsdc');
    case 'UnsettledProfitClaimed':
      return settlementEvent(id, 'unsettled_claimed', a, 'amountUsdc', 'remainingUsdc');
    case 'BadDebtRecorded':
      await execute(pool, `UPDATE markets SET bad_debt_usdc = $2, updated_at = NOW() WHERE mint = $1`, [
        lc(a['market']),
        usd(a['totalBadDebtUsdc']),
      ]);
      return;
    case 'LimitOrderPlaced':
      return onOrderPlaced(a, txHash);
    case 'LimitOrderCancelled':
      await execute(
        pool,
        `UPDATE limit_orders SET status = 'Cancelled', cancelled_at = $2
          WHERE order_pda = $1 AND status IN ('Open','PartiallyFilled')`,
        [orderKey(a['orderId']), iso(a['timestamp'])],
      );
      return;
    case 'LimitOrderExecuted':
      return onOrderExecuted(a);
    case 'GraduationApproved':
      return onGraduationApproved(a);
    case 'GraduationRevoked':
      await execute(
        pool,
        `UPDATE migration_eligibility SET protocol_approved = FALSE, updated_at = $2 WHERE mint = $1`,
        [lc(a['market']), iso(a['timestamp'])],
      );
      return;
    case 'MarketGraduated':
      return onMarketGraduated(a, txHash);
    case 'SecondaryOracleUpdated':
      return onSecondaryOracle(a);
    case 'SecondaryLiquidityUpdated':
      return onSecondaryLiquidity(a);
    case 'MarketListed':
      return onMarketListed(a, txHash);
    case 'LpVaultCreated':
      await execute(pool, `UPDATE markets SET lp_vault = $2, updated_at = NOW() WHERE mint = $1`, [
        lc(a['market']),
        lc(a['vault']),
      ]);
      return;
    case 'LpFeeAccrued':
      // Idempotent per log (processed_transactions), so a running total is safe.
      await execute(pool, `UPDATE markets SET lp_fees_usdc = lp_fees_usdc + $2, updated_at = NOW() WHERE mint = $1`, [
        lc(a['market']),
        usd(a['lpCutUsdc']),
      ]);
      return;
    case 'CreatorLpShareSet':
      await execute(pool, `UPDATE markets SET creator_lp_bps = $2, updated_at = NOW() WHERE mint = $1`, [
        lc(a['market']),
        Number(a['bps']),
      ]);
      return;
    case 'CounterflowDrawn':
      await execute(pool, `UPDATE markets SET counterflow_drawn_usdc = $2, updated_at = NOW() WHERE mint = $1`, [
        lc(a['market']),
        usd(a['drawnTotal']),
      ]);
      return;
    case 'CounterflowSynced':
      await execute(pool, `UPDATE markets SET counterflow_drawn_usdc = $2, updated_at = NOW() WHERE mint = $1`, [
        lc(a['market']),
        usd(a['drawnTotal']),
      ]);
      return;
    default:
      return; // ConfigUpdated, PositionTriggersUpdated (covered by PositionState), fee claims, ...
  }
}

// ── Markets ────────────────────────────────────────────────────────────────────

async function onTokenLaunched(a: Args, txHash: string): Promise<void> {
  const mint = lc(a['token']);
  const creator = lc(a['creator']);
  const p = a['params'] as Record<string, unknown>;
  const ts = iso(a['timestamp']);
  const s = (k: string) => {
    const v = String(p[k] ?? '').trim();
    return v.length ? v : null;
  };
  const existing = await queryRows(pool, `SELECT 1 FROM launches WHERE mint = $1`, [mint]);

  await execute(
    pool,
    `INSERT INTO launches (mint, creator, name, symbol, uri, image_url, description, twitter, telegram, website,
                           cashback_enabled, risk_tier, status, launch_tx, created_at, chain)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Standard','Active',$12,$13,$14)
     ON CONFLICT (mint) DO UPDATE SET
       creator = EXCLUDED.creator, name = EXCLUDED.name, symbol = EXCLUDED.symbol, uri = EXCLUDED.uri,
       image_url = COALESCE(EXCLUDED.image_url, launches.image_url),
       description = COALESCE(EXCLUDED.description, launches.description),
       twitter = COALESCE(EXCLUDED.twitter, launches.twitter),
       telegram = COALESCE(EXCLUDED.telegram, launches.telegram),
       website = COALESCE(EXCLUDED.website, launches.website),
       cashback_enabled = EXCLUDED.cashback_enabled, status = 'Active',
       launch_tx = EXCLUDED.launch_tx, chain = EXCLUDED.chain`,
    [mint, creator, s('name'), s('symbol'), s('uri'), s('imageUrl'), s('description'), s('twitter'), s('telegram'),
     s('website'), Boolean(p['cashbackEnabled']), txHash, ts, CHAIN],
  );
  await execute(
    pool,
    `INSERT INTO markets (mint, market_pubkey, name, symbol, creator, status, category, execution_engine, risk_tier,
                          mark_price, reference_price, max_leverage, image_url, description, twitter, telegram, website,
                          created_at, updated_at, chain)
     VALUES ($1,$2,$3,$4,$5,'Active','Primary','vAMM','Standard',1,1,10,$6,$7,$8,$9,$10,$11,$11,$12)
     ON CONFLICT (mint) DO UPDATE SET
       name = EXCLUDED.name, symbol = EXCLUDED.symbol, creator = EXCLUDED.creator,
       image_url = COALESCE(EXCLUDED.image_url, markets.image_url),
       description = COALESCE(EXCLUDED.description, markets.description),
       twitter = COALESCE(EXCLUDED.twitter, markets.twitter),
       telegram = COALESCE(EXCLUDED.telegram, markets.telegram),
       website = COALESCE(EXCLUDED.website, markets.website),
       chain = EXCLUDED.chain, updated_at = NOW()`,
    [mint, mint, s('name'), s('symbol'), creator, s('imageUrl'), s('description'), s('twitter'), s('telegram'),
     s('website'), ts, CHAIN],
  );
  await execute(pool, `INSERT INTO market_price_state (mint) VALUES ($1) ON CONFLICT (mint) DO NOTHING`, [mint]);

  if (existing.length === 0) {
    await awardPoints(creator, 'launch_points', LAUNCH_BONUS_POINTS, 'market', mint, `Created market ${s('symbol') ?? mint}`);
    await socialEvent(mint, 'launch', creator, `${s('name')} launched`, `${s('symbol')} market is now live`, { txHash }, ts);
  }
  await syncMarket(mint);
  await publishJson(redis, redisChannels.discoveryNewLaunch, {
    mint, creator, name: s('name'), symbol: s('symbol'), signature: txHash, timestamp: ts, chain: CHAIN,
  });
}

// MarketInitialized is emitted before TokenLaunched in the same tx, so the row
// doesn't exist yet — onTokenLaunched syncs the market after creating it.
async function onMarketInitialized(_a: Args): Promise<void> {}

async function onMarketPrice(a: Args): Promise<void> {
  const mint = lc(a['market']);
  const index = fromE6(big(a['indexPriceE6']));
  const mark = fromE6(big(a['markPriceE6']));
  const longOi = fromE6(big(a['oiLongUsdc']));
  const shortOi = fromE6(big(a['oiShortUsdc']));
  const fundingBps = Number(big(a['fundingRateBps']));
  const premium = index > 0 ? ((mark - index) / index) * 10_000 : 0;
  const ts = iso(a['timestamp']);
  await writeMarketPrices(mint, index, mark, longOi, shortOi, fundingBps, premium, ts);
}

async function writeMarketPrices(
  mint: string,
  index: number,
  mark: number,
  longOi: number,
  shortOi: number,
  fundingBps: number,
  premium: number,
  ts: string,
): Promise<void> {
  const [indexS, markS, longS, shortS] = [index, mark, longOi, shortOi].map((v) => v.toFixed(6));
  const updated = await queryRows(
    pool,
    `UPDATE markets SET reference_price = $2, mark_price = $3, long_oi = $4, short_oi = $5, updated_at = NOW()
      WHERE mint = $1 RETURNING 1`,
    [mint, indexS, markS, longS, shortS],
  );
  // listMarket emits MarketPriceUpdated before MarketListed, so the row (and
  // the market_price_state FK it anchors) doesn't exist yet; onMarketListed
  // writes the opening price itself.
  if (updated.length === 0) return;
  await execute(
    pool,
    `INSERT INTO market_price_state (mint, index_price, funding_rate_bps, premium_twap_bps, oracle_last_updated_at,
                                     oracle_action, maturity_stage, spot_weight_bps, book_weight_bps, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'ok', 1, 10000, 0, $5)
     ON CONFLICT (mint) DO UPDATE SET
       index_price = EXCLUDED.index_price, funding_rate_bps = EXCLUDED.funding_rate_bps,
       premium_twap_bps = EXCLUDED.premium_twap_bps, oracle_last_updated_at = EXCLUDED.oracle_last_updated_at,
       updated_at = EXCLUDED.updated_at`,
    [mint, indexS, fundingBps.toFixed(6), premium.toFixed(6), ts],
  );
  await refreshOpenPositionMarks(mint, mark);
  await publishJson(redis, redisChannels.marketPrice(mint), {
    mint, market: mint, indexPrice: indexS, referencePrice: indexS, markPrice: markS,
    fundingRate: (fundingBps / 10_000).toFixed(8), premiumTwapBps: premium.toFixed(6), timestamp: ts,
  });
  await publishJson(redis, redisChannels.marketOi(mint), {
    mint, longOi: longS, shortOi: shortS, totalOi: (longOi + shortOi).toFixed(6),
  });
  const totalOi = longOi + shortOi;
  await publishJson(redis, redisChannels.marketFunding(mint), {
    market: mint, rate: fundingBps.toFixed(6), annualizedEstimate: (fundingBps * 8_760).toFixed(4),
    premium: premium.toFixed(4), premiumTwapBps: premium.toFixed(4), longOi: longS, shortOi: shortS,
    skew: (totalOi > 0 ? (longOi - shortOi) / totalOi : 0).toFixed(6), timestamp: ts, source: 'primary_vamm', sequence: 0,
  });
}

/** Mark-to-market every open position in the market (size = base, notional = cost basis). */
async function refreshOpenPositionMarks(mint: string, mark: number): Promise<void> {
  await execute(
    pool,
    `UPDATE positions
        SET mark_price = $2,
            unrealized_pnl = CASE WHEN side = 'Long' THEN size * $2::numeric - notional ELSE notional - size * $2::numeric END
      WHERE market = $1 AND status = 'open'`,
    [mint, mark.toFixed(6)],
  );
}

type MarketView = {
  status: number;
  maxLeverageX: number;
  maintenanceMarginBps: number;
  warmupMaxLeverageX: number;
  flatMaxLeverageX: number;
  warmupUntil: bigint;
  indexPriceE6: bigint;
  markPriceE6: bigint;
  oiLongUsdc: bigint;
  oiShortUsdc: bigint;
  collateralPoolUsdc: bigint;
  creatorFeeBps: number;
  creatorFeeBpsUnqualified: number;
  creatorFeeTierUnlocked: boolean;
  insuranceFeeBpsStatic: number;
  takerFeeBps: number;
  fundingVelocityBps: bigint;
  fundingRateCapBps: bigint;
  fundingOiFloorUsdc: bigint;
  badDebtUsdc: bigint;
  tickSizeE6: bigint;
  creatorLpBps: number;
};

/** Authoritative refresh from previewMarket (accrued to now). */
async function syncMarket(mint: string): Promise<void> {
  const m = (await client.readContract({
    address: ENGINE,
    abi: perpesEngineAbi,
    functionName: 'previewMarket',
    args: [mint as Address],
  })) as unknown as MarketView;
  const statusName = MarketStatus[m.status] ?? 'Active';
  let status = statusName === 'Delisted' ? 'Delisted' : statusName === 'Graduated' ? 'Graduated' : 'Active';
  if (status === 'Graduated') {
    // An oracle market keeps its on-chain status when delisted; it goes close-only.
    const s = await client.readContract({ address: ENGINE, abi: perpesEngineAbi, functionName: 'getSecondary', args: [mint as Address] })
      .catch(() => null);
    if (s?.closeOnly) status = 'Delisted';
    // Backing follows the market's vault cash (re-derived on each oracle sample).
    if (s) {
      await execute(pool, `UPDATE markets SET counterflow_backed = $2 WHERE mint = $1 AND counterflow_backed <> $2`, [
        mint,
        Boolean(s.backed),
      ]);
    }
    // The vault address comes from LpVaultCreated; read it too, so markets whose
    // vault was opened before this indexer understood the event still get it.
    const vault = await client.readContract({ address: ENGINE, abi: perpesEngineAbi, functionName: 'lpVault', args: [mint as Address] })
      .catch(() => null);
    if (vault && vault !== '0x0000000000000000000000000000000000000000') {
      await execute(pool, `UPDATE markets SET lp_vault = $2 WHERE mint = $1 AND lp_vault IS DISTINCT FROM $2`, [mint, lc(vault)]);
    }
  }
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const lev = nowSec < m.warmupUntil ? m.warmupMaxLeverageX : m.maxLeverageX;
  // Oracle markets split fees by the engine's LP config (LPs / creator / protocol, no insurance).
  const split = MarketStatus[m.status] === 'Graduated' ? await oracleFeeSplit() : null;
  const creatorBps = split ? split.creatorFeeBps : m.creatorFeeBps;
  await execute(
    pool,
    `UPDATE markets
        SET status = $2, max_leverage = $3, collateral_pool_usdc = $4, fee_bps = $5, tick_size = $6,
            creator_fee_bps = $7, creator_fee_bps_unqualified = $8, creator_fee_tier_unlocked = $9,
            insurance_fee_bps_static = $10, bad_debt_usdc = $11, creator_lp_bps = $12, updated_at = NOW()
      WHERE mint = $1`,
    [mint, status, lev, usd(m.collateralPoolUsdc), m.takerFeeBps, usd(m.tickSizeE6), creatorBps,
     split ? creatorBps : m.creatorFeeBpsUnqualified, split ? true : m.creatorFeeTierUnlocked,
     split ? 0 : m.insuranceFeeBpsStatic, usd(m.badDebtUsdc), Number(m.creatorLpBps ?? 0)],
  );
  const longOi = fromE6(m.oiLongUsdc);
  const shortOi = fromE6(m.oiShortUsdc);
  const index = fromE6(m.indexPriceE6);
  const mark = fromE6(m.markPriceE6);
  const denom = Math.max(longOi + shortOi, fromE6(m.fundingOiFloorUsdc), 1e-6);
  const skewBps = Math.max(-10_000, Math.min(10_000, Math.trunc(((longOi - shortOi) * 10_000) / denom)));
  const cap = Number(m.fundingRateCapBps);
  const fundingBps = Math.max(-cap, Math.min(cap, Math.trunc((skewBps * Number(m.fundingVelocityBps)) / 10_000)));
  const premium = index > 0 ? ((mark - index) / index) * 10_000 : 0;
  await writeMarketPrices(mint, index, mark, longOi, shortOi, fundingBps, premium, new Date().toISOString());
}

let feeSplitCache: { at: number; creatorFeeBps: number } | null = null;

/** The engine's oracle-market fee split, re-read at most once a minute. */
async function oracleFeeSplit(): Promise<{ creatorFeeBps: number } | null> {
  if (feeSplitCache && Date.now() - feeSplitCache.at < 60_000) return feeSplitCache;
  const c = await client.readContract({ address: ENGINE, abi: perpesEngineAbi, functionName: 'lpConfig' }).catch(() => null);
  if (!c || c.lpFeeBps + c.creatorFeeBps + c.protocolFeeBps !== 10_000) return null;
  feeSplitCache = { at: Date.now(), creatorFeeBps: c.creatorFeeBps };
  return feeSplitCache;
}

async function syncAllMarkets(): Promise<void> {
  const rows = await queryRows<{ mint: string }>(
    pool,
    `SELECT mint FROM markets WHERE chain = $1 AND status <> 'Delisted'`,
    [CHAIN],
  );
  for (const row of rows) {
    await syncMarket(row.mint).catch((err) => logger.warn('market sync failed', { mint: row.mint, err: String(err) }));
  }
}

// ── Graduation (Uniswap v4) ────────────────────────────────────────────────────
// Same tables and channels the Solana indexer writes for graduation, so the
// API, admin views and web treat both chains alike.

async function onGraduationApproved(a: Args): Promise<void> {
  const mint = lc(a['market']);
  const ts = iso(a['timestamp']);
  const adminOverride = Boolean(a['adminOverride']);
  const approvedBy = lc(a['approvedBy']);
  await execute(
    pool,
    `INSERT INTO migration_eligibility (mint, protocol_approved, admin_override, approved_by, approved_at, updated_at)
     VALUES ($1, TRUE, $2, $3, $4, $4)
     ON CONFLICT (mint) DO UPDATE SET protocol_approved = TRUE, admin_override = EXCLUDED.admin_override,
       approved_by = EXCLUDED.approved_by, approved_at = EXCLUDED.approved_at, updated_at = EXCLUDED.updated_at`,
    [mint, adminOverride, approvedBy, ts],
  );
  if (adminOverride) {
    await execute(pool, `UPDATE markets SET admin_override_graduated = TRUE, updated_at = NOW() WHERE mint = $1`, [mint]);
  }
  await publishJson(redis, redisChannels.discoveryGraduation, {
    mint, event: 'SecondaryMigrationApproved', approvedBy, adminOverride, timestamp: ts, chain: CHAIN,
  });
}

async function onMarketGraduated(a: Args, txHash: string): Promise<void> {
  const mint = lc(a['market']);
  const ts = iso(a['timestamp']);
  const poolId = String(a['poolId']).toLowerCase();
  const s = await client.readContract({ address: ENGINE, abi: perpesEngineAbi, functionName: 'getSecondary', args: [mint as Address] });
  await execute(
    pool,
    `UPDATE markets
        SET graduated = TRUE, category = 'Secondary', execution_engine = 'SecondaryAMM', status = 'Graduated',
            spot_pool_id = $2, spot_venue = 'uniswap-v4', spot_lp_token_id = $3, oracle_source = 'uniswap-v4-ema',
            counterflow_backed = $4, updated_at = NOW()
      WHERE mint = $1`,
    [mint, poolId, big(a['lpTokenId']).toString(), Boolean(s.backed)],
  );
  await execute(
    pool,
    `INSERT INTO secondary_market_state
       (mint, secondary_market_enabled, protocol_approved, migration_start_ts, raydium_twap_e6, spot_reference_price_e6,
        blended_reference_price_e6, virtual_liquidity_usdc, max_oi_usdc, lp_burn_confirmed, lp_burn_tx,
        lp_burn_confirmed_at, updated_at)
     VALUES ($1, TRUE, TRUE, $2, $3, $3, $3, $4, $5, TRUE, $6, $7, $7)
     ON CONFLICT (mint) DO UPDATE SET
       secondary_market_enabled = TRUE, protocol_approved = TRUE, migration_start_ts = EXCLUDED.migration_start_ts,
       raydium_twap_e6 = EXCLUDED.raydium_twap_e6, spot_reference_price_e6 = EXCLUDED.spot_reference_price_e6,
       blended_reference_price_e6 = EXCLUDED.blended_reference_price_e6,
       virtual_liquidity_usdc = EXCLUDED.virtual_liquidity_usdc, max_oi_usdc = EXCLUDED.max_oi_usdc,
       lp_burn_confirmed = TRUE, lp_burn_tx = EXCLUDED.lp_burn_tx, lp_burn_confirmed_at = EXCLUDED.lp_burn_confirmed_at,
       updated_at = EXCLUDED.updated_at`,
    [mint, big(a['timestamp']).toString(), big(a['priceE6']).toString(), s.skewScaleUsdc.toString(),
     s.maxOiUsdc.toString(), txHash, ts],
  );
  await execute(
    pool,
    `INSERT INTO migration_eligibility (mint, protocol_approved, graduated_at, updated_at) VALUES ($1, TRUE, $2, $2)
     ON CONFLICT (mint) DO UPDATE SET graduated_at = EXCLUDED.graduated_at, updated_at = EXCLUDED.updated_at`,
    [mint, ts],
  );
  const symbol = await marketSymbol(mint);
  const seedUsdc = fromE6(big(a['usdcInPool']));
  await socialEvent(mint, 'system', mint, `${symbol} graduated to Uniswap`,
    `Spot trading is live on a Uniswap v4 pool seeded with $${seedUsdc.toFixed(0)} of locked liquidity.`,
    { txHash, poolId, lpTokenId: big(a['lpTokenId']).toString() }, ts);
  const creator = await queryRows<{ creator: string }>(pool, `SELECT creator FROM markets WHERE mint = $1`, [mint]);
  if (creator[0]?.creator) {
    await notify(creator[0].creator, 'graduation', `${symbol} graduated`,
      `Your market now trades spot on Uniswap v4, and its perps price off the pool.`, `/trade/${mint}`,
      { market: mint, poolId, txHash }, `graduated:${mint}`);
  }
  await publishJson(redis, redisChannels.discoveryGraduation, {
    mint, event: 'SecondaryMarketActivated', secondaryActive: true, poolId, timestamp: ts, chain: CHAIN,
  });
  await publishJson(redis, redisChannels.secondaryMarket(mint), { event: 'activated', mint, poolId, timestamp: ts });
  await syncMarket(mint);
}

// ── Listing ────────────────────────────────────────────────────────────────────

/** A listed v4 pool's PoolId: keccak256(abi.encode(PoolKey)) with no hooks. */
function v4PoolId(token: string, quote: string, fee: number, tickSpacing: number): string {
  const [c0, c1] = token < quote ? [token, quote] : [quote, token];
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [c0 as Address, c1 as Address, fee, tickSpacing, '0x0000000000000000000000000000000000000000'],
    ),
  ).toLowerCase();
}

async function onMarketListed(a: Args, txHash: string): Promise<void> {
  const mint = lc(a['token'] ?? a['market']);
  const lister = lc(a['lister']);
  const ts = iso(a['timestamp']);
  // SourceKind: 0 = Uniswap v4, 1 = Uniswap v3, 2 = Kuru order book.
  const kind = Number(a['kind']);
  const v3 = kind === 1;
  const kuru = kind === 2;
  const read = async (fn: 'name' | 'symbol') =>
    String(await client.readContract({ address: mint as Address, abi: erc20Abi, functionName: fn }).catch(() => '')).slice(0, 64);
  const [name, symbol] = await Promise.all([read('name'), read('symbol')]);
  const oc = await client.readContract({ address: ENGINE, abi: perpesEngineAbi, functionName: 'oracleConfig' });
  const quote = Boolean(a['quoteIsWmon']) ? lc(oc.wmon) : deployment!.usdc;
  const poolRef = v3 || kuru ? lc(a['v3Pool']) : v4PoolId(mint, quote, Number(a['v4Fee']), Number(a['v4TickSpacing']));
  await execute(
    pool,
    `INSERT INTO markets (mint, market_pubkey, name, symbol, creator, status, category, execution_engine, risk_tier,
                          mark_price, reference_price, max_leverage, graduated, origin, spot_pool_id, spot_venue,
                          oracle_source, created_at, updated_at, chain)
     VALUES ($1,$1,$2,$3,$4,'Graduated','Secondary','SecondaryAMM','Standard',$5,$5,10,FALSE,'listed',$6,$7,$8,$9,$9,$10)
     ON CONFLICT (mint) DO UPDATE SET
       name = EXCLUDED.name, symbol = EXCLUDED.symbol, creator = EXCLUDED.creator, status = 'Graduated',
       category = 'Secondary', execution_engine = 'SecondaryAMM', origin = 'listed', spot_pool_id = EXCLUDED.spot_pool_id,
       spot_venue = EXCLUDED.spot_venue, oracle_source = EXCLUDED.oracle_source, chain = EXCLUDED.chain, updated_at = NOW()`,
    [mint, name || symbol || mint, symbol || name || mint.slice(0, 6), lister, usd(a['priceE6']), poolRef,
     kuru ? 'kuru' : v3 ? 'uniswap-v3' : 'uniswap-v4', kuru ? 'kuru-ema' : v3 ? 'uniswap-v3-twap' : 'uniswap-v4-ema', ts, CHAIN],
  );
  const price = fromE6(big(a['priceE6']));
  await writeMarketPrices(mint, price, price, 0, 0, 0, 0, ts);
  await execute(
    pool,
    `INSERT INTO secondary_market_state (mint, secondary_market_enabled, migration_start_ts, raydium_twap_e6,
                                         spot_reference_price_e6, blended_reference_price_e6, updated_at)
     VALUES ($1, TRUE, $2, $3, $3, $3, $4)
     ON CONFLICT (mint) DO UPDATE SET secondary_market_enabled = TRUE, updated_at = EXCLUDED.updated_at`,
    [mint, big(a['timestamp']).toString(), big(a['priceE6']).toString(), ts],
  );
  await socialEvent(mint, 'launch', lister, `${symbol || mint} listed`,
    `Perps on an existing token, priced from its ${kuru ? 'Kuru order book' : `Uniswap ${v3 ? 'v3' : 'v4'} pool`}.`, { txHash, pool: poolRef }, ts);
  await publishJson(redis, redisChannels.discoveryNewLaunch, {
    mint, creator: lister, name, symbol, signature: txHash, timestamp: ts, chain: CHAIN, listed: true,
  });
  await syncMarket(mint);
}

async function onSecondaryOracle(a: Args): Promise<void> {
  const mint = lc(a['market']);
  const ts = iso(a['timestamp']);
  await execute(
    pool,
    `INSERT INTO secondary_market_state
       (mint, raydium_twap_e6, spot_reference_price_e6, blended_reference_price_e6, spot_velocity_tripped, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (mint) DO UPDATE SET raydium_twap_e6 = EXCLUDED.raydium_twap_e6,
       spot_reference_price_e6 = EXCLUDED.spot_reference_price_e6,
       blended_reference_price_e6 = EXCLUDED.blended_reference_price_e6,
       spot_velocity_tripped = EXCLUDED.spot_velocity_tripped, updated_at = EXCLUDED.updated_at`,
    [mint, big(a['spotTwapE6']).toString(), big(a['liveSpotE6']).toString(), big(a['oracleE6']).toString(),
     Boolean(a['velocityTripped']), ts],
  );
  await publishJson(redis, redisChannels.secondaryMarket(mint), {
    event: 'oraclePrices', mint, spotTwapE6: big(a['spotTwapE6']).toString(), oracleE6: big(a['oracleE6']).toString(),
    velocityTripped: Boolean(a['velocityTripped']), timestamp: ts,
  });
}

async function onSecondaryLiquidity(a: Args): Promise<void> {
  const mint = lc(a['market']);
  const ts = iso(a['timestamp']);
  await execute(
    pool,
    `INSERT INTO secondary_market_state (mint, virtual_liquidity_usdc, max_oi_usdc, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (mint) DO UPDATE SET virtual_liquidity_usdc = EXCLUDED.virtual_liquidity_usdc,
       max_oi_usdc = EXCLUDED.max_oi_usdc, updated_at = EXCLUDED.updated_at`,
    [mint, big(a['skewScaleUsdc']).toString(), big(a['maxOiUsdc']).toString(), ts],
  );
  await publishJson(redis, redisChannels.secondaryMarket(mint), {
    event: 'liquidityUpdated', mint, virtualLiquidityUsdc: big(a['skewScaleUsdc']).toString(), timestamp: ts,
  });
}

// ── Positions ──────────────────────────────────────────────────────────────────

async function onPositionOpened(a: Args, id: string): Promise<void> {
  const mint = lc(a['market']);
  const owner = lc(a['owner']);
  await insertTrade(mint, owner, sideName(Number(a['side'])), big(a['notionalUsdc']), big(a['executionPriceE6']),
    big(a['feeUsdc']), 'open', id, iso(a['timestamp']));
  await accrueTradePoints(owner, big(a['notionalUsdc']), big(a['feeUsdc']));
}

async function onPositionClosed(a: Args, id: string): Promise<void> {
  const mint = lc(a['market']);
  const owner = lc(a['owner']);
  const fee = big(a['feeUsdc']);
  // Net realized PnL on the closed slice; the row closes on the PositionState that follows.
  const realized = fromE6(big(a['realizedPnlUsdc'])) - fromE6(fee);
  await execute(
    pool,
    `UPDATE positions SET realized_pnl = realized_pnl + $3, mark_price = $4
      WHERE owner = $1 AND market = $2 AND status = 'open'`,
    [owner, mint, realized.toFixed(6), usd(a['executionPriceE6'])],
  );
  await insertTrade(mint, owner, sideName(Number(a['side'])), big(a['notionalUsdc']), big(a['executionPriceE6']),
    fee, 'close', id, iso(a['timestamp']));
  await accrueTradePoints(owner, big(a['notionalUsdc']), fee);
}

async function onPositionState(a: Args): Promise<void> {
  const mint = lc(a['market']);
  const owner = lc(a['owner']);
  const sizeUsdc = big(a['sizeUsdc']);
  const key = `${owner}:${mint}`;
  await execute(
    pool,
    `INSERT INTO unsettled_profits (owner, market, amount_usdc, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (owner, market) DO UPDATE SET amount_usdc = EXCLUDED.amount_usdc, updated_at = NOW()`,
    [owner, mint, usd(a['unsettledProfitUsdc'])],
  );

  if (sizeUsdc === 0n) {
    const label = pendingCloseLabel.get(key) ?? 'closed';
    pendingCloseLabel.delete(key);
    await execute(
      pool,
      `UPDATE positions SET status = $3, closed_at = NOW(), unrealized_pnl = 0
        WHERE owner = $1 AND market = $2 AND status = 'open'`,
      [owner, mint, label],
    );
    await publishJson(redis, redisChannels.portfolioPosition(owner), { market: mint, owner, status: label });
    return;
  }

  const side = sideName(Number(a['side']));
  const base = fromE6(big(a['baseAmount']));
  const cost = fromE6(sizeUsdc);
  const collateral = fromE6(big(a['collateralUsdc']));
  const levRows = await queryRows<{ max_leverage: number; mark_price: string }>(
    pool,
    `SELECT max_leverage, mark_price FROM markets WHERE mint = $1`,
    [mint],
  );
  const maxLev = Math.max(1, Number(levRows[0]?.max_leverage ?? 10));
  const mmFrac = Math.max(1, Math.floor(1_000_000 / (maxLev * 100 * 2))) / 10_000;
  // Liquidation where equity = mm × cost basis.
  const liq = base > 0
    ? side === 'Long'
      ? Math.max(0, (cost + mmFrac * cost - collateral) / base)
      : (cost + collateral - mmFrac * cost) / base
    : 0;
  const mark = Number(levRows[0]?.mark_price ?? 0);
  const upnl = side === 'Long' ? base * mark - cost : cost - base * mark;
  const tp = big(a['tpPriceE6']);
  const sl = big(a['slPriceE6']);
  const params = [
    owner, mint, side, base.toFixed(6), cost.toFixed(6), collateral.toFixed(6), usd(a['entryPriceE6']),
    liq.toFixed(6), mark.toFixed(6), upnl.toFixed(6), tp > 0n ? usd(tp) : null, sl > 0n ? usd(sl) : null,
    Boolean(a['pendingLiquidation']),
  ];
  const updated = await execute(
    pool,
    `UPDATE positions
        SET side = $3, size = $4, notional = $5, collateral = $6, entry_price = $7, liq_price = $8,
            mark_price = $9, unrealized_pnl = $10, tp_price = $11, sl_price = $12, pending_liquidation = $13
      WHERE owner = $1 AND market = $2 AND status = 'open'`,
    params,
  );
  if (!updated.rowCount) {
    await execute(
      pool,
      `INSERT INTO positions (owner, market, side, size, notional, collateral, entry_price, liq_price, mark_price,
                              unrealized_pnl, realized_pnl, funding_paid, tp_price, sl_price, pending_liquidation,
                              opened_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,$11,$12,$13,NOW(),'open')
       ON CONFLICT (owner, market) WHERE status = 'open' DO NOTHING`,
      params,
    );
  }
  await publishJson(redis, redisChannels.portfolioPosition(owner), { market: mint, owner, status: 'open' });
}

async function onPositionLiquidated(a: Args, txHash: string): Promise<void> {
  const mint = lc(a['market']);
  const owner = lc(a['owner']);
  const side = sideName(Number(a['side']));
  const ts = iso(a['timestamp']);
  const size = usd(a['sizeUsdc']);
  const price = usd(a['liquidationPriceE6']);
  const reward = usd(a['rewardUsdc']);
  await execute(
    pool,
    `UPDATE positions SET status = 'liquidated', closed_at = $3, unrealized_pnl = 0, realized_pnl = -collateral
      WHERE owner = $1 AND market = $2 AND status = 'open'`,
    [owner, mint, ts],
  );
  await execute(
    pool,
    `INSERT INTO liquidations (market, position_owner, liquidator, side, size_liquidated, liq_price, penalty, ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [mint, owner, lc(a['liquidator']), side, size, price, reward, ts],
  );
  const symbol = await marketSymbol(mint);
  await notify(owner, 'liquidation', `Your ${symbol} ${side.toLowerCase()} was liquidated`,
    `Size $${Number(size).toFixed(2)} at $${Number(price).toPrecision(6)}.`, '/portfolio?tab=history',
    { market: mint, side, size, price, txHash }, `liq:${txHash}:${owner}`);
  await publishJson(redis, redisChannels.marketLiquidation(mint), {
    market: mint, owner, liquidator: lc(a['liquidator']), side, size, liqPrice: price, penalty: reward, timestamp: ts,
  });
}

async function onTriggerExecuted(a: Args, txHash: string): Promise<void> {
  const mint = lc(a['market']);
  const owner = lc(a['owner']);
  const takeProfit = Boolean(a['takeProfit']);
  pendingCloseLabel.set(`${owner}:${mint}`, takeProfit ? 'take_profit' : 'stop_loss');
  const side = sideName(Number(a['side']));
  const price = fromE6(big(a['executionPriceE6']));
  const payout = fromE6(big(a['payoutUsdc']));
  const symbol = await marketSymbol(mint);
  await notify(owner, takeProfit ? 'take_profit' : 'stop_loss',
    `${takeProfit ? 'Take profit' : 'Stop loss'} filled — ${symbol} ${side.toLowerCase()}`,
    `Closed at $${price.toPrecision(6)}; $${payout.toFixed(2)} returned to your wallet.`, '/portfolio?tab=history',
    { market: mint, side, price, payout, signature: txHash }, `trigger:${txHash}`);
}

async function insertTrade(
  mint: string,
  trader: string,
  side: string,
  notionalE6: bigint,
  priceE6: bigint,
  feeE6: bigint,
  tradeType: 'open' | 'close',
  id: string,
  ts: string,
): Promise<void> {
  const price = fromE6(priceE6);
  const notional = fromE6(notionalE6);
  const size = price > 0 ? notional / price : 0; // base tokens
  await execute(
    pool,
    `INSERT INTO trades (tx_signature, market, trader, side, size, notional, execution_price, fee_paid, trade_type, ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tx_signature, ts) DO NOTHING`,
    [id, mint, trader, side, size.toFixed(6), notional.toFixed(6), price.toFixed(6), usd(feeE6), tradeType, ts],
  );
  await publishJson(redis, redisChannels.marketTrade(mint), {
    market: mint, trader, side, size: size.toFixed(6), executionPrice: price.toFixed(6), notional: notional.toFixed(6),
    tradeType, timestamp: ts, txSignature: id.split(':')[1],
  });
}

// ── Fees / settlement ──────────────────────────────────────────────────────────

async function onTradingFee(a: Args, id: string): Promise<void> {
  const fee = big(a['feeUsdc']);
  if (fee === 0n) return;
  const mint = lc(a['market']);
  const trader = lc(a['trader']);
  const ts = iso(a['timestamp']);
  const binding = await queryRows<{ referrer: string }>(
    pool,
    `SELECT referrer FROM user_referral_bindings WHERE user_key = $1 LIMIT 1`,
    [trader],
  );
  const referrer = binding[0]?.referrer ?? null;
  // Referral rewards are off-chain: carved out of the protocol cut at 5% of the fee.
  const referral = referrer ? (fee * 500n) / 10_000n : 0n;
  const protocolCut = big(a['protocolCutUsdc']);
  const protocol = protocolCut > referral ? protocolCut - referral : 0n;
  // What's left is the Counterflow LPs' share (oracle markets; 0 on primary ones).
  const lpCut = fee - big(a['creatorCutUsdc']) - big(a['insuranceCutUsdc']) - protocolCut;
  await execute(
    pool,
    `INSERT INTO fee_events (tx_signature, market, trader, protocol_fee, insurance_fee, creator_fee, referral_fee, vault_fee, ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tx_signature, ts) DO NOTHING`,
    [id, mint, trader, usd(protocol), usd(a['insuranceCutUsdc']), usd(a['creatorCutUsdc']), usd(referral),
     usd(lpCut > 0n ? lpCut : 0n), ts],
  );
  if (!referrer || referral === 0n) return;
  await pool.query(
    `WITH fee_row AS (
       SELECT id::TEXT AS fee_event_id FROM fee_events WHERE tx_signature = $1 LIMIT 1
     ), ins AS (
       INSERT INTO referral_fee_credits (fee_event_id, referrer, trader, amount_usdc)
       SELECT fee_event_id, $2, $3, $4 FROM fee_row
       ON CONFLICT (fee_event_id) DO NOTHING
     )
     INSERT INTO reward_claimables (owner_wallet, source, credited_total_usdc, last_credit_at)
     VALUES ($2, 'referral_fee', $4, NOW())
     ON CONFLICT (owner_wallet, source)
     DO UPDATE SET credited_total_usdc = reward_claimables.credited_total_usdc + EXCLUDED.credited_total_usdc,
                   last_credit_at = NOW()`,
    [id, referrer, trader, fromE6(referral).toFixed(6)],
  );
}

async function onPayoutHaircut(a: Args, id: string): Promise<void> {
  const mint = lc(a['market']);
  const owner = lc(a['owner']);
  await execute(
    pool,
    `INSERT INTO payout_haircuts (signature, market, owner, gross_payout_usdc, actual_payout_usdc, shortfall_usdc, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [id, mint, owner, usd(a['grossPayoutUsdc']), usd(a['actualPayoutUsdc']), usd(a['shortfallUsdc']), iso(a['timestamp'])],
  );
  await publishJson(redis, redisChannels.marketSystem(mint), {
    event: 'payoutHaircut', market: mint, owner, grossPayoutUsdc: usd(a['grossPayoutUsdc']),
    actualPayoutUsdc: usd(a['actualPayoutUsdc']), shortfallUsdc: usd(a['shortfallUsdc']), timestamp: iso(a['timestamp']),
  });
}

async function settlementEvent(
  id: string,
  kind: 'payout_deferred' | 'unsettled_claimed',
  a: Args,
  amountKey: string,
  totalKey: string,
): Promise<void> {
  await execute(
    pool,
    `INSERT INTO engine_settlement_events (tx_signature, kind, market, owner, amount_usdc, running_total_usdc, ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tx_signature, kind, market, owner) DO NOTHING`,
    [id, kind, lc(a['market']), lc(a['owner']), usd(a[amountKey]), usd(a[totalKey]), iso(a['timestamp'])],
  );
}

// ── Limit orders ───────────────────────────────────────────────────────────────

const orderKey = (orderId: unknown): string => `${CHAIN}:${big(orderId).toString()}`;

async function onOrderPlaced(a: Args, txHash: string): Promise<void> {
  const type = orderTypeName(Number(a['orderType']));
  // limit_orders.order_type allows Limit/StopMarket/StopLimit/TakeProfit; IOC/FOK rest as Limit.
  const dbType = type === 'ImmediateOrCancel' || type === 'FillOrKill' ? 'Limit' : type;
  const limit = big(a['limitPriceE6']);
  const stop = big(a['stopPriceE6']);
  const expires = big(a['expiresAt']);
  await execute(
    pool,
    `INSERT INTO limit_orders (order_pda, trader, market, nonce, side, order_type, collateral, leverage, limit_price,
                               stop_price, initial_notional, remaining_notional, placed_tx, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14)
     ON CONFLICT (order_pda) DO NOTHING`,
    [orderKey(a['orderId']), lc(a['trader']), lc(a['market']), big(a['orderId']).toString(), sideName(Number(a['side'])),
     dbType, usd(a['collateralUsdc']), Number(a['leverage']), limit > 0n ? usd(limit) : null, stop > 0n ? usd(stop) : null,
     usd(a['initialNotionalUsdc']), txHash, iso(a['timestamp']), expires > 0n ? iso(expires) : null],
  );
}

async function onOrderExecuted(a: Args): Promise<void> {
  const status = OrderStatus[Number(a['status'])] ?? 'PartiallyFilled';
  const ts = iso(a['timestamp']);
  await execute(
    pool,
    `UPDATE limit_orders
        SET remaining_notional = $2, filled_notional = filled_notional + $3, last_fill_price = $4,
            fill_count = fill_count + 1, status = $5,
            filled_at = CASE WHEN $5 = 'Filled' THEN $6::timestamptz ELSE filled_at END,
            cancelled_at = CASE WHEN $5 = 'Cancelled' THEN $6::timestamptz ELSE cancelled_at END
      WHERE order_pda = $1`,
    [orderKey(a['orderId']), usd(a['remainingNotionalUsdc']), usd(a['filledNotionalUsdc']), usd(a['executionPriceE6']),
     status, ts],
  );
}

// ── Shared side effects (same SQL as apps/indexer) ─────────────────────────────

async function accrueTradePoints(wallet: string, notionalE6: bigint, feeE6: bigint): Promise<void> {
  const tradingPts = Math.floor((Number(notionalE6) / 1_000_000) * 10);
  const feePts = Math.floor((Number(feeE6) / 1_000_000) * 100);
  const total = tradingPts + feePts;
  if (total === 0) return;
  await execute(
    pool,
    `INSERT INTO user_points (user_key, trading_points, fee_points, total_points, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_key) DO UPDATE SET
       trading_points = user_points.trading_points + EXCLUDED.trading_points,
       fee_points = user_points.fee_points + EXCLUDED.fee_points,
       total_points = user_points.total_points + EXCLUDED.total_points,
       updated_at = NOW()`,
    [wallet, tradingPts, feePts, total],
  );
  await execute(
    pool,
    `INSERT INTO points_ledger (user_key, category, points, reference_type, description)
     VALUES ($1, 'trading_points', $2, 'trade', 'Earned from trading volume and fees')`,
    [wallet, total],
  );
  const binding = await queryRows<{ referrer: string }>(
    pool,
    `SELECT referrer FROM user_referral_bindings WHERE user_key = $1 LIMIT 1`,
    [wallet],
  );
  const referrer = binding[0]?.referrer;
  const affiliate = Math.floor(total / 4);
  if (!referrer || affiliate === 0) return;
  await execute(
    pool,
    `INSERT INTO user_points (user_key, affiliate_points, total_points, updated_at)
     VALUES ($1, $2, $2, NOW())
     ON CONFLICT (user_key) DO UPDATE SET
       affiliate_points = user_points.affiliate_points + EXCLUDED.affiliate_points,
       total_points = user_points.total_points + EXCLUDED.total_points,
       updated_at = NOW()`,
    [referrer, affiliate],
  );
  await execute(
    pool,
    `INSERT INTO points_ledger (user_key, category, points, reference_type, reference_id, description)
     VALUES ($1, 'affiliate_points', $2, 'referral', $3, 'Share of a referred trader''s points')`,
    [referrer, affiliate, wallet],
  );
}

async function awardPoints(
  wallet: string,
  category: 'launch_points',
  points: number,
  referenceType: string,
  referenceId: string,
  description: string,
): Promise<void> {
  await execute(
    pool,
    `INSERT INTO user_points (user_key, ${category}, total_points, updated_at)
     VALUES ($1, $2, $2, NOW())
     ON CONFLICT (user_key) DO UPDATE SET
       ${category} = user_points.${category} + EXCLUDED.${category},
       total_points = user_points.total_points + EXCLUDED.${category},
       updated_at = NOW()`,
    [wallet, points],
  );
  await execute(
    pool,
    `INSERT INTO points_ledger (user_key, category, points, reference_type, reference_id, description)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [wallet, category, points, referenceType, referenceId, description],
  );
}

async function socialEvent(
  market: string,
  eventType: string,
  actor: string,
  title: string,
  body: string,
  metadata: Record<string, unknown>,
  ts: string,
): Promise<void> {
  await execute(
    pool,
    `INSERT INTO market_social_events (market, event_type, actor, title, body, metadata, ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [market, eventType, actor, title, body, JSON.stringify(metadata), ts],
  );
  await publishJson(redis, redisChannels.marketSocial(market), { market, eventType, actor, title, body, metadata, timestamp: ts });
}

async function marketSymbol(mint: string): Promise<string> {
  const rows = await queryRows<{ symbol: string }>(pool, `SELECT symbol FROM markets WHERE mint = $1`, [mint]).catch(() => []);
  return rows[0]?.symbol ?? `${mint.slice(0, 6)}…`;
}

async function notify(
  wallet: string,
  kind: string,
  title: string,
  body: string,
  href: string | null,
  metadata: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> {
  const rows = await queryRows<{ id: string; created_at: string }>(
    pool,
    `INSERT INTO user_notifications (wallet, kind, title, body, href, metadata, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id, created_at`,
    [wallet, kind, title, body, href, JSON.stringify(metadata), dedupeKey],
  );
  const row = rows[0];
  if (!row) return;
  await publishJson(redis, redisChannels.userNotification(wallet), {
    id: String(row.id), kind, title, body, href, metadata, createdAt: row.created_at, readAt: null,
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function loop(): Promise<void> {
  for (;;) {
    try {
      await pollOnce();
    } catch (err) {
      logger.warn('poll failed; retrying', { err: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function main(): Promise<void> {
  createHealthServer({
    port: PORT,
    serviceName: SERVICE_NAME,
    getReadiness: async () => {
      const [db, r] = await Promise.all([pool.query('SELECT 1'), redis.ping()]);
      return Boolean(db.rowCount) && r === 'PONG';
    },
    getMetrics: () =>
      [
        `perpes_evm_indexer_last_block{chain="${CHAIN}"} ${lastBlock}`,
        `perpes_evm_indexer_events_total{chain="${CHAIN}"} ${eventsTotal}`,
        `perpes_evm_indexer_events_failed_total{chain="${CHAIN}"} ${eventsFailed}`,
      ].join('\n'),
  });
  logger.info('EVM indexer starting', { chain: CHAIN, engine: ENGINE, rpc: RPC_URL.replace(/\/[^/]*$/, '/…') });
  setInterval(() => {
    void syncAllMarkets().catch((err) => logger.warn('market sync pass failed', { err: String(err) }));
  }, SYNC_MS);
  await loop();
}

process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', { reason: String(reason) }));
void main();
