import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  MarketItem,
  PositionItem,
  LimitOrderItem,
  CandleDataPoint,
  OrderBookData,
  FeedPostItem,
  LiveStreamItem,
  CopyLeaderItem,
} from './types';

export const API_BASE = 'https://api.priest.trade/api/v1';

// Seeded fallback markets used during offline or network initialization
export const SEED_FALLBACK_MARKETS: MarketItem[] = [
  {
    mint: 'H5uBqCoaNSQhurCh7MkX2e4e6CzTxN6DfKKvGoGxz9hM',
    symbol: 'ORBT',
    name: 'Orbit',
    price: 1.0302,
    priceChange24h: 34.8,
    volume24h: 4289000,
    openInterest: 1850000,
    fundingRate: 0.00012,
    fundingCountdownSeconds: 1140,
    engine: 'SecondaryAMM',
    chain: 'solana',
    graduationVolumeTarget: 2000000,
    graduationVolumeCurrent: 2000000,
    graduationPercent: 100,
    isWarmup: false,
    maxLeverage: 10,
    high24h: 1.085,
    low24h: 0.985,
    imageUri: 'https://api.perpes.fun/uploads/launch/e9bbd8cd-a4e6-4354-a9c3-9553e6d91c44/e7489fd9-b6f1-4271-9f55-7b8619bc4bb1.jpg',
    description: 'Sunrise and airglow over Earth’s limb. Production market on Solana.',
    creatorHandle: '@75Ffzx',
  },
  {
    mint: '9ePunu57KaTk7amf9y2ncgQChTZEgPo4gMtJBuoX5f5j',
    symbol: 'GRID',
    name: 'Night Grid',
    price: 1.0302,
    priceChange24h: 18.4,
    volume24h: 1650000,
    openInterest: 740000,
    fundingRate: 0.00008,
    fundingCountdownSeconds: 1140,
    engine: 'SecondaryAMM',
    chain: 'solana',
    graduationVolumeTarget: 2000000,
    graduationVolumeCurrent: 1650000,
    graduationPercent: 82.5,
    isWarmup: false,
    maxLeverage: 10,
    high24h: 1.072,
    low24h: 0.991,
    imageUri: 'https://api.perpes.fun/uploads/launch/030d514d-abe0-4bc3-8e35-dadf3aa563af/cf935234-49ba-4ed1-885b-f4014b624783.jpg',
    description: 'A coastal city at night from low Earth orbit. Production market on Solana.',
    creatorHandle: '@75Ffzx',
  },
  {
    mint: 'GhvcWBdTVme2KfyPWMTgoRJbYhuWp762brXA4VTXMyUP',
    symbol: 'LIFT',
    name: 'Liftoff',
    price: 1.0302,
    priceChange24h: -4.12,
    volume24h: 980000,
    openInterest: 410000,
    fundingRate: -0.00005,
    fundingCountdownSeconds: 1140,
    engine: 'SecondaryAMM',
    chain: 'solana',
    graduationVolumeTarget: 2000000,
    graduationVolumeCurrent: 980000,
    graduationPercent: 49.0,
    isWarmup: false,
    maxLeverage: 10,
    high24h: 1.06,
    low24h: 0.97,
    imageUri: 'https://api.perpes.fun/uploads/launch/bf46d693-b63a-4b9a-9350-c8bff921ea99/4f925f6f-a53f-42c2-a0d6-1f4a153b6904.jpg',
    description: 'Apollo 7 on the pad the night before launch, 1968. Production market on Solana.',
    creatorHandle: '@75Ffzx',
  },
  {
    mint: 'F19MnZnw41KwKRwdUUTy9N8rcg2JKy5Yf7kLK5rteRic',
    symbol: 'AURA',
    name: 'Aurora',
    price: 1.0302,
    priceChange24h: 64.2,
    volume24h: 1980000,
    openInterest: 890000,
    fundingRate: 0.00035,
    fundingCountdownSeconds: 1140,
    engine: 'SecondaryAMM',
    chain: 'solana',
    graduationVolumeTarget: 2000000,
    graduationVolumeCurrent: 1980000,
    graduationPercent: 99.0,
    isWarmup: false,
    maxLeverage: 10,
    high24h: 1.12,
    low24h: 0.95,
    imageUri: 'https://api.perpes.fun/uploads/launch/a125a036-7270-44bc-8956-d4ea755807db/487bed4b-989d-4f49-ae01-acc21ff4ce28.jpg',
    description: 'Northern lights over the Pacific, shot from the ISS. Production market on Solana.',
    creatorHandle: '@75Ffzx',
  },
  {
    mint: '0xcc3936cf3afd4b8823521d960fe1a646c0d8df30',
    symbol: 'ORBT',
    name: 'Orbit',
    price: 1.0303,
    priceChange24h: 34.8,
    volume24h: 3120000,
    openInterest: 1420000,
    fundingRate: 0.00015,
    fundingCountdownSeconds: 1140,
    engine: 'SecondaryAMM',
    chain: 'monad',
    graduationVolumeTarget: 2000000,
    graduationVolumeCurrent: 2000000,
    graduationPercent: 100,
    isWarmup: false,
    maxLeverage: 10,
    high24h: 1.09,
    low24h: 0.98,
    imageUri: 'https://api.perpes.fun/uploads/launch/e9bbd8cd-a4e6-4354-a9c3-9553e6d91c44/e7489fd9-b6f1-4271-9f55-7b8619bc4bb1.jpg',
    description: 'Production market deployed on Monad Testnet.',
    creatorHandle: '@0xe789',
  },
  {
    mint: '0x3d894679e5a9d90ca1554c0e64c3c3a9f0f9b329',
    symbol: 'GRID',
    name: 'Night Grid',
    price: 1.0201,
    priceChange24h: 18.2,
    volume24h: 1450000,
    openInterest: 620000,
    fundingRate: 0.00009,
    fundingCountdownSeconds: 1140,
    engine: 'SecondaryAMM',
    chain: 'monad',
    graduationVolumeTarget: 2000000,
    graduationVolumeCurrent: 1450000,
    graduationPercent: 72.5,
    isWarmup: false,
    maxLeverage: 10,
    high24h: 1.07,
    low24h: 0.99,
    imageUri: 'https://api.perpes.fun/uploads/launch/030d514d-abe0-4bc3-8e35-dadf3aa563af/cf935234-49ba-4ed1-885b-f4014b624783.jpg',
    description: 'Night Grid deployed on Monad Testnet.',
    creatorHandle: '@0xe789',
  },
  {
    mint: '0x28b16174fb31adcaac6c90558b8f21dae6c276be',
    symbol: 'LISTD',
    name: 'Listing Demo',
    price: 0.5000,
    priceChange24h: 5.4,
    volume24h: 680000,
    openInterest: 290000,
    fundingRate: 0.00010,
    fundingCountdownSeconds: 1140,
    engine: 'vAMM',
    chain: 'monad',
    graduationVolumeTarget: 2000000,
    graduationVolumeCurrent: 680000,
    graduationPercent: 34.0,
    isWarmup: true,
    maxLeverage: 10,
    high24h: 0.52,
    low24h: 0.48,
    description: 'Community listing on Monad Testnet.',
    creatorHandle: '@0xe789',
  },
];

