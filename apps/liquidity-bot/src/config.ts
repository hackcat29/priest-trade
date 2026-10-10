import { type Address, type Hex } from 'viem';
import {
  EVM_CHAINS,
  getEvmDeployment,
  isEvmChainKey,
  toE6,
  type EvmChainKey,
} from '@perpes/evm';
import type { BotMode } from './types';

function parseArgs(): { mode?: BotMode } {
  const args = process.argv.slice(2);
  let mode: BotMode | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode' && args[i + 1]) {
      const val = args[i + 1]?.toLowerCase();
      if (val === 'testnet' || val === 'mainnet') mode = val;
    }
  }
  return mode ? { mode } : {};
}

const parsedArgs = parseArgs();
const envMode = process.env['BOT_MODE']?.toLowerCase();
export const BOT_MODE: BotMode =
  parsedArgs.mode ||
  (envMode === 'mainnet' ? 'mainnet' : 'testnet');

// Map BOT_MODE to EVM_CHAIN unless EVM_CHAIN explicitly set
const envChain = process.env['EVM_CHAIN'];
export const EVM_CHAIN: EvmChainKey = isEvmChainKey(envChain)
  ? envChain
  : BOT_MODE === 'mainnet'
    ? 'monad'
    : 'monad-testnet';

export const CHAIN_DEF = EVM_CHAINS[EVM_CHAIN];

const deployment = getEvmDeployment(EVM_CHAIN, {
  ...(process.env['EVM_ENGINE_ADDRESS']
    ? { engine: process.env['EVM_ENGINE_ADDRESS'] as Address }
    : {}),
  ...(process.env['EVM_USDC_ADDRESS']
    ? { usdc: process.env['EVM_USDC_ADDRESS'] as Address }
    : {}),
});

if (!deployment) {
  throw new Error(`No Perpes deployment found for ${EVM_CHAIN}`);
}

export const DEPLOYMENT = deployment;
export const ENGINE_ADDRESS = deployment.engine;
export const USDC_ADDRESS = deployment.usdc;
export const IS_MOCK_USDC = deployment.mockUsdc;

export const RPC_URL =
  process.env['EVM_RPC_URL'] || CHAIN_DEF.rpcUrls.default.http[0]!;

// ── Master Key & Multi-Wallet Setup ──────────────────────────────────────────

function loadMasterKey(): Hex {
  const inline = (
    process.env['EVM_BOT_PRIVATE_KEY'] ||
    process.env['EVM_KEEPER_PRIVATE_KEY'] ||
    process.env['DEPLOYER']
  )?.trim();
  if (inline && /^0x[0-9a-fA-F]{64}$/.test(inline)) {
    return inline as Hex;
  }
  // Safe fallback default for local dev/testing if not specified
  return '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
}

export const MASTER_PRIVATE_KEY = loadMasterKey();
export const NUM_SUB_WALLETS = Math.max(
  2,
  Math.min(20, Number.parseInt(process.env['NUM_SUB_WALLETS'] ?? '6', 10)),
);
export const AUTO_TOP_UP_GAS = process.env['AUTO_TOP_UP_GAS'] !== 'false';
export const AUTO_TOP_UP_USDC = process.env['AUTO_TOP_UP_USDC'] !== 'false';

// Gas thresholds in Wei
export const MIN_SUB_WALLET_MON = BigInt(
  process.env['MIN_SUB_WALLET_MON'] ?? '50000000000000000', // 0.05 MON
);
export const TOP_UP_MON_AMOUNT = BigInt(
  process.env['TOP_UP_MON_AMOUNT'] ?? '200000000000000000', // 0.2 MON
);

// USDC thresholds in 6-decimals
export const MIN_SUB_WALLET_USDC = toE6(
  process.env['MIN_SUB_WALLET_USDC'] ?? '20',
);
export const TOP_UP_USDC_AMOUNT = toE6(
  process.env['TOP_UP_USDC_AMOUNT'] ?? (BOT_MODE === 'mainnet' ? '30' : '200'),
);

// ── Testnet Parameters (No Risk Guard, Aggressive) ───────────────────────────

