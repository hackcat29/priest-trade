/**
 * EVM keeper — the Monad counterpart of apps/keeper's liquidation, TP/SL and
 * limit-order loops. Those calls are permissionless; the keeper is simply the
 * protocol-run caller (see permissionless scope: keepers stay protocol-operated).
 *
 * It is also the graduation operator (PerpesEngine.isOperator): it executes
 * graduations the owner approved. Oracle markets (graduated or listed) price
 * on-chain from their pool, so the keeper only pokes them — when the pool has
 * moved from the average, or on a slow heartbeat so a v4 EMA keeps up on quiet
 * markets — and sweeps each oracle market's equity to its own Counterflow vault.
 *
 * Every action is simulated first (eth_call) and only sent when it would
 * succeed, so the keeper never pays for a revert — Monad charges the full gas
 * limit, so gas is also estimated per call with a small buffer.
 */
import { readFileSync } from 'node:fs';

import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createHealthServer, createLogger, createPgPool, queryRows, requireEnv } from '@perpes/offchain';
import {
  EVM_CHAINS,
  evmRpcUrl,
  getEvmDeployment,
  isEvmChainKey,
  mockUsdcAbi,
  perpesEngineAbi,
  toE6,
  type EvmChainKey,
} from '@perpes/evm';

const SERVICE_NAME = '@perpes/evm-keeper';
const logger = createLogger(SERVICE_NAME);

const CHAIN_RAW = requireEnv('EVM_CHAIN');
if (!isEvmChainKey(CHAIN_RAW)) throw new Error(`EVM_CHAIN must be monad-testnet or monad, got ${CHAIN_RAW}`);
const CHAIN: EvmChainKey = CHAIN_RAW;
const deployment = getEvmDeployment(CHAIN, {
  ...(process.env['EVM_ENGINE_ADDRESS'] ? { engine: process.env['EVM_ENGINE_ADDRESS'] as Address } : {}),
  ...(process.env['EVM_USDC_ADDRESS'] ? { usdc: process.env['EVM_USDC_ADDRESS'] as Address } : {}),
});
if (!deployment) throw new Error(`No PerpesEngine deployment for ${CHAIN}; set EVM_ENGINE_ADDRESS`);
const ENGINE = deployment.engine;

const RPC_URL = evmRpcUrl(CHAIN, { rpcUrl: process.env['EVM_RPC_URL'], alchemyApiKey: process.env['ALCHEMY_API_KEY'] });
const PORT = Number.parseInt(process.env['EVM_KEEPER_PORT'] ?? '3022', 10);
const TICK_MS = Number.parseInt(process.env['EVM_KEEPER_TICK_MS'] ?? '2000', 10);
const DRY_RUN = process.env['KEEPER_DRY_RUN'] === 'true';
const MIN_FILL_USDC = toE6(10);
// Pokes are optional (every trade samples the pool) and cost gas, so: poke when
// the pool is POKE_DEVIATION_BPS away from the average (at most every
// POKE_MIN_INTERVAL_S), or after POKE_HEARTBEAT_S of quiet.
const POKE_DEVIATION_BPS = BigInt(process.env['EVM_POKE_DEVIATION_BPS'] ?? '30');
const POKE_MIN_INTERVAL_S = Number(process.env['EVM_POKE_MIN_INTERVAL_S'] ?? '30');
const POKE_HEARTBEAT_S = Number(process.env['EVM_POKE_HEARTBEAT_S'] ?? '600');
// Counterflow sweeps: when at least this much is waiting, at most this often.
const SYNC_MIN_USDC = toE6(process.env['EVM_COUNTERFLOW_SYNC_MIN_USDC'] ?? '50');
const SYNC_INTERVAL_MS = Number(process.env['EVM_COUNTERFLOW_SYNC_INTERVAL_MS'] ?? '3600000');
// Graduation seed (USDC). Unset or 0 = don't execute graduations from this keeper.
const GRADUATION_SEED_USDC = toE6(process.env['GRADUATION_SEED_USDC'] ?? '0');
// Price band (bps around the index read just before sending) the graduation must land in.
const GRADUATION_PRICE_BAND_BPS = BigInt(process.env['GRADUATION_PRICE_BAND_BPS'] ?? '300');

