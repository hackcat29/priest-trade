export type Side = 'Long' | 'Short';
export type OrderSide = 'Bid' | 'Ask';
export type MarketCategory = 'Primary' | 'Secondary';

export interface ApiMeta {
  cursor: string | null;
  nextCursor: string | null;
  limit: number;
  serverTime: string;
}

export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}

export interface MarketSummaryView {
  /** 'monad-testnet' | 'monad' */
  chain?: string;
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  status: string;
  riskTier: string;
  markPrice: string;
  referencePrice: string;
  indexPrice?: string;
  lastPrice?: string;
  bookMidPrice?: string;
  oracleLastPrice?: string;
  longOi: string;
  shortOi: string;
  totalOi: string;
  skew: string;
  volume24h: string;
  priceChange1h: string;
  priceChange24h: string;
  fundingRate: string;
  premiumTwapBps?: string;
  oracleAction?: string;
  maturityStage?: number;
  spotWeightBps?: number;
  bookWeightBps?: number;
  nextFundingAt: string | null;
  maxLeverage: number;
  graduationLevel: number;
  graduationProgress: string;
  featured: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  category: MarketCategory;
  executionEngine: 'vAMM' | 'SecondaryAMM' | 'HybridDLOB';
  isBluechip: boolean;
  graduated: boolean;
  raydiumPool: string | null;
  /** Monad graduation spot pool: the Uniswap v4 PoolId (null before graduation). */
  spotPoolId?: string | null;
  spotVenue?: 'raydium' | 'uniswap-v4' | 'uniswap-v3' | null;
  /** 'listed': perps on an existing token (Monad); 'launched': created on Perpes. */
  origin?: 'launched' | 'listed';
  /** How an oracle market is priced on-chain. */
  oracleSource?: 'uniswap-v3-twap' | 'uniswap-v4-ema' | null;
  /** The market's Counterflow vault holds cash: it's deeper and its winners are paid from the vault. */
  counterflowBacked?: boolean;
  /** The market's own Counterflow vault (EVM oracle markets; null elsewhere). */
  lpVault?: string | null;
  /** Fees earned by the market's Counterflow LPs so far (USDC, 2 dp). */
  lpFeesUsdc?: string;
  /** Share of the creator's fee cut (bps) they route into the vault. */
  creatorLpBps?: number;
  spotAvailable: boolean;
  /** False when market is in Transition mode (graduation approved but Raydium LP not yet added/burned). */
  tradeable?: boolean;
  /** Weighted spot reference used by secondary markets. */
  spotReferencePrice?: string | null;
  /** Raydium pool price TWAP for secondary markets. */
  raydiumPrice?: string | null;
  // Metadata for discovery and cards
  creatorName: string;
  creatorHandle: string;
  creatorAvatarLabel: string;
  creatorAvatarColor: string;
  tags: string[];
  liveNow: boolean;
  roomName: string;
  velocityScore: number;
  liquidationCount24h: number;
  // Token metadata
  imageUri?: string | null;
  description?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
}

export interface UserPortfolioSummary {
  wallet: string;
  freeCollateral: string;
  totalDeposited: string;
  totalWithdrawn: string;
  vaultBalance: string;
  totalRealizedPnl: string;
  totalUnrealizedPnl: string;
  totalAccountValue: string;
  positionsCount: number;
  openNotional: string;
  healthRatio: string;
}

export interface UserPositionView {
  id: string | number;
  owner: string;
  market: string;
  side: string;
  size: string;
  notional: string;
  collateral: string;
  entryPrice: string;
  markPrice: string;
  liqPrice: string;
  leverage: string;
  unrealizedPnl: string;
  realizedPnl: string;
  fundingPaid: string;
  marginRatio: string;
  status: string;
  openedAt: string | null;
  closedAt: string | null;
  tpPrice: string | null;
  slPrice: string | null;
  pendingLiquidation: boolean;
}

export interface LaunchJobView {
  id: string;
  creator: string;
  reservedMint: string | null;
  mediaUri: string | null;
  status: string;
  estimatedCost: string | null;
  launchTx: string | null;
  error: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PointsBreakdownView {
  epochId: string;
  tradingPoints: string;
  feePoints: string;
  oiPoints: string;
  vaultPoints: string;
  creatorPoints: string;
  affiliatePoints: string;
  totalPoints: string;
}
