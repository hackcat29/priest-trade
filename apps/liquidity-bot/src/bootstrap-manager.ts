import type { Address } from 'viem';
import { BOOTSTRAP_CONFIG, BOT_MODE, MAINNET_CONFIG, TESTNET_CONFIG } from './config';
import type { ExecutionEngine } from './execution-engine';
import { formatPrice, formatUsdc, samplePoissonInterval } from './math-utils';
import type { RiskGuard } from './risk-guard';
import type { IStrategy, StrategyContext } from './strategies/base-strategy';
import type { BootstrapPhase, BootstrapState, MarketInfo, TradeAction } from './types';
import type { WalletPool } from './wallet-pool';

export class BootstrapManager {
  private activeBootstraps = new Map<Address, BootstrapState>();
  private activeTimers = new Map<Address, NodeJS.Timeout>();

  constructor(
    private readonly walletPool: WalletPool,
    private readonly executionEngine: ExecutionEngine,
    private readonly strategy: IStrategy,
    private readonly riskGuard: RiskGuard,
  ) {}

  public registerNewLaunch(market: MarketInfo): void {
    const tokenLower = market.token.toLowerCase() as Address;
    if (this.activeBootstraps.has(tokenLower)) {
      return;
    }

    if (
      this.activeBootstraps.size >= BOOTSTRAP_CONFIG.maxConcurrentBootstraps
    ) {
      console.warn(
        `⚠️ [BootstrapManager] Max concurrent bootstraps (${BOOTSTRAP_CONFIG.maxConcurrentBootstraps}) reached. Skipping ${market.symbol}`,
      );
      return;
    }

    const state: BootstrapState = {
      token: market.token,
      symbol: market.symbol,
      name: market.name,
      creator: market.creator,
      startedAt: Date.now(),
      phase: 'spark',
      tradesCount: 0,
      totalVolumeUsdc: 0n,
      lastTradeAt: 0,
      sentimentBias: 0.6, // early bullish bias
      initialPriceE6: market.markPriceE6,
      activeOrders: [],
    };

    this.activeBootstraps.set(tokenLower, state);

    console.log(
      `🌟 [BootstrapManager] Initiating Bootstrap Protocol for ${state.symbol} (${state.token}) by ${state.creator}`,
    );
    console.log(
      `⚡ [BootstrapManager] Phase 1 (Spark Momentum): High cadence, bullish skew, order book seeding`,
    );

    // Seed initial resting limit orders
    this.seedInitialOrders(state).catch((err) => {
      console.warn(`[BootstrapManager] Seed orders error:`, (err as Error).message);
    });

    // Schedule first trade
    this.scheduleNextTick(state);
  }

  public getActiveBootstraps(): BootstrapState[] {
    return Array.from(this.activeBootstraps.values());
  }

  public isBootstrapping(token: Address): boolean {
    return this.activeBootstraps.has(token.toLowerCase() as Address);
  }

  public stopAll(): void {
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.activeBootstraps.clear();
  }

  private scheduleNextTick(state: BootstrapState): void {
    const tokenLower = state.token.toLowerCase() as Address;
    if (!this.activeBootstraps.has(tokenLower)) return;

    // Calculate elapsed time & phase
    const elapsedMs = Date.now() - state.startedAt;
    const elapsedMinutes = elapsedMs / (60 * 1000);

    if (elapsedMinutes >= BOOTSTRAP_CONFIG.totalDurationMinutes) {
      console.log(
        `🏁 [BootstrapManager] Bootstrap finished for ${state.symbol}! Generated ${state.tradesCount} trades and ${formatUsdc(state.totalVolumeUsdc)} volume.`,
      );
      this.activeBootstraps.delete(tokenLower);
      const existingTimer = this.activeTimers.get(tokenLower);
      if (existingTimer) clearTimeout(existingTimer);
      this.activeTimers.delete(tokenLower);
      return;
    }

    // Determine current phase
    let phase: BootstrapPhase = 'spark';
    let meanIntervalMs = 4500;
    let minIntervalMs = 2000;
    let maxIntervalMs = 9000;

    if (elapsedMinutes < BOOTSTRAP_CONFIG.hypePhaseMinutes) {
      phase = 'spark';
      meanIntervalMs = BOT_MODE === 'mainnet' ? 9000 : 3500;
      minIntervalMs = BOT_MODE === 'mainnet' ? 5000 : 1500;
      maxIntervalMs = BOT_MODE === 'mainnet' ? 18000 : 7000;
    } else if (
      elapsedMinutes <
      BOOTSTRAP_CONFIG.hypePhaseMinutes + BOOTSTRAP_CONFIG.discoveryPhaseMinutes
    ) {
      phase = 'discovery';
      meanIntervalMs = BOT_MODE === 'mainnet' ? 22000 : 8000;
      minIntervalMs = BOT_MODE === 'mainnet' ? 12000 : 4000;
      maxIntervalMs = BOT_MODE === 'mainnet' ? 38000 : 16000;
    } else {
      phase = 'steady';
      meanIntervalMs = BOT_MODE === 'mainnet' ? 45000 : 18000;
      minIntervalMs = BOT_MODE === 'mainnet' ? 25000 : 8000;
      maxIntervalMs = BOT_MODE === 'mainnet' ? 80000 : 35000;
    }

    state.phase = phase;

    const delayMs = samplePoissonInterval(
      meanIntervalMs,
      minIntervalMs,
      maxIntervalMs,
    );

    const timer = setTimeout(async () => {
      try {
        await this.executeTick(state);
      } catch (err) {
        console.warn(
          `⚠️ [BootstrapManager] Tick error on ${state.symbol}:`,
          (err as Error).message,
        );
      } finally {
        this.scheduleNextTick(state);
      }
    }, delayMs);

    this.activeTimers.set(tokenLower, timer);
  }