export const MOCK_MARKETS = SEED_FALLBACK_MARKETS;

// Maps backend Raw API market DTO into typed MarketItem
function mapRawMarketToItem(raw: any): MarketItem {
  const markPrice = parseFloat(raw.markPrice ?? raw.lastPrice ?? raw.referencePrice ?? '1.0');
  const price = isNaN(markPrice) || markPrice <= 0 ? 1.0 : markPrice;
  const vol = parseFloat(raw.volume24h ?? '0');
  const oi = parseFloat(raw.totalOi ?? raw.longOi ?? '0');
  const change = parseFloat(raw.priceChange24h ?? '0');
  const funding = parseFloat(raw.fundingRate ?? '0');
  const rawGrad = parseFloat(raw.graduationProgress ?? '0');
  const gradPercent = rawGrad > 1 ? rawGrad : rawGrad * 100;

  let engine: MarketItem['engine'] = 'vAMM';
  if (raw.executionEngine === 'SecondaryAMM') engine = 'SecondaryAMM';
  else if (raw.executionEngine === 'HybridDLOB') engine = 'HybridDLOB';
  else if (raw.category === 'Secondary') engine = 'SecondaryAMM';

  const isMonad = raw.chain ? String(raw.chain).toLowerCase().includes('monad') : false;

  return {
    mint: raw.mint || `mint_${Math.random().toString(36).slice(2, 8)}`,
    symbol: (raw.symbol || 'PERP').toUpperCase(),
    name: raw.name || raw.symbol || 'Perp Token',
    price,
    priceChange24h: isNaN(change) ? 0 : change,
    volume24h: isNaN(vol) ? 0 : vol,
    openInterest: isNaN(oi) ? 0 : oi,
    fundingRate: isNaN(funding) ? 0 : funding,
    fundingCountdownSeconds: 1200,
    engine,
    chain: isMonad ? 'monad' : 'solana',
    graduationVolumeTarget: 2000000,
    graduationVolumeCurrent: isNaN(vol) ? 0 : vol,
    graduationPercent: Math.min(100, Math.max(0, isNaN(gradPercent) ? 0 : gradPercent)),
    isWarmup: raw.riskTier === 'warmup' || (raw.maxLeverage && Number(raw.maxLeverage) <= 10),
    maxLeverage: raw.maxLeverage ? Math.min(40, Number(raw.maxLeverage)) : 20,
    high24h: raw.high24h ? parseFloat(raw.high24h) : price * 1.05,
    low24h: raw.low24h ? parseFloat(raw.low24h) : price * 0.95,
    imageUri: raw.imageUri || undefined,
    description: raw.description || raw.about || undefined,
    creatorHandle: raw.creatorHandle || (raw.creator ? `@${String(raw.creator).slice(0, 6)}` : undefined),
    creatorAvatarColor: raw.creatorAvatarColor || undefined,
  };
}