function loadKey(): Hex {
  const inline = process.env['EVM_KEEPER_PRIVATE_KEY']?.trim();
  const path = process.env['EVM_KEEPER_KEY_PATH']?.trim();
  const raw = inline || (path ? readFileSync(path, 'utf8').trim() : '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error('Set EVM_KEEPER_PRIVATE_KEY or EVM_KEEPER_KEY_PATH');
  return raw as Hex;
}

const account = privateKeyToAccount(loadKey());
const chain = EVM_CHAINS[CHAIN];
const transport = http(RPC_URL, { retryCount: 3, timeout: 20_000 });
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ chain, transport, account });
const pool = createPgPool(requireEnv('DATABASE_URL'), SERVICE_NAME);

const stats = {
  ticks: 0,
  liquidations: 0,
  triggers: 0,
  orders: 0,
  cancels: 0,
  oracle_pokes: 0,
  counterflow_syncs: 0,
  graduations: 0,
  failures: 0,
};

type EngineWrite =
  | { functionName: 'liquidate'; args: readonly [Address, Address] }
  | { functionName: 'executeTrigger'; args: readonly [Address, Address] }
  | { functionName: 'executeLimitOrder'; args: readonly [bigint, bigint] }
  | { functionName: 'cancelLimitOrder'; args: readonly [bigint] }
  | { functionName: 'poke'; args: readonly [Address] }
  | { functionName: 'syncCounterflow'; args: readonly [Address] }
  | { functionName: 'graduate'; args: readonly [Address, bigint, bigint, bigint] };

function revertName(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? revert.shortMessage;
    return err.shortMessage;
  }
  return String(err);
}

/** Simulate; send only if it would succeed. Returns the error name on a simulated revert. */
async function send(call: EngineWrite, label: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { request } = await publicClient.simulateContract({
      address: ENGINE,
      abi: perpesEngineAbi,
      account,
      ...call,
    } as Parameters<typeof publicClient.simulateContract>[0]);
    if (DRY_RUN) {
      logger.info('dry-run: would send', { label });
      return { ok: true };
    }
    const gas = await publicClient.estimateContractGas({ ...request, account } as Parameters<typeof publicClient.estimateContractGas>[0]);
    const hash = await walletClient.writeContract({ ...(request as Parameters<typeof walletClient.writeContract>[0]), gas: (gas * 12n) / 10n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== 'success') {
      stats.failures += 1;
      logger.warn('tx reverted on-chain', { label, hash });
      return { ok: false, reason: 'reverted' };
    }
    logger.info('sent', { label, hash });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: revertName(err) };
  }
}

// ── Liquidations + TP/SL ──────────────────────────────────────────────────────

async function scanPositions(): Promise<void> {
  const rows = await queryRows<{ owner: string; market: string; has_trigger: boolean }>(
    pool,
    `SELECT p.owner, p.market, (p.tp_price IS NOT NULL OR p.sl_price IS NOT NULL) AS has_trigger
       FROM positions p JOIN markets m ON m.mint = p.market
      WHERE m.chain = $1 AND p.status = 'open'`,
    [CHAIN],
  );
  for (const row of rows) {
    const token = row.market as Address;
    const owner = row.owner as Address;
    try {
      const [, liquidatable] = await publicClient.readContract({
        address: ENGINE,
        abi: perpesEngineAbi,
        functionName: 'positionHealth',
        args: [token, owner],
      });
      if (liquidatable) {
        const r = await send({ functionName: 'liquidate', args: [token, owner] }, `liquidate ${owner} ${token}`);
        if (r.ok) stats.liquidations += 1;
        else logger.warn('liquidation skipped', { owner, token, reason: r.reason });
        continue;
      }
      if (!row.has_trigger) continue;
      const [hit, takeProfit] = await publicClient.readContract({
        address: ENGINE,
        abi: perpesEngineAbi,
        functionName: 'triggerStatus',
        args: [token, owner],
      });
      if (hit) {
        const r = await send({ functionName: 'executeTrigger', args: [token, owner] }, `${takeProfit ? 'tp' : 'sl'} ${owner} ${token}`);
        if (r.ok) stats.triggers += 1;
        else logger.warn('trigger skipped', { owner, token, reason: r.reason });
      }
    } catch (err) {
      stats.failures += 1;
      logger.warn('position scan failed', { owner, token, err: revertName(err) });
    }
  }
}

// ── Limit orders ──────────────────────────────────────────────────────────────

