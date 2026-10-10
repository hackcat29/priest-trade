import {
  BOT_MODE,
  DASHBOARD_PRINT_INTERVAL_MS,
  DEPLOYMENT,
  ENGINE_ADDRESS,
  EVM_CHAIN,
  MAINTENANCE_INTERVAL_MS,
  RPC_URL,
  USDC_ADDRESS,
} from './config';
import { BootstrapManager } from './bootstrap-manager';
import { ExecutionEngine } from './execution-engine';
import { MarketWatcher } from './market-watcher';
import { MetricsServer } from './metrics';
import { RiskGuard } from './risk-guard';
import { MainnetStrategy } from './strategies/mainnet-strategy';
import { TestnetStrategy } from './strategies/testnet-strategy';
import { WalletPool } from './wallet-pool';
import type { StrategyContext } from './strategies/base-strategy';
import { formatPrice, formatUsdc } from './math-utils';

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║               PERPES.FUN MONAD LIQUIDITY ENGINE                   ║');
  console.log('║        Sophisticated Bootstrap & Market Making Engine             ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log(`🌐 Chain:             ${EVM_CHAIN} (Chain ID: ${DEPLOYMENT.chainId})`);
  console.log(`🎯 Mode:              ${BOT_MODE.toUpperCase()}`);
  console.log(`⚡ RPC:               ${RPC_URL}`);
  console.log(`🏛️ Engine:            ${ENGINE_ADDRESS}`);
  console.log(`💵 USDC:              ${USDC_ADDRESS}`);
  console.log('─'.repeat(69));

  // 1. Initialize Wallet Pool
  const walletPool = new WalletPool();
  await walletPool.initialize();

  // 2. Execution & Risk Engines
  const executionEngine = new ExecutionEngine(walletPool.publicClient);
  const riskGuard = new RiskGuard();

  // 3. Strategy Selection
  const strategy =
    BOT_MODE === 'mainnet'
      ? new MainnetStrategy(walletPool, riskGuard)
      : new TestnetStrategy(walletPool);

  console.log(`🧠 [Strategy] Loaded: ${strategy.name}`);

  // 4. Bootstrap Manager (Handles newly launched tokens)
  const bootstrapManager = new BootstrapManager(
    walletPool,
    executionEngine,
    strategy,
    riskGuard,
  );

  // 5. Market Watcher (Monitors on-chain events and token launches)
  const marketWatcher = new MarketWatcher(walletPool.publicClient);

  // Wire new launch detection directly to the bootstrap manager!
  marketWatcher.onNewLaunch((market) => {
    bootstrapManager.registerNewLaunch(market);
  });

  await marketWatcher.start();

  // 6. Metrics & Health Server
  const metricsServer = new MetricsServer(
    walletPool,
    riskGuard,
    bootstrapManager,
    marketWatcher,
  );
  metricsServer.start();

  // 7. Background Maintenance Loop for All Created Tokens
  // Ensures all platform tokens maintain active volume and liquidity
  const maintenanceInterval = setInterval(async () => {
    try {
      const allMarkets = marketWatcher.getAllMarkets();
      if (allMarkets.length === 0) return;

      // Pick a random market that is not currently in active bootstrap
      const nonBootstrapped = allMarkets.filter(
        (m) => !bootstrapManager.isBootstrapping(m.token),
      );
      if (nonBootstrapped.length === 0) return;

      const target =
        nonBootstrapped[Math.floor(Math.random() * nonBootstrapped.length)]!;
      const liveState = await executionEngine.fetchMarketState(target.token);
      if (!liveState || liveState.status === 0) return;

      const context: StrategyContext = {
        token: target.token,
        symbol: target.symbol,
        isBootstrap: false,
        currentMarkPriceE6: liveState.markPriceE6,
        vammQuoteReserve: liveState.vammQuoteReserve,
        vammBaseReserve: liveState.vammBaseReserve,
      };

      const action = await strategy.generateTrade(context);
      if (!action) return;

      const walletItem = walletPool.getWalletByIndex(action.walletIndex);
      if (!walletItem) return;

      if (action.actionType === 'open') {
        const result = await executionEngine.executeOpenPosition(
          walletItem.wallet,
          walletItem.info.address,
          action.token,
          action.side,
          action.collateralUsdc,
          action.notionalUsdc,
          action.maxSlippageBps,
        );

        await strategy.handleTradeResult(result);

        if (result.success) {
          const sideStr = action.side === 0 ? '🟢 LONG' : '🔴 SHORT';
          console.log(
            `🌊 [Maintenance] ${target.symbol} ${sideStr} ${formatUsdc(action.notionalUsdc)} by Wallet #${walletItem.info.index}`,
          );
          walletPool.recordPositionOpen(
            walletItem.info.address,
            action.token,
            action.side,
            action.notionalUsdc,
            action.collateralUsdc,
          );
          riskGuard.recordOpen(
            action.token,
            action.collateralUsdc,
            action.notionalUsdc,
            action.notionalUsdc / 1000n,
          );
        }
      } else if (action.actionType === 'close') {
        const result = await executionEngine.executeClosePosition(
          walletItem.wallet,
          walletItem.info.address,
          action.token,
          action.notionalUsdc,
          action.maxSlippageBps,
        );

        await strategy.handleTradeResult(result);

        if (result.success) {
          console.log(
            `🌊 [Maintenance] ${target.symbol} CLOSED ${formatUsdc(action.notionalUsdc)} by Wallet #${walletItem.info.index}`,
          );
          walletPool.recordPositionClose(
            walletItem.info.address,
            action.token,
            action.notionalUsdc,
            result.payoutUsdc ?? 0n,
          );
          riskGuard.recordClose(
            action.token,
            action.collateralUsdc,
            action.notionalUsdc,
            result.realizedPnlUsdc ?? 0n,
            action.notionalUsdc / 1000n,
          );
        }
      }
    } catch (err) {
      console.warn('⚠️ [Maintenance] Error:', (err as Error).message);
    }
  }, MAINTENANCE_INTERVAL_MS);

  // 8. Rebalancing Loop (Every 60s)
  const rebalanceInterval = setInterval(async () => {
    try {
      await walletPool.refreshAllBalances();
      await walletPool.rebalancePool();
    } catch (err) {
      console.warn('⚠️ [Rebalance] Error:', (err as Error).message);
    }
  }, 60_000);

  // 9. Dashboard printing interval
  const dashboardInterval = setInterval(() => {
    metricsServer.printDashboard();
  }, DASHBOARD_PRINT_INTERVAL_MS);

  // 10. Graceful Shutdown
  const shutdown = () => {
    console.log('\n🛑 [Bot] Shutting down gracefully...');
    clearInterval(maintenanceInterval);
    clearInterval(rebalanceInterval);
    clearInterval(dashboardInterval);
    marketWatcher.stop();
    bootstrapManager.stopAll();
    metricsServer.stop();
    console.log('👋 [Bot] Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('💥 Fatal bot error:', err);
  process.exit(1);
});