export const TESTNET_CONFIG = {
  tradeIntervalMsMin: Number.parseInt(
    process.env['TESTNET_TRADE_INTERVAL_MS_MIN'] ?? '2500',
    10,
  ),
  tradeIntervalMsMax: Number.parseInt(
    process.env['TESTNET_TRADE_INTERVAL_MS_MAX'] ?? '7500',
    10,
  ),
  notionalMinUsdc: toE6(process.env['TESTNET_NOTIONAL_MIN_USDC'] ?? '25'),
  notionalMaxUsdc: toE6(process.env['TESTNET_NOTIONAL_MAX_USDC'] ?? '150'),
  defaultLeverage: Math.min(
    10,
    Number.parseInt(process.env['TESTNET_DEFAULT_LEVERAGE'] ?? '5', 10),
  ),
  maxSlippageBps: Number.parseInt(
    process.env['TESTNET_MAX_SLIPPAGE_BPS'] ?? '600',
    10,
  ), // 6%
  allowAutoFaucet: true,
};

// ── Mainnet Parameters (Break-Even, Strict Risk Guards) ───────────────────────

export const MAINNET_CONFIG = {
  tradeIntervalMsMin: Number.parseInt(
    process.env['MAINNET_TRADE_INTERVAL_MS_MIN'] ?? '8000',
    10,
  ),
  tradeIntervalMsMax: Number.parseInt(
    process.env['MAINNET_TRADE_INTERVAL_MS_MAX'] ?? '32000',
    10,
  ),
  notionalMinUsdc: toE6(process.env['MAINNET_NOTIONAL_MIN_USDC'] ?? '10'), // minimum allowed on Perpes engine
  notionalMaxUsdc: toE6(process.env['MAINNET_NOTIONAL_MAX_USDC'] ?? '22'), // low impact
  defaultLeverage: Math.min(
    3,
    Number.parseInt(process.env['MAINNET_DEFAULT_LEVERAGE'] ?? '2', 10),
  ), // 2x leverage to avoid any liquidation risk
  maxSlippageBps: Number.parseInt(
    process.env['MAINNET_MAX_SLIPPAGE_BPS'] ?? '60',
    10,
  ), // 0.60%
  maxCapitalPerTokenUsdc: toE6(
    process.env['MAINNET_MAX_CAPITAL_PER_TOKEN_USDC'] ?? '50',
  ),
  maxTotalCollateralUsdc: toE6(
    process.env['MAINNET_MAX_TOTAL_COLLATERAL_USDC'] ?? '350',
  ),
  maxCumulativeDrawdownUsdc: toE6(
    process.env['MAINNET_MAX_DRAWDOWN_USDC'] ?? '75',
  ),
  maxGasPriceGwei: Number.parseFloat(
    process.env['MAINNET_MAX_GAS_PRICE_GWEI'] ?? '80',
  ),
  spreadCaptureBps: Number.parseInt(
    process.env['MAINNET_SPREAD_CAPTURE_BPS'] ?? '40',
    10,
  ),
};

// ── Bootstrap Lifecycle Parameters ───────────────────────────────────────────

export const BOOTSTRAP_CONFIG = {
  totalDurationMinutes: Number.parseInt(
    process.env['BOOTSTRAP_DURATION_MINUTES'] ?? '60',
    10,
  ),
  hypePhaseMinutes: Number.parseInt(
    process.env['BOOTSTRAP_HYPE_PHASE_MINUTES'] ?? '15',
    10,
  ),
  discoveryPhaseMinutes: Number.parseInt(
    process.env['BOOTSTRAP_DISCOVERY_PHASE_MINUTES'] ?? '30',
    10,
  ),
  maxConcurrentBootstraps: Number.parseInt(
    process.env['BOOTSTRAP_MAX_CONCURRENT'] ?? '12',
    10,
  ),
  restingOrdersPerToken: Number.parseInt(
    process.env['BOOTSTRAP_RESTING_ORDERS'] ?? '2',
    10,
  ),
};

// ── General Service Parameters ───────────────────────────────────────────────

export const SERVICE_PORT = Number.parseInt(
  process.env['BOT_METRICS_PORT'] ?? '3025',
  10,
);
export const MAINTENANCE_INTERVAL_MS = Number.parseInt(
  process.env['MAINTENANCE_INTERVAL_MS'] ?? '45000',
  10,
);
export const DASHBOARD_PRINT_INTERVAL_MS = Number.parseInt(
  process.env['DASHBOARD_INTERVAL_MS'] ?? '10000',
  10,
);
