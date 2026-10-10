import type { Address } from 'viem';
import { MAINNET_CONFIG } from '../config';
import { predictVammPrice, sampleOrganicNotional } from '../math-utils';
import type { RiskGuard } from '../risk-guard';
import type { TradeAction, TradeResult } from '../types';
import type { WalletPool } from '../wallet-pool';
import type { IStrategy, StrategyContext } from './base-strategy';

interface PendingUnwind {
  token: Address;
  walletIndex: number;
  side: 0 | 1;
  sizeUsdc: bigint;
  entryPriceE6: bigint;
  openedAt: number;
  scheduledCloseAt: number;
}

export class MainnetStrategy implements IStrategy {
  public readonly name = 'MainnetBreakEvenLiquidityStrategy';

  // Queue of open positions waiting to be unwound delta-neutrally
  private pendingUnwinds: PendingUnwind[] = [];

  constructor(
    private readonly walletPool: WalletPool,
    private readonly riskGuard: RiskGuard,
  ) {}

  public async generateTrade(
    context: StrategyContext,
  ): Promise<TradeAction | null> {
    const { token, currentMarkPriceE6, vammQuoteReserve, vammBaseReserve, isBootstrap, bootstrapPhase } =
      context;

    // 1. Check for scheduled unwinds (positions due to be closed to restore delta neutrality)
    const now = Date.now();
    const readyUnwindIndex = this.pendingUnwinds.findIndex(
      (u) => u.token.toLowerCase() === token.toLowerCase() && now >= u.scheduledCloseAt,
    );

    if (readyUnwindIndex !== -1) {
      const unwind = this.pendingUnwinds[readyUnwindIndex]!;
      this.pendingUnwinds.splice(readyUnwindIndex, 1);

      // Verify the wallet still has this position
      const walletItem = this.walletPool.getWalletByIndex(unwind.walletIndex);
      if (walletItem) {
        return {
          actionType: 'close',
          token,
          walletIndex: unwind.walletIndex,
          side: unwind.side,
          collateralUsdc: 0n,
          notionalUsdc: unwind.sizeUsdc,
          leverage: MAINNET_CONFIG.defaultLeverage,
          maxSlippageBps: MAINNET_CONFIG.maxSlippageBps,
        };
      }
    }

    // 2. Propose a new micro-trade
    // Check if risk guard allows new positions on this token
    const notionalUsdc = sampleOrganicNotional(
      MAINNET_CONFIG.notionalMinUsdc,
      MAINNET_CONFIG.notionalMaxUsdc,
    );
    const leverage = MAINNET_CONFIG.defaultLeverage;
    const collateralUsdc = notionalUsdc / BigInt(leverage);

    const guardCheck = this.riskGuard.canOpenPosition(token, collateralUsdc);
    if (!guardCheck.allowed) {
      return null;
    }

    // 3. Determine directional bias
    // In Launch Spark phase (first ~15m): 65% Buy bias to create green candles
    // In Later phases: Mean-revert towards initial launch price
    let targetSide: 0 | 1 = 0;
    if (isBootstrap && bootstrapPhase === 'spark') {
      targetSide = Math.random() < 0.65 ? 0 : 1;
    } else {
      // Alternate or random 50/50
      targetSide = Math.random() < 0.5 ? 0 : 1;
    }

    // Predict price impact on vAMM: reject if impact > 40 bps
    const { priceImpactBps } = predictVammPrice(
      vammQuoteReserve,
      vammBaseReserve,
      notionalUsdc,
      targetSide === 0,
    );
    if (priceImpactBps > 50) {
      // Impact too high for break-even trading, scale down notional
      return null;
    }

    // Find compatible wallet
    const feeUsdc = notionalUsdc / 1000n; // 10 bps taker fee
    const trader = this.walletPool.getAvailableTrader(
      token,
      targetSide,
      collateralUsdc + feeUsdc,
    );

    if (!trader) {
      return null;
    }

    // Schedule automatic delta-neutral unwind in 20 - 60 seconds
    const holdDurationMs = 20_000 + Math.floor(Math.random() * 40_000);
    this.pendingUnwinds.push({
      token,
      walletIndex: trader.index,
      side: targetSide,
      sizeUsdc: notionalUsdc,
      entryPriceE6: currentMarkPriceE6,
      openedAt: now,
      scheduledCloseAt: now + holdDurationMs,
    });

    return {
      actionType: 'open',
      token,
      walletIndex: trader.index,
      side: targetSide,
      collateralUsdc,
      notionalUsdc,
      leverage,
      maxSlippageBps: MAINNET_CONFIG.maxSlippageBps,
    };
  }

  /**
   * Generates dual-sided maker limit orders around the mark price
   * to capture the bid-ask spread and offset taker fees.
   */
  public async generateLimitOrders(
    context: StrategyContext,
  ): Promise<TradeAction[]> {
    const { token, currentMarkPriceE6 } = context;
    if (currentMarkPriceE6 === 0n) return [];

    const actions: TradeAction[] = [];
    const spreadBps = BigInt(MAINNET_CONFIG.spreadCaptureBps);

    // 1. Bid Limit Order: Mark Price - spreadCaptureBps
    const bidPriceE6 = (currentMarkPriceE6 * (10_000n - spreadBps)) / 10_000n;
    const bidNotional = sampleOrganicNotional(
      MAINNET_CONFIG.notionalMinUsdc,
      MAINNET_CONFIG.notionalMaxUsdc,
    );
    const bidCollateral = bidNotional / BigInt(MAINNET_CONFIG.defaultLeverage);

    const bidTrader = this.walletPool.getAvailableTrader(token, 0, bidCollateral);
    if (bidTrader) {
      actions.push({
        actionType: 'limit_order',
        token,
        walletIndex: bidTrader.index,
        side: 0,
        collateralUsdc: bidCollateral,
        notionalUsdc: bidNotional,
        leverage: MAINNET_CONFIG.defaultLeverage,
        maxSlippageBps: MAINNET_CONFIG.maxSlippageBps,
        limitPriceE6: bidPriceE6,
      });
    }

    // 2. Ask Limit Order: Mark Price + spreadCaptureBps
    const askPriceE6 = (currentMarkPriceE6 * (10_000n + spreadBps)) / 10_000n;
    const askNotional = sampleOrganicNotional(
      MAINNET_CONFIG.notionalMinUsdc,
      MAINNET_CONFIG.notionalMaxUsdc,
    );
    const askCollateral = askNotional / BigInt(MAINNET_CONFIG.defaultLeverage);

    const askTrader = this.walletPool.getAvailableTrader(token, 1, askCollateral);
    if (askTrader) {
      actions.push({
        actionType: 'limit_order',
        token,
        walletIndex: askTrader.index,
        side: 1,
        collateralUsdc: askCollateral,
        notionalUsdc: askNotional,
        leverage: MAINNET_CONFIG.defaultLeverage,
        maxSlippageBps: MAINNET_CONFIG.maxSlippageBps,
        limitPriceE6: askPriceE6,
      });
    }

    return actions;
  }

  public async handleTradeResult(result: TradeResult): Promise<void> {
    // If trade failed, clean up any matching pending unwind
    if (!result.success) {
      const idx = this.pendingUnwinds.findIndex(
        (u) => u.token.toLowerCase() === result.token.toLowerCase(),
      );
      if (idx !== -1) {
        this.pendingUnwinds.splice(idx, 1);
      }
    }
  }
}