  private async executeTick(state: BootstrapState): Promise<void> {
    const market = await this.executionEngine.fetchMarketState(state.token);
    if (!market) return;

    this.riskGuard.monitorPriceShock(state.token, market.markPriceE6);

    const context: StrategyContext = {
      token: state.token,
      symbol: state.symbol,
      isBootstrap: true,
      bootstrapPhase: state.phase,
      elapsedBootstrapMs: Date.now() - state.startedAt,
      currentMarkPriceE6: market.markPriceE6,
      vammQuoteReserve: market.vammQuoteReserve,
      vammBaseReserve: market.vammBaseReserve,
    };

    const action = await this.strategy.generateTrade(context);
    if (!action) return;

    await this.dispatchTradeAction(action, state, market);
  }

  private async dispatchTradeAction(
    action: TradeAction,
    state: BootstrapState,
    market: MarketInfo,
  ): Promise<void> {
    const walletItem = this.walletPool.getWalletByIndex(action.walletIndex);
    if (!walletItem) return;

    if (action.actionType === 'open') {
      const result = await this.executionEngine.executeOpenPosition(
        walletItem.wallet,
        walletItem.info.address,
        action.token,
        action.side,
        action.collateralUsdc,
        action.notionalUsdc,
        action.maxSlippageBps,
      );

      await this.strategy.handleTradeResult(result);

      if (result.success) {
        state.tradesCount += 1;
        state.totalVolumeUsdc += action.notionalUsdc;
        state.lastTradeAt = Date.now();

        const sideStr = action.side === 0 ? '🟢 LONG' : '🔴 SHORT';
        const priceStr = result.executionPriceE6
          ? formatPrice(result.executionPriceE6)
          : formatPrice(market.markPriceE6);

        console.log(
          `✨ [Bootstrap ${state.symbol}] ${sideStr} ${formatUsdc(action.notionalUsdc)} @ ${priceStr} by Wallet #${walletItem.info.index} (${walletItem.info.address.slice(0, 8)}...)`,
        );

        this.walletPool.recordPositionOpen(
          walletItem.info.address,
          action.token,
          action.side,
          action.notionalUsdc,
          action.collateralUsdc,
        );

        const fee = action.notionalUsdc / 1000n;
        this.riskGuard.recordOpen(
          action.token,
          action.collateralUsdc,
          action.notionalUsdc,
          fee,
        );
        if (result.gasUsed && result.effectiveGasPrice) {
          this.riskGuard.recordGasSpent(result.gasUsed * result.effectiveGasPrice);
        }
      } else {
        console.warn(
          `❌ [Bootstrap ${state.symbol}] Open failed:`,
          result.error?.slice(0, 100),
        );
      }
    } else if (action.actionType === 'close') {
      const result = await this.executionEngine.executeClosePosition(
        walletItem.wallet,
        walletItem.info.address,
        action.token,
        action.notionalUsdc,
        action.maxSlippageBps,
      );

      await this.strategy.handleTradeResult(result);

      if (result.success) {
        state.tradesCount += 1;
        state.totalVolumeUsdc += action.notionalUsdc;
        state.lastTradeAt = Date.now();

        const pnl = result.realizedPnlUsdc ?? 0n;
        const pnlStr = formatUsdc(pnl);

        console.log(
          `🔄 [Bootstrap ${state.symbol}] CLOSED ${formatUsdc(action.notionalUsdc)} (PnL: ${pnlStr}) by Wallet #${walletItem.info.index}`,
        );

        this.walletPool.recordPositionClose(
          walletItem.info.address,
          action.token,
          action.notionalUsdc,
          result.payoutUsdc ?? 0n,
        );

        const fee = action.notionalUsdc / 1000n;
        this.riskGuard.recordClose(
          action.token,
          action.collateralUsdc,
          action.notionalUsdc,
          pnl,
          fee,
        );
        if (result.gasUsed && result.effectiveGasPrice) {
          this.riskGuard.recordGasSpent(result.gasUsed * result.effectiveGasPrice);
        }
      } else {
        console.warn(
          `❌ [Bootstrap ${state.symbol}] Close failed:`,
          result.error?.slice(0, 100),
        );
      }
    }
  }

  private async seedInitialOrders(state: BootstrapState): Promise<void> {
    const market = await this.executionEngine.fetchMarketState(state.token);
    if (!market || market.markPriceE6 === 0n) return;

    const context: StrategyContext = {
      token: state.token,
      symbol: state.symbol,
      isBootstrap: true,
      bootstrapPhase: 'spark',
      currentMarkPriceE6: market.markPriceE6,
      vammQuoteReserve: market.vammQuoteReserve,
      vammBaseReserve: market.vammBaseReserve,
    };

    const orders = await this.strategy.generateLimitOrders(context);
    for (const order of orders) {
      if (order.limitPriceE6) {
        const walletItem = this.walletPool.getWalletByIndex(order.walletIndex);
        if (walletItem) {
          const res = await this.executionEngine.executePlaceLimitOrder(
            walletItem.wallet,
            walletItem.info.address,
            order.token,
            order.side,
            order.collateralUsdc,
            order.leverage,
            order.limitPriceE6,
            true, // postOnly
            0n,   // no expiry
          );
          if (res.success && res.orderId) {
            state.activeOrders.push(res.orderId);
            console.log(
              `📖 [Bootstrap ${state.symbol}] Seeded Limit Order #${res.orderId} (${order.side === 0 ? 'BID' : 'ASK'} @ ${formatPrice(order.limitPriceE6)})`,
            );
          }
        }
      }
    }
  }
}