const CACHED_MARKETS_KEY = 'priest_cached_live_markets';

/**
 * Production-grade Live Market Fetcher
 * Hits GET https://api.priest.trade/api/v1/markets
 * Falls back to offline AsyncStorage cache and seed state seamlessly.
 */
export async function fetchLiveMarkets(chainFilter?: 'solana' | 'monad' | 'all'): Promise<MarketItem[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    const apiChain =
      chainFilter === 'monad' ? 'monad-testnet' : chainFilter === 'solana' ? 'solana' : 'all';

    const query = new URLSearchParams({
      limit: '50',
      chain: apiChain,
    });

    const res = await fetch(`${API_BASE}/markets?${query.toString()}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      const rawMarkets = json?.data || (Array.isArray(json) ? json : []);
      if (Array.isArray(rawMarkets) && rawMarkets.length > 0) {
        const mapped = rawMarkets.map(mapRawMarketToItem);
        // Persist to cache
        AsyncStorage.setItem(CACHED_MARKETS_KEY, JSON.stringify(mapped)).catch(() => {});
        return mapped;
      }
    }
  } catch (err) {
    // Network error or timeout: load from cache
  }

  // Attempt to load previously cached live markets
  try {
    const cached = await AsyncStorage.getItem(CACHED_MARKETS_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (!chainFilter || chainFilter === 'all') return parsed;
        return parsed.filter((m: MarketItem) => m.chain === chainFilter);
      }
    }
  } catch {}

  // Fallback to seeded markets
  return SEED_FALLBACK_MARKETS.filter((m) => {
    if (!chainFilter || chainFilter === 'all') return true;
    return m.chain === chainFilter;
  });
}

/**
 * Fetch detailed live market metadata (including risk engine, orderbook, creators)
 */
export async function fetchLiveMarketDetail(mint: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_BASE}/markets/${mint}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      return json?.data || json;
    }
  } catch {}
  return null;
}

/**
 * Fetch live order book depth directly from the backend vAMM/DLOB engine
 */
export async function fetchLiveOrderBook(mint: string, midPrice = 1.0): Promise<OrderBookData> {
  try {
    const res = await fetch(`${API_BASE}/markets/${mint}/depth`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      const data = json?.data || json;
      if (data && Array.isArray(data.bids) && Array.isArray(data.asks)) {
        let bidAccum = 0;
        const bids = data.bids.slice(0, 10).map((b: any) => {
          const sz = Math.round(parseFloat(b.size || '1') * 100) / 100;
          bidAccum += sz;
          return {
            price: parseFloat(b.price),
            size: sz,
            total: Math.round(bidAccum * 100) / 100,
          };
        });

        let askAccum = 0;
        const asks = data.asks.slice(0, 10).map((a: any) => {
          const sz = Math.round(parseFloat(a.size || '1') * 100) / 100;
          askAccum += sz;
          return {
            price: parseFloat(a.price),
            size: sz,
            total: Math.round(askAccum * 100) / 100,
          };
        });

        const topAsk = asks[0]?.price ?? midPrice * 1.002;
        const topBid = bids[0]?.price ?? midPrice * 0.998;
        const spread = Math.abs(topAsk - topBid);
        const spreadPercent = (spread / (midPrice || 1)) * 100;

        return {
          bids: bids.length > 0 ? bids : generateOrderBook(midPrice).bids,
          asks: asks.length > 0 ? asks : generateOrderBook(midPrice).asks,
          spread,
          spreadPercent,
        };
      }
    }
  } catch {}

  // Fallback to synthetic orderbook derived from current spot price
  return generateOrderBook(midPrice);
}

/**
 * Fetch live OHLCV candlestick bars from the candle engine
 */
export async function fetchLiveCandles(
  mint: string,
  resolution = '5m',
  limit = 35,
  basePrice = 1.0
): Promise<CandleDataPoint[]> {
  try {
    const res = await fetch(`${API_BASE}/markets/${mint}/candles?resolution=${resolution}&limit=${limit}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      const rawCandles = json?.data || (Array.isArray(json) ? json : []);
      if (Array.isArray(rawCandles) && rawCandles.length > 0) {
        return rawCandles.map((c: any) => ({
          time: new Date(c.time || c.ts).getTime(),
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          volume: parseFloat(c.volume || '1000'),
        }));
      }
    }
  } catch {}

  // Fallback to generated realistic candles centered on basePrice
  return generateCandles(basePrice, limit);
}

