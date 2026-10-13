export type ChainType = 'solana' | 'monad';
export type EngineType = 'vAMM' | 'SecondaryAMM' | 'HybridDLOB';
export type OrderSide = 'Long' | 'Short';
export type OrderType = 'market' | 'limit';

export interface MarketItem {
  mint: string;
  symbol: string;
  name: string;
  icon?: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  openInterest: number;
  fundingRate: number; // e.g. 0.0001 = 0.01%
  fundingCountdownSeconds: number;
  engine: EngineType;
  chain: ChainType;
  graduationVolumeTarget: number;
  graduationVolumeCurrent: number;
  graduationPercent: number;
  isWarmup: boolean;
  maxLeverage: number;
  high24h: number;
  low24h: number;
  imageUri?: string;
  description?: string;
  creatorHandle?: string;
  creatorAvatarColor?: string;
}

export interface PositionItem {
  id: string;
  mint: string;
  symbol: string;
  side: OrderSide;
  entryPrice: number;
  markPrice: number;
  size: number;
  leverage: number;
  collateralUsd: number;
  pnlUsd: number;
  roePercent: number;
  liquidationPrice: number;
  openedAt: string;
}

export interface LimitOrderItem {
  id: string;
  mint: string;
  symbol: string;
  side: OrderSide;
  price: number;
  size: number;
  leverage: number;
  placedAt: string;
}

export interface CandleDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookEntry {
  price: number;
  size: number;
  total: number;
}

export interface OrderBookData {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
  spreadPercent: number;
}

export interface FeedPostItem {
  id: string;
  authorHandle: string;
  authorName: string;
  authorAvatar?: string;
  badge?: string;
  timestamp: string;
  body: string;
  sentiment?: 'bullish' | 'bearish' | 'neutral';
  likes: number;
  comments: number;
  isLiked?: boolean;
  pnlCard?: {
    symbol: string;
    side: OrderSide;
    roePercent: number;
    pnlUsd: number;
    entryPrice: number;
    markPrice: number;
    leverage: number;
    skin?: 'aurora' | 'cyberpunk' | 'obsidian' | 'matrix';
  };
}

export interface LiveStreamItem {
  id: string;
  title: string;
  roomName: string;
  streamerName: string;
  streamerHandle: string;
  streamerAvatar?: string;
  mint: string;
  tokenSymbol: string;
  tokenPrice: number;
  tokenChange: number;
  viewers: number;
  isLive: boolean;
}

export interface CopyLeaderItem {
  id: string;
  handle: string;
  name: string;
  avatar?: string;
  roi7d: number;
  roi30d: number;
  winRate: number;
  copiersCount: number;
  aumUsd: number;
  maxDrawdown: number;
  pnlTotalUsd: number;
  isCopying?: boolean;
}

export interface WalletState {
  isConnected: boolean;
  address: string | null;
  displayAddress: string;
  chain: ChainType;
  usdcBalance: number;
  solBalance: number;
  monBalance: number;
  netEquityUsd: number;
  unrealizedPnlUsd: number;
  freeCollateralUsd: number;
  marginHealthPercent: number;
  authMethod: 'privy' | 'phantom' | 'metamask' | 'demo' | null;
}