async function scanOrders(): Promise<void> {
  const rows = await queryRows<{ nonce: string; remaining_notional: string; expires_at: string | null }>(
    pool,
    `SELECT o.nonce, o.remaining_notional, o.expires_at
       FROM limit_orders o JOIN markets m ON m.mint = o.market
      WHERE m.chain = $1 AND o.status IN ('Open', 'PartiallyFilled') AND o.order_pda LIKE $2`,
    [CHAIN, `${CHAIN}:%`],
  );
  const now = Date.now();
  for (const row of rows) {
    const orderId = BigInt(row.nonce);
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
      const r = await send({ functionName: 'cancelLimitOrder', args: [orderId] }, `cancel expired #${orderId}`);
      if (r.ok) stats.cancels += 1;
      continue;
    }
    // Fill everything left; if the curve impact breaks the limit, halve until it fits.
    let fill = toE6(row.remaining_notional);
    const remaining = fill;
    while (fill >= MIN_FILL_USDC || fill === remaining) {
      const r = await send({ functionName: 'executeLimitOrder', args: [orderId, fill] }, `fill #${orderId} ${fill}`);
      if (r.ok) {
        stats.orders += 1;
        break;
      }
      if (r.reason !== 'LimitPriceNotMet' && r.reason !== 'LeverageTooHigh') break; // not triggered, expired, ...
      if (fill === 0n) break;
      fill /= 2n;
      if (fill < MIN_FILL_USDC) break;
    }
  }
}

// ── Graduated markets: oracle + liquidity ─────────────────────────────────────

async function oracleMarkets(): Promise<Address[]> {
  const rows = await queryRows<{ mint: string }>(
    pool,
    `SELECT mint FROM markets WHERE chain = $1 AND status IN ('Graduated', 'Delisted') AND category = 'Secondary'`,
    [CHAIN],
  );
  return rows.map((r) => r.mint as Address);
}

const bpsApart = (a: bigint, b: bigint): bigint => (b === 0n ? 10_000n : ((a > b ? a - b : b - a) * 10_000n) / b);
const lastSync = new Map<string, number>();

/** Pokes oracle markets whose pool moved, or that have been quiet too long. */
async function pokeOracles(): Promise<void> {
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  for (const token of await oracleMarkets()) {
    try {
      const [spot, s] = await Promise.all([
        publicClient.readContract({ address: ENGINE, abi: perpesEngineAbi, functionName: 'spotPriceE6', args: [token] }),
        publicClient.readContract({ address: ENGINE, abi: perpesEngineAbi, functionName: 'getSecondary', args: [token] }),
      ]);
      if (spot === 0n || !s.active) continue;
      const age = Number(nowSec - BigInt(s.lastOracleTs));
      const moved = bpsApart(spot, s.spotTwapE6) >= POKE_DEVIATION_BPS && age >= POKE_MIN_INTERVAL_S;
      if (!moved && age < POKE_HEARTBEAT_S) continue;
      const r = await send({ functionName: 'poke', args: [token] }, `poke ${token}`);
      if (r.ok) stats.oracle_pokes += 1;
      else logger.warn('poke skipped', { token, reason: r.reason });
    } catch (err) {
      stats.failures += 1;
      logger.warn('oracle poke failed', { token, err: revertName(err) });
    }
  }
}

/**
 * Moves each oracle market's sweepable equity (LP fee share and trader losses)
 * to its own Counterflow vault, and deposits creators' set-aside fees there.
 */
async function syncCounterflow(): Promise<void> {
  const now = Date.now();
  for (const token of await oracleMarkets()) {
    if (now - (lastSync.get(token) ?? 0) < SYNC_INTERVAL_MS) continue;
    try {
      const vault = await publicClient.readContract({ address: ENGINE, abi: perpesEngineAbi, functionName: 'lpVault', args: [token] });
      if (vault === zeroAddress) continue;
      const [creatorStake, surplus] = await publicClient.readContract({
        address: ENGINE,
        abi: perpesEngineAbi,
        functionName: 'counterflowSurplus',
        args: [token],
      });
      lastSync.set(token, now);
      if (creatorStake + surplus < SYNC_MIN_USDC) continue;
      const r = await send({ functionName: 'syncCounterflow', args: [token] }, `counterflow sync ${token}`);
      if (r.ok) stats.counterflow_syncs += 1;
      else logger.warn('counterflow sync skipped', { token, reason: r.reason });
    } catch (err) {
      stats.failures += 1;
      logger.warn('counterflow sync failed', { token, err: revertName(err) });
    }
  }
}

// ── Graduation execution ──────────────────────────────────────────────────────

/** Markets the owner approved that haven't graduated yet. */
async function approvedMarkets(): Promise<Address[]> {
  const rows = await queryRows<{ mint: string }>(
    pool,
    `SELECT m.mint FROM markets m JOIN migration_eligibility me ON me.mint = m.mint
      WHERE m.chain = $1 AND me.protocol_approved = TRUE AND m.status <> 'Graduated'`,
    [CHAIN],
  );
  return rows.map((r) => r.mint as Address);
}