export interface LiveTradeItem {
  id: string;
  side: 'Long' | 'Short';
  price: number;
  size: string;
  time: string;
  isWhale: boolean;
  trader: string;
  txSignature?: string;
}

/**
 * Fetch live trade execution history from the backend DLOB/vAMM engine
 */
export async function fetchLiveTrades(
  mint: string,
  limit = 20,
  fallbackPrice = 1.0302
): Promise<LiveTradeItem[]> {
  try {
    const res = await fetch(`${API_BASE}/markets/${mint}/trades?limit=${limit}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      const rawTrades = json?.data || (Array.isArray(json) ? json : []);
      if (Array.isArray(rawTrades) && rawTrades.length > 0) {
        return rawTrades.map((t: any, i: number) => {
          const sz = parseFloat(t.size || '100');
          const pr = parseFloat(t.price || String(fallbackPrice));
          const notional = sz * pr;
          const dt = t.timestamp ? new Date(t.timestamp) : new Date();
          const diffSec = Math.max(1, Math.floor((Date.now() - dt.getTime()) / 1000));
          const timeStr =
            diffSec < 60
              ? `${diffSec}s ago`
              : diffSec < 3600
              ? `${Math.floor(diffSec / 60)}m ago`
              : `${Math.floor(diffSec / 3600)}h ago`;

          return {
            id: t.id || `trade-${i}`,
            side: (t.side || 'Long') === 'Short' ? 'Short' : 'Long',
            price: isNaN(pr) ? fallbackPrice : pr,
            size: sz.toLocaleString('en-US', { maximumFractionDigits: 2 }),
            time: timeStr,
            isWhale: notional > 500,
            trader: t.trader ? `${t.trader.slice(0, 4)}...${t.trader.slice(-4)}` : 'Trader',
            txSignature: t.txSignature || undefined,
          };
        });
      }
    }
  } catch {}

  // Fallback synthetic live ticker tape based on current spot mark
  return [
    { id: 't-1', side: 'Long', price: fallbackPrice, size: '25,000', time: '14s ago', isWhale: true, trader: '75Ff...Si4' },
    { id: 't-2', side: 'Long', price: fallbackPrice * 0.999, size: '4,800', time: '48s ago', isWhale: false, trader: '8xLm...K9p' },
    { id: 't-3', side: 'Short', price: fallbackPrice * 1.001, size: '12,200', time: '1m ago', isWhale: false, trader: '0xe7...3674' },
    { id: 't-4', side: 'Long', price: fallbackPrice * 0.998, size: '60,000', time: '3m ago', isWhale: true, trader: '3KzM...9pW' },
  ];
}

/**
 * Fetch global protocol statistics (Total OI, 24h Vol, Market Cap)
 */
export async function fetchGlobalStats(chain?: string): Promise<{
  totalOi: number;
  totalVolume24h: number;
  totalMarkets: number;
  marketCap: number;
}> {
  try {
    const query = chain && chain !== 'all' ? `?chain=${chain}` : '';
    const res = await fetch(`${API_BASE}/markets/stats${query}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      const data = json?.data || json;
      return {
        totalOi: parseFloat(data.totalOi || '600'),
        totalVolume24h: parseFloat(data.totalVolume24h || '0'),
        totalMarkets: parseInt(data.totalMarkets || '4', 10),
        marketCap: parseFloat(data.marketCap || '600'),
      };
    }
  } catch {}

  return {
    totalOi: 600.0,
    totalVolume24h: 12450000.0,
    totalMarkets: 9,
    marketCap: 4500000.0,
  };
}

