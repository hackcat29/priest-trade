import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { MarketItem, PositionItem, LimitOrderItem, WalletState, OrderSide } from '../lib/types';
import { MOCK_MARKETS, getStoredPositions, saveStoredPositions, fetchLiveMarkets } from '../lib/api';

interface PriestContextType {
  wallet: WalletState;
  connectWallet: (method: 'privy' | 'phantom' | 'metamask' | 'demo') => void;
  disconnectWallet: () => void;
  switchChain: (chain: 'monad' | 'monad') => void;
  markets: MarketItem[];
  selectedMarket: MarketItem;
  setSelectedMarket: (market: MarketItem) => void;
  positions: PositionItem[];
  openPosition: (params: {
    mint: string;
    symbol: string;
    side: OrderSide;
    sizeUsd: number;
    leverage: number;
    entryPrice: number;
  }) => { success: boolean; error?: string };
  closePosition: (positionId: string) => void;
  openOrders: LimitOrderItem[];
  cancelOrder: (orderId: string) => void;
  copyLeader: (leaderId: string) => void;
  activePnlShare: PositionItem | null;
  setActivePnlShare: (pos: PositionItem | null) => void;
  updateBalances: (usdcDelta: number, solDelta?: number, monDelta?: number) => void;
  refreshMarkets: () => Promise<void>;
  isLoadingMarkets: boolean;
}

const DEFAULT_WALLET: WalletState = {
  isConnected: true,
  address: '0x88c42C67B271b80c592D23c58A5964AfA44137Fb',
  displayAddress: '0x88c4...37Fb',
  chain: 'monad',
  usdcBalance: 2450.0,
  solBalance: 14.85,
  monBalance: 120.0,
  netEquityUsd: 2671.5,
  unrealizedPnlUsd: 221.5,
  freeCollateralUsd: 2245.0,
  marginHealthPercent: 92.4,
  authMethod: 'privy',
};

const PriestContext = createContext<PriestContextType | null>(null);

