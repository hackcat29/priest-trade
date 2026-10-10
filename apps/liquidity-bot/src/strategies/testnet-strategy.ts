import type { Address } from 'viem';
import { TESTNET_CONFIG } from '../config';
import { sampleOrganicNotional } from '../math-utils';
import type { TradeAction, TradeResult } from '../types';
import type { WalletPool } from '../wallet-pool';
import type { IStrategy, StrategyContext } from './base-strategy';

export class TestnetStrategy implements IStrategy {
  public readonly name = 'TestnetUnconstrainedLiquidityStrategy';

  constructor(private readonly walletPool: WalletPool) {}

  public async generateTrade(
    context: StrategyContext,
  ): Promise<TradeAction | null> {
    const { token, isBootstrap, bootstrapPhase } = context;

    // Check if we should close an existing position to recycle capital
    const walletWithPos = this.walletPool.getWalletWithPosition(token);
    const shouldClose =
      walletWithPos &&
      walletWithPos.position.sizeUsdc > 0n &&
      Math.random() < 0.35; // 35% chance to close when an open position exists

    if (shouldClose && walletWithPos) {
      return {
        actionType: 'close',
        token,
        walletIndex: walletWithPos.index,
        side: walletWithPos.position.side as 0 | 1,
        collateralUsdc: 0n,
        notionalUsdc: walletWithPos.position.sizeUsdc,
        leverage: TESTNET_CONFIG.defaultLeverage,
        maxSlippageBps: TESTNET_CONFIG.maxSlippageBps,
      };
    }

    // Determine target side:
    // In Launch Spark phase: 75% Long bias to pump initial chart excitement!
    let side: 0 | 1 = 0;
    if (isBootstrap && bootstrapPhase === 'spark') {
      side = Math.random() < 0.75 ? 0 : 1;
    } else {
      side = Math.random() < 0.5 ? 0 : 1;
    }

    const notionalUsdc = sampleOrganicNotional(
      TESTNET_CONFIG.notionalMinUsdc,
      TESTNET_CONFIG.notionalMaxUsdc,
    );
    const leverage = TESTNET_CONFIG.defaultLeverage;
    const collateralUsdc = notionalUsdc / BigInt(leverage);

    const trader = this.walletPool.getAvailableTrader(
      token,
      side,
      collateralUsdc + notionalUsdc / 1000n, // collateral + fee
    );

    if (!trader) {
      return null;
    }

    return {
      actionType: 'open',
      token,
      walletIndex: trader.index,
      side,
      collateralUsdc,
      notionalUsdc,
      leverage,
      maxSlippageBps: TESTNET_CONFIG.maxSlippageBps,
    };
  }

  public async generateLimitOrders(
    context: StrategyContext,
  ): Promise<TradeAction[]> {
    const { token, currentMarkPriceE6 } = context;
    if (currentMarkPriceE6 === 0n) return [];

    const actions: TradeAction[] = [];

    // Place a bid limit order ~1.5% below mark
    const bidPriceE6 = (currentMarkPriceE6 * 9850n) / 10000n;
    const bidNotional = sampleOrganicNotional(
      TESTNET_CONFIG.notionalMinUsdc,
      TESTNET_CONFIG.notionalMaxUsdc,
    );
    const bidCollateral = bidNotional / BigInt(TESTNET_CONFIG.defaultLeverage);

    const bidTrader = this.walletPool.getAvailableTrader(
      token,
      0,
      bidCollateral,
    );
    if (bidTrader) {
      actions.push({
        actionType: 'limit_order',
        token,
        walletIndex: bidTrader.index,
        side: 0,
        collateralUsdc: bidCollateral,
        notionalUsdc: bidNotional,
        leverage: TESTNET_CONFIG.defaultLeverage,
        maxSlippageBps: TESTNET_CONFIG.maxSlippageBps,
        limitPriceE6: bidPriceE6,
      });
    }

    // Place an ask limit order ~1.5% above mark
    const askPriceE6 = (currentMarkPriceE6 * 10150n) / 10000n;
    const askNotional = sampleOrganicNotional(
      TESTNET_CONFIG.notionalMinUsdc,
      TESTNET_CONFIG.notionalMaxUsdc,
    );
    const askCollateral = askNotional / BigInt(TESTNET_CONFIG.defaultLeverage);

    const askTrader = this.walletPool.getAvailableTrader(
      token,
      1,
      askCollateral,
    );
    if (askTrader) {
      actions.push({
        actionType: 'limit_order',
        token,
        walletIndex: askTrader.index,
        side: 1,
        collateralUsdc: askCollateral,
        notionalUsdc: askNotional,
        leverage: TESTNET_CONFIG.defaultLeverage,
        maxSlippageBps: TESTNET_CONFIG.maxSlippageBps,
        limitPriceE6: askPriceE6,
      });
    }

    return actions;
  }

  public async handleTradeResult(result: TradeResult): Promise<void> {
    // Testnet mode has no risk guard; logging only
    if (result.success) {
      // successful testnet trade
    }
  }
}