/**
 * Fetch live social alpha feed from backend
 */
export async function fetchLiveFeed(): Promise<FeedPostItem[]> {
  try {
    const res = await fetch(`${API_BASE}/feed?limit=30`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      const posts = json?.data?.posts || json?.data || [];
      if (Array.isArray(posts) && posts.length > 0) {
        return posts.map((p: any) => ({
          id: p.id || `post_${Math.random()}`,
          authorName: p.author?.name || p.authorAddress || 'Priest Trader',
          authorHandle: p.author?.handle || `@${(p.authorAddress || '').slice(0, 6)}`,
          authorAvatar: p.author?.avatarUrl || undefined,
          timestamp: 'Just now',
          body: p.body || p.content || '',
          sentiment: (p.sentiment || 'bullish').toLowerCase() as 'bullish' | 'bearish' | 'neutral',
          likes: p.likesCount || 0,
          comments: p.commentsCount || 0,
          isLiked: false,
        }));
      }
    }
  } catch {}

  return INITIAL_POSTS;
}

/**
 * Fetch live copy trading leaders and rankings
 */
export async function fetchLiveLeaders(range = 'all'): Promise<CopyLeaderItem[]> {
  try {
    const res = await fetch(`${API_BASE}/copy-trading/leaders?range=${range}&limit=20`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      const leaders = json?.data || [];
      if (Array.isArray(leaders) && leaders.length > 0) {
        return leaders.map((l: any, i: number) => ({
          id: l.wallet || `lead-${i}`,
          handle: l.handle || `@${(l.wallet || '').slice(0, 6)}`,
          name: l.name || l.handle || `Lead Trader #${i + 1}`,
          roi7d: parseFloat(l.roi || '0'),
          roi30d: parseFloat(l.roi || '0') * 1.5,
          winRate: parseFloat(l.winRate || '78.5'),
          copiersCount: l.followerCount || Math.floor(Math.random() * 500 + 50),
          aumUsd: parseFloat(l.aum || '50000'),
          maxDrawdown: parseFloat(l.maxDrawdown || '6.5'),
          pnlTotalUsd: parseFloat(l.pnl || '12500'),
          isCopying: i === 0,
        }));
      }
    }
  } catch {}

  return INITIAL_COPY_LEADERS;
}

// Initial Mock Positions
export const INITIAL_POSITIONS: PositionItem[] = [
  {
    id: 'pos-1',
    mint: 'H5uBqCoaNSQhurCh7MkX2e4e6CzTxN6DfKKvGoGxz9hM',
    symbol: 'ORBT',
    side: 'Long',
    entryPrice: 0.985,
    markPrice: 1.0302,
    size: 2500,
    leverage: 10,
    collateralUsd: 250,
    pnlUsd: 113.0,
    roePercent: 45.2,
    liquidationPrice: 0.895,
    openedAt: '2h ago',
  },
  {
    id: 'pos-2',
    mint: '9ePunu57KaTk7amf9y2ncgQChTZEgPo4gMtJBuoX5f5j',
    symbol: 'GRID',
    side: 'Short',
    entryPrice: 1.055,
    markPrice: 1.0302,
    size: 1500,
    leverage: 10,
    collateralUsd: 150,
    pnlUsd: 35.25,
    roePercent: 23.5,
    liquidationPrice: 1.155,
    openedAt: '5h ago',
  },
];

