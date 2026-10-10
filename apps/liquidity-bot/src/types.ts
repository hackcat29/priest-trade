import type { Address, Hex } from 'viem';
import type { EvmChainKey } from '@perpes/evm';

export type BotMode = 'testnet' | 'mainnet';

export type BootstrapPhase = 'spark' | 'discovery' | 'steady';

export interface MarketInfo {
  token: Address;
  creator: Address;
  symbol: string;
  name: string;
  launchedAt: number;
  markPriceE6: bigint;
  status: number;
  maxLeverageX: number;
  vammQuoteReserve: bigint;
  vammBaseReserve: bigint;
}

export interface BootstrapState {
  token: Address;
  symbol: string;
  name: string;
  creator: Address;
  startedAt: number;
  phase: BootstrapPhase;
  tradesCount: number;
  totalVolumeUsdc: bigint;
  lastTradeAt: number;
  sentimentBias: number; // between -1.0 (bearish) and +1.0 (bullish)
  targetPriceE6?: bigint;
  initialPriceE6: bigint;
  activeOrders: bigint[];
}

export interface TradeAction {
  actionType: 'open' | 'close' | 'limit_order' | 'cancel_order';
  token: Address;
  walletIndex: number;
  side: 0 | 1; // 0 = Long, 1 = Short
  collateralUsdc: bigint;
  notionalUsdc: bigint;
  leverage: number;
  maxSlippageBps: number;
  limitPriceE6?: bigint;
  orderId?: bigint;
}

export interface TradeResult {
  success: boolean;
  actionType: string;
  token: Address;
  trader: Address;
  txHash?: Hex | undefined;
  error?: string | undefined;
  gasUsed?: bigint | undefined;
  effectiveGasPrice?: bigint | undefined;
  executionPriceE6?: bigint | undefined;
  payoutUsdc?: bigint | undefined;
  timestamp: number;
}

export interface SubWalletInfo {
  index: number;
  address: Address;
  privateKey: Hex;
  monBalance: bigint;
  usdcBalance: bigint;
  hasUsdcAllowance: boolean;
  nonce: number;
  activePositionsCount: number;
}

export interface BotMetrics {
  mode: BotMode;
  chain: EvmChainKey;
  engineAddress: Address;
  uptimeSeconds: number;
  totalTradesExecuted: number;
  successfulTrades: number;
  failedTrades: number;
  totalVolumeUsdcE6: bigint;
  realizedPnlUsdcE6: bigint;
  unrealizedPnlUsdcE6: bigint;
  netPnlUsdcE6: bigint;
  totalGasSpentWei: bigint;
  totalFeesPaidUsdcE6: bigint;
  activeBootstrapsCount: number;
  totalMarketsTracked: number;
  walletsCount: number;
  circuitBreakerTripped: boolean;
  circuitBreakerReason?: string;
}