export function PriestProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>(DEFAULT_WALLET);
  const [markets, setMarkets] = useState<MarketItem[]>(MOCK_MARKETS);
  const [selectedMarket, setSelectedMarket] = useState<MarketItem>(MOCK_MARKETS[0]);
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(false);
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [openOrders, setOpenOrders] = useState<LimitOrderItem[]>([
    {
      id: 'ord-1',
      mint: '0xdCb4FbCdebBeB3C3D1233EDDBFE21e086acE923d',
      symbol: 'MON',
      side: 'Long',
      price: 0.075,
      size: 10000,
      leverage: 20,
      placedAt: '10m ago',
    },
  ]);
  const [activePnlShare, setActivePnlShare] = useState<PositionItem | null>(null);

  const loadMarkets = useCallback(async (chain?: 'solana' | 'monad' | 'all') => {
    setIsLoadingMarkets(true);
    try {
      const live = await fetchLiveMarkets(chain);
      if (live && live.length > 0) {
        setMarkets(live);
        setSelectedMarket((prev) => {
          const match = live.find((m) => m.mint === prev.mint);
          return match || live[0];
        });
      }
    } catch {} finally {
      setIsLoadingMarkets(false);
    }
  }, []);

  const refreshMarkets = useCallback(async () => {
    await loadMarkets(wallet.chain);
  }, [loadMarkets, wallet.chain]);

  useEffect(() => {
    void loadMarkets(wallet.chain);
    const interval = setInterval(() => {
      void loadMarkets(wallet.chain);
    }, 20000);
    return () => clearInterval(interval);
  }, [loadMarkets, wallet.chain]);

  useEffect(() => {
    getStoredPositions().then((stored) => {
      setPositions(stored);
    });
  }, []);

  const connectWallet = (method: 'privy' | 'phantom' | 'metamask' | 'demo') => {
    const address =
      method === 'metamask'
        ? '0x88c42C...37Fb'
        : '7xKXtg...Josg';

    setWallet({
      isConnected: true,
      address,
      displayAddress: address,
      chain: method === 'metamask' ? 'monad' : 'solana',
      usdcBalance: 3200.0,
      solBalance: 22.4,
      monBalance: 450.0,
      netEquityUsd: 3421.5,
      unrealizedPnlUsd: 221.5,
      freeCollateralUsd: 2995.0,
      marginHealthPercent: 95.0,
      authMethod: method,
    });
  };

  const disconnectWallet = () => {
    setWallet({
      isConnected: false,
      address: null,
      displayAddress: 'Connect Wallet',
      chain: 'monad',
      usdcBalance: 0,
      solBalance: 0,
      monBalance: 0,
      netEquityUsd: 0,
      unrealizedPnlUsd: 0,
      freeCollateralUsd: 0,
      marginHealthPercent: 100,
      authMethod: null,
    });
  };

  const switchChain = (chain: 'monad' | 'monad') => {
    setWallet((prev) => ({
      ...prev,
      chain,
    }));
    void loadMarkets(chain);
  };

  const openPosition = ({
    mint,
    symbol,
    side,
    sizeUsd,
    leverage,
    entryPrice,
  }: {
    mint: string;
    symbol: string;
    side: OrderSide;
    sizeUsd: number;
    leverage: number;
    entryPrice: number;
  }) => {
    const collateralUsd = sizeUsd / leverage;
    if (collateralUsd > wallet.freeCollateralUsd) {
      return { success: false, error: 'Insufficient free USDC collateral' };
    }

    const tokenUnits = sizeUsd / entryPrice;
    // Estimated liquidation price
    const liqDistance = (entryPrice * 0.9) / leverage;
    const liquidationPrice =
      side === 'Long'
        ? Math.max(0.0001, entryPrice - liqDistance)
        : entryPrice + liqDistance;

    const newPos: PositionItem = {
      id: `pos-${Date.now()}`,
      mint,
      symbol,
      side,
      entryPrice,
      markPrice: entryPrice,
      size: Math.round(tokenUnits),
      leverage,
      collateralUsd,
      pnlUsd: 0.0,
      roePercent: 0.0,
      liquidationPrice: Number(liquidationPrice.toFixed(4)),
      openedAt: 'Just now',
    };

    const updated = [newPos, ...positions];
    setPositions(updated);
    saveStoredPositions(updated);

    // Update wallet balance
    setWallet((prev) => ({
      ...prev,
      freeCollateralUsd: prev.freeCollateralUsd - collateralUsd,
    }));

    return { success: true };
  };

  const closePosition = (positionId: string) => {
    const pos = positions.find((p) => p.id === positionId);
    if (!pos) return;

    const updated = positions.filter((p) => p.id !== positionId);
    setPositions(updated);
    saveStoredPositions(updated);

    // Return collateral + pnl
    setWallet((prev) => ({
      ...prev,
      usdcBalance: prev.usdcBalance + pos.collateralUsd + pos.pnlUsd,
      freeCollateralUsd: prev.freeCollateralUsd + pos.collateralUsd + pos.pnlUsd,
    }));
  };

  const cancelOrder = (orderId: string) => {
    setOpenOrders((prev) => prev.filter((o) => o.id !== orderId));
  };

  const copyLeader = (leaderId: string) => {
    // 1-tap copy simulation
  };

  const updateBalances = (usdcDelta: number, solDelta = 0, monDelta = 0) => {
    setWallet((prev) => ({
      ...prev,
      usdcBalance: Math.max(0, prev.usdcBalance + usdcDelta),
      solBalance: Math.max(0, prev.solBalance + solDelta),
      monBalance: Math.max(0, prev.monBalance + monDelta),
      netEquityUsd: Math.max(0, prev.netEquityUsd + usdcDelta),
      freeCollateralUsd: Math.max(0, prev.freeCollateralUsd + usdcDelta),
    }));
  };

  return (
    <PriestContext.Provider
      value={{
        wallet,
        connectWallet,
        disconnectWallet,
        switchChain,
        markets,
        selectedMarket,
        setSelectedMarket,
        positions,
        openPosition,
        closePosition,
        openOrders,
        cancelOrder,
        copyLeader,
        activePnlShare,
        setActivePnlShare,
        updateBalances,
        refreshMarkets,
        isLoadingMarkets,
      }}
    >
      {children}
    </PriestContext.Provider>
  );
}

export function usePriest() {
  const ctx = useContext(PriestContext);
  if (!ctx) {
    throw new Error('usePriest must be used within a PriestProvider');
  }
  return ctx;
}