// Initial Feed Posts
export const INITIAL_POSTS: FeedPostItem[] = [
  {
    id: '1',
    authorName: 'Satoshi Nakamoto',
    authorHandle: '@satoshi',
    timestamp: '12m ago',
    body: 'Just deployed another $25k into $ORBT long on Priest. Volume is accelerating towards Uniswap v4 graduation!',
    sentiment: 'bullish',
    pnlCard: {
      symbol: 'ORBT',
      side: 'Long',
      leverage: 10,
      roePercent: 151.2,
      pnlUsd: 378.0,
      entryPrice: 0.985,
      markPrice: 1.0302,
      skin: 'cyberpunk',
    },
    likes: 142,
    comments: 28,
    isLiked: false,
  },
  {
    id: '2',
    authorName: 'CryptoCobie',
    authorHandle: '@cobie',
    timestamp: '45m ago',
    body: 'The 10x warmup cap on newly launched vAMM coins is the smartest risk engine feature in CT. No instant -99% wick rug pulls.',
    sentiment: 'bullish',
    likes: 389,
    comments: 45,
    isLiked: true,
  },
  {
    id: '3',
    authorName: 'Sarah Jenkins',
    authorHandle: '@sarahtrades',
    timestamp: '2h ago',
    body: 'Watching $GRID consolidate near $1.03. If spot TWAP breaks past $1.05 we enter massive short squeeze territory.',
    sentiment: 'bearish',
    pnlCard: {
      symbol: 'GRID',
      side: 'Short',
      leverage: 10,
      roePercent: 44.8,
      pnlUsd: 67.2,
      entryPrice: 1.055,
      markPrice: 1.0302,
      skin: 'aurora',
    },
    likes: 88,
    comments: 12,
    isLiked: false,
  },
];

// Active Live Streams anchored directly to real production markets
export const INITIAL_STREAMS: LiveStreamItem[] = [
  {
    id: 'stream-1',
    title: 'High Leverage Scalping $ORBT to Uniswap v4 Pool Graduation',
    roomName: 'priest-stage-orbit',
    streamerName: 'CryptoCobie',
    streamerHandle: '@cobie',
    viewers: 1420,
    tokenSymbol: 'ORBT',
    tokenPrice: 1.0302,
    tokenChange: 34.8,
    mint: 'H5uBqCoaNSQhurCh7MkX2e4e6CzTxN6DfKKvGoGxz9hM',
    isLive: true,
  },
  {
    id: 'stream-2',
    title: 'Night Grid $GRID DLOB Depth & Order Book Analysis',
    roomName: 'priest-stage-grid',
    streamerName: 'Sarah Jenkins',
    streamerHandle: '@sarahtrades',
    viewers: 890,
    tokenSymbol: 'GRID',
    tokenPrice: 1.0302,
    tokenChange: 18.4,
    mint: '9ePunu57KaTk7amf9y2ncgQChTZEgPo4gMtJBuoX5f5j',
    isLive: true,
  },
  {
    id: 'stream-3',
    title: 'Aurora $AURA 40x Moonshot Trading Room',
    roomName: 'priest-stage-aurora',
    streamerName: 'Alex Thorne',
    streamerHandle: '@alexthorne',
    viewers: 615,
    tokenSymbol: 'AURA',
    tokenPrice: 1.0302,
    tokenChange: 64.2,
    mint: 'F19MnZnw41KwKRwdUUTy9N8rcg2JKy5Yf7kLK5rteRic',
    isLive: true,
  },
  {
    id: 'stream-4',
    title: 'Liftoff $LIFT Primary vAMM Liquidity Engine Breakdown',
    roomName: 'priest-stage-liftoff',
    streamerName: 'Monad Chad',
    streamerHandle: '@monad_chad',
    viewers: 430,
    tokenSymbol: 'LIFT',
    tokenPrice: 1.0302,
    tokenChange: -4.12,
    mint: 'GhvcWBdTVme2KfyPWMTgoRJbYhuWp762brXA4VTXMyUP',
    isLive: true,
  },
];

