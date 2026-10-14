import { defineChain, type Address, type Chain } from 'viem';

import { recordedDeployments } from './generated/deployments';

export { perpesEngineAbi, perpesTokenAbi, mockUsdcAbi, counterflowVaultAbi } from './generated/abi';

// ── Chains ────────────────────────────────────────────────────────────────────

export const monadTestnet = defineChain({
  id: 10_143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' } },
  testnet: true,
});

export const monadMainnet = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'], webSocket: ['wss://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: 'https://monadvision.com' } },
});

/**
 * Supported Monad chains for Priest.trade. One deployment (beta, prod) serves
 * a subset of these — see NEXT_PUBLIC_CHAINS / EVM_CHAIN.
 */
export type PerpesChainId = 'monad-testnet' | 'monad';
export type EvmChainKey = PerpesChainId;

export const EVM_CHAINS: Record<EvmChainKey, Chain> = {
  'monad-testnet': monadTestnet,
  monad: monadMainnet,
};

/** Alchemy's Monad endpoint for `chain`. */
export function alchemyMonadRpcUrl(chain: EvmChainKey, apiKey: string): string {
  return `https://monad-${chain === 'monad' ? 'mainnet' : 'testnet'}.g.alchemy.com/v2/${apiKey}`;
}

/**
 * The RPC a backend service talks to: an explicit URL (EVM_RPC_URL), else
 * Alchemy when an API key is set (ALCHEMY_API_KEY), else the public endpoint.
 */
export function evmRpcUrl(chain: EvmChainKey, opts: { rpcUrl?: string | undefined; alchemyApiKey?: string | undefined } = {}): string {
  const explicit = opts.rpcUrl?.trim();
  if (explicit) return explicit;
  const key = opts.alchemyApiKey?.trim();
  if (key) return alchemyMonadRpcUrl(chain, key);
  return EVM_CHAINS[chain].rpcUrls.default.http[0]!;
}

export function isEvmChainKey(value: string | null | undefined): value is EvmChainKey {
  return value === 'monad-testnet' || value === 'monad';
}

export function evmChainKeyFromId(chainId: number): EvmChainKey | null {
  if (chainId === monadTestnet.id) return 'monad-testnet';
  if (chainId === monadMainnet.id) return 'monad';
  return null;
}

/** Monad mainnet's native Circle USDC. */
export const MONAD_MAINNET_USDC: Address = '0x754704bc059f8c67012fed69bc8a327a5aafb603';

export interface EvmDeployment {
  chain: EvmChainKey;
  chainId: number;
  engine: Address;
  usdc: Address;
  /** True when `usdc` is the testnet MockUSDC with a public faucet(). */
  mockUsdc: boolean;
  deployBlock: number;
  /** Uniswap v4 that graduated markets seed their spot pool on (null until recorded). */
  poolManager: Address | null;
  positionManager: Address | null;
  /** Uniswap v3 factory listings may use, and WMON (null where the chain has none). */
  v3Factory: Address | null;
  wmon: Address | null;
  /** Beacon behind every market's Counterflow vault (null until deployed); a
   *  market's own vault is `engine.lpVault(token)`. */
  counterflowBeacon: Address | null;
}

/**
 * The deployment for a chain: what contracts/evm recorded, overridable by env
 * (EVM_ENGINE_ADDRESS / NEXT_PUBLIC_EVM_ENGINE_ADDRESS etc.) via `overrides`.
 */