async function ensureUsdc(amount: bigint): Promise<boolean> {
  const usdc = deployment!.usdc;
  let balance = await publicClient.readContract({ address: usdc, abi: mockUsdcAbi, functionName: 'balanceOf', args: [account.address] });
  if (balance < amount && deployment!.mockUsdc) {
    try {
      const hash = await walletClient.writeContract({ address: usdc, abi: mockUsdcAbi, functionName: 'faucet', args: [] });
      await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      balance = await publicClient.readContract({ address: usdc, abi: mockUsdcAbi, functionName: 'balanceOf', args: [account.address] });
    } catch (err) {
      logger.warn('testnet faucet unavailable', { err: revertName(err) });
    }
  }
  if (balance < amount) {
    logger.warn('keeper lacks USDC for a graduation seed', { need: amount.toString(), have: balance.toString() });
    return false;
  }
  const allowance = await publicClient.readContract({ address: usdc, abi: mockUsdcAbi, functionName: 'allowance', args: [account.address, ENGINE] });
  if (allowance < amount) {
    const hash = await walletClient.writeContract({ address: usdc, abi: mockUsdcAbi, functionName: 'approve', args: [ENGINE, amount] });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  }
  return true;
}

async function executeGraduations(): Promise<void> {
  if (GRADUATION_SEED_USDC === 0n) return;
  for (const token of await approvedMarkets()) {
    try {
      const s = await publicClient.readContract({ address: ENGINE, abi: perpesEngineAbi, functionName: 'getSecondary', args: [token] });
      if (!s.approved || s.active) continue;
      const m = await publicClient.readContract({ address: ENGINE, abi: perpesEngineAbi, functionName: 'previewMarket', args: [token] });
      // The market's unclaimed protocol fees fund the seed first; the keeper pays the rest.
      const fromKeeper = GRADUATION_SEED_USDC > m.protocolFeesPendingUsdc ? GRADUATION_SEED_USDC - m.protocolFeesPendingUsdc : 0n;
      if (fromKeeper > 0n && !(await ensureUsdc(fromKeeper))) continue;
      const band = (m.indexPriceE6 * GRADUATION_PRICE_BAND_BPS) / 10_000n;
      const r = await send(
        { functionName: 'graduate', args: [token, GRADUATION_SEED_USDC, m.indexPriceE6 - band, m.indexPriceE6 + band] },
        `graduate ${token}`,
      );
      if (r.ok) {
        stats.graduations += 1;
        logger.info('market graduated', { token, seedUsdc: GRADUATION_SEED_USDC.toString() });
      } else {
        stats.failures += 1;
        logger.warn('graduation skipped', { token, reason: r.reason });
      }
    } catch (err) {
      stats.failures += 1;
      logger.warn('graduation failed', { token, err: revertName(err) });
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Oracle pokes first, so liquidation checks see a current average.
    await pokeOracles();
    await scanPositions();
    await scanOrders();
    await executeGraduations();
    await syncCounterflow();
    stats.ticks += 1;
  } catch (err) {
    stats.failures += 1;
    logger.warn('tick failed', { err: String(err) });
  } finally {
    running = false;
  }
}

async function main(): Promise<void> {
  createHealthServer({
    port: PORT,
    serviceName: SERVICE_NAME,
    getReadiness: async () => Boolean((await pool.query('SELECT 1')).rowCount),
    getMetrics: () =>
      Object.entries(stats)
        .map(([k, v]) => `perpes_evm_keeper_${k}_total{chain="${CHAIN}"} ${v}`)
        .join('\n'),
  });
  const balance = await publicClient.getBalance({ address: account.address });
  logger.info('EVM keeper starting', { chain: CHAIN, engine: ENGINE, keeper: account.address, balanceWei: balance.toString(), dryRun: DRY_RUN });
  const operator = await publicClient
    .readContract({ address: ENGINE, abi: perpesEngineAbi, functionName: 'isOperator', args: [account.address] })
    .catch(() => false); // engine not yet upgraded for graduation
  if (!operator) logger.warn('keeper is not a graduation operator — graduations will be skipped');
  if (balance === 0n) logger.warn('keeper has no gas balance — transactions will fail until it is funded');
  setInterval(() => void tick(), TICK_MS);
  await tick();
}

process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', { reason: String(reason) }));
void main();