export const INITIAL_COPY_LEADERS: CopyLeaderItem[] = [
  {
    id: 'lead-1',
    handle: 'dr_leverage',
    name: 'Dr. Leverage',
    roi7d: 318.5,
    roi30d: 940.2,
    winRate: 84.5,
    copiersCount: 1240,
    aumUsd: 285000,
    maxDrawdown: 6.8,
    pnlTotalUsd: 84200,
    isCopying: true,
  },
  {
    id: 'lead-2',
    handle: 'monad_chad',
    name: 'Monad Chad',
    roi7d: 184.2,
    roi30d: 460.0,
    winRate: 79.1,
    copiersCount: 890,
    aumUsd: 172000,
    maxDrawdown: 9.4,
    pnlTotalUsd: 42100,
  },
  {
    id: 'lead-3',
    handle: 'funding_harvester',
    name: 'Delta Neutral King',
    roi7d: 42.8,
    roi30d: 168.4,
    winRate: 96.0,
    copiersCount: 650,
    aumUsd: 420000,
    maxDrawdown: 2.1,
    pnlTotalUsd: 31500,
  },
];

// Generates realistic candlestick data for charts
export function generateCandles(basePrice: number, count = 30): CandleDataPoint[] {
  const candles: CandleDataPoint[] = [];
  let current = basePrice * 0.92;
  const now = Date.now();
  const stepMs = 60 * 1000 * 5; // 5 min candles

  for (let i = count; i >= 0; i--) {
    const time = now - i * stepMs;
    const variation = (Math.random() - 0.46) * (basePrice * 0.03);
    const open = current;
    const close = Math.max(0.0001, current + variation);
    const high = Math.max(open, close) + Math.random() * (basePrice * 0.012);
    const low = Math.max(0.0001, Math.min(open, close) - Math.random() * (basePrice * 0.012));
    const volume = Math.floor(Math.random() * 50000 + 10000);

    candles.push({
      time,
      open: Number(open.toFixed(4)),
      high: Number(high.toFixed(4)),
      low: Number(low.toFixed(4)),
      close: Number(close.toFixed(4)),
      volume,
    });
    current = close;
  }
  return candles;
}

// Generates synthetic Order Book depth
export function generateOrderBook(midPrice: number): OrderBookData {
  const bids = [];
  const asks = [];
  let bidAccum = 0;
  let askAccum = 0;

  for (let i = 1; i <= 7; i++) {
    const bidPrice = midPrice * (1 - i * 0.002);
    const bidSize = Math.floor((Math.random() * 5000 + 1000) * (8 - i));
    bidAccum += bidSize;
    bids.push({
      price: Number(bidPrice.toFixed(4)),
      size: bidSize,
      total: bidAccum,
    });

    const askPrice = midPrice * (1 + i * 0.002);
    const askSize = Math.floor((Math.random() * 5000 + 1000) * (8 - i));
    askAccum += askSize;
    asks.push({
      price: Number(askPrice.toFixed(4)),
      size: askSize,
      total: askAccum,
    });
  }

  const spread = asks[0].price - bids[0].price;
  const spreadPercent = (spread / midPrice) * 100;

  return {
    bids,
    asks,
    spread,
    spreadPercent,
  };
}

// Local Storage Keys
const POSITIONS_KEY = 'priest_mobile_positions';
const POSTS_KEY = 'priest_mobile_posts';

export async function getStoredPositions(): Promise<PositionItem[]> {
  try {
    const data = await AsyncStorage.getItem(POSITIONS_KEY);
    return data ? JSON.parse(data) : INITIAL_POSITIONS;
  } catch {
    return INITIAL_POSITIONS;
  }
}

export async function saveStoredPositions(positions: PositionItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
  } catch {}
}

export async function getStoredPosts(): Promise<FeedPostItem[]> {
  try {
    const data = await AsyncStorage.getItem(POSTS_KEY);
    return data ? JSON.parse(data) : INITIAL_POSTS;
  } catch {
    return INITIAL_POSTS;
  }
}

export async function saveStoredPosts(posts: FeedPostItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(POSTS_KEY, JSON.stringify(posts));
  } catch {}
}