export function getEvmDeployment(
  chain: EvmChainKey,
  overrides: Partial<Pick<EvmDeployment, 'engine' | 'usdc' | 'deployBlock'>> = {},
): EvmDeployment | null {
  const chainId = EVM_CHAINS[chain].id;
  const recorded = recordedDeployments[chainId];
  const engine = overrides.engine ?? recorded?.engine;
  const usdc = overrides.usdc ?? recorded?.usdc ?? (chain === 'monad' ? MONAD_MAINNET_USDC : undefined);
  if (!engine || !usdc) return null;
  return {
    chain,
    chainId,
    engine: engine.toLowerCase() as Address,
    usdc: usdc.toLowerCase() as Address,
    mockUsdc: recorded?.mockUsdc ?? false,
    deployBlock: overrides.deployBlock ?? recorded?.deployBlock ?? 0,
    poolManager: recorded?.poolManager ?? null,
    positionManager: recorded?.positionManager ?? null,
    v3Factory: recorded?.v3Factory ?? null,
    wmon: recorded?.wmon ?? null,
    counterflowBeacon: recorded?.counterflowBeacon ?? null,
  };
}

// ── Graduation (Uniswap v4) ───────────────────────────────────────────────────

/**
 * Uniswap app links for a graduated market's spot pool. Only Monad mainnet uses
 * Uniswap's own deployment; testnet's v4 is self-deployed, so the app can't see it.
 */
export function uniswapSwapUrl(chain: EvmChainKey, token: string, usdc: string): string | null {
  if (chain !== 'monad') return null;
  return `https://app.uniswap.org/swap?chain=monad&inputCurrency=${usdc}&outputCurrency=${token}`;
}

/** `pool`: a v4 PoolId (32 bytes) or a v3 pool address. */
export function uniswapPoolUrl(chain: EvmChainKey, pool: string): string | null {
  if (chain !== 'monad' || !/^0x([0-9a-fA-F]{64}|[0-9a-fA-F]{40})$/.test(pool)) return null;
  const poolId = pool;
  return `https://app.uniswap.org/explore/pools/monad/${poolId}`;
}

// ── Engine enums (match PerpesEngine.sol) ─────────────────────────────────────

export const Side = { Long: 0, Short: 1 } as const;
export type SideName = keyof typeof Side;
export const sideName = (side: number): SideName => (side === 0 ? 'Long' : 'Short');

export const MarketStatus = ['None', 'Warmup', 'Active', 'Graduated', 'Delisted'] as const;
export type MarketStatusName = (typeof MarketStatus)[number];

export const OrderType = {
  Limit: 0,
  StopMarket: 1,
  StopLimit: 2,
  TakeProfit: 3,
  ImmediateOrCancel: 4,
  FillOrKill: 5,
} as const;
export type OrderTypeName = keyof typeof OrderType;
export const orderTypeName = (value: number): OrderTypeName =>
  (Object.keys(OrderType) as OrderTypeName[]).find((k) => OrderType[k] === value) ?? 'Limit';

export const OrderStatus = ['None', 'Open', 'PartiallyFilled', 'Filled', 'Cancelled'] as const;

/** Where an oracle market's price comes from (PerpesEngine.SourceKind). */
export const SourceKind = { V4: 0, V3: 1, Kuru: 2 } as const;

/** Kuru (Monad's on-chain order book), which listings may be priced from. */
export const KURU_MAINNET_ROUTER: Address = '0xd651346d7c789536ebf06dc72ae3c8502cd695cc';

/** Kuru app link for a market (order book) address. */
export function kuruMarketUrl(chain: EvmChainKey, market: string): string | null {
  if (chain !== 'monad' || !isEvmAddress(market)) return null;
  return `https://www.kuru.io/markets/${market.toLowerCase()}`;
}
export type OrderStatusName = (typeof OrderStatus)[number];

// ── Units ────────────────────────────────────────────────────────────────────

/** USDC, prices and base are all 6-decimal on the engine, like the Solana program. */
export const E6 = 1_000_000n;

export function toE6(value: number | string): bigint {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.round(n * 1e6));
}

export function fromE6(value: bigint | number | string): number {
  return Number(BigInt(value)) / 1e6;
}

/** Lowercased address — the canonical form in the DB, Redis channels and URLs. */
export function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

export function isEvmAddress(value: string | null | undefined): value is Address {
  return !!value && /^0x[0-9a-fA-F]{40}$/.test(value);
}
