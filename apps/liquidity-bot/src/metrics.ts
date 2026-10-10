import http from 'node:http';
import { BOT_MODE, EVM_CHAIN, SERVICE_PORT } from './config';
import { formatMon, formatUsdc } from './math-utils';
import type { RiskGuard } from './risk-guard';
import type { WalletPool } from './wallet-pool';
import type { BootstrapManager } from './bootstrap-manager';
import type { MarketWatcher } from './market-watcher';

export class MetricsServer {
  private startTime = Date.now();
  private server?: http.Server | undefined;

  constructor(
    private readonly walletPool: WalletPool,
    private readonly riskGuard: RiskGuard,
    private readonly bootstrapManager: BootstrapManager,
    private readonly marketWatcher: MarketWatcher,
  ) {}

  public start(): void {
    this.server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.url === '/health') {
        const isOk = !this.riskGuard.isTripped();
        res.writeHead(isOk ? 200 : 503);
        res.end(
          JSON.stringify({
            status: isOk ? 'healthy' : 'degraded',
            mode: BOT_MODE,
            chain: EVM_CHAIN,
            uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
            circuitBreakerTripped: this.riskGuard.isTripped(),
            circuitBreakerReason: this.riskGuard.getTripReason() || undefined,
          }),
        );
        return;
      }

      if (req.url === '/metrics' || req.url === '/status') {
        const risk = this.riskGuard.getSummary();
        const bootstraps = this.bootstrapManager.getActiveBootstraps();
        const allMarkets = this.marketWatcher.getAllMarkets();

        res.writeHead(200);
        res.end(
          JSON.stringify({
            mode: BOT_MODE,
            chain: EVM_CHAIN,
            uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
            performance: {
              totalVolumeUsdc: formatUsdc(risk.totalVolumeUsdcE6),
              realizedPnlUsdc: formatUsdc(risk.realizedPnlUsdcE6),
              totalFeesPaidUsdc: formatUsdc(risk.totalFeesPaidUsdcE6),
              totalGasSpentMon: formatMon(risk.totalGasSpentWei),
              totalLockedCollateralUsdc: formatUsdc(risk.totalLockedCollateralUsdcE6),
            },
            markets: {
              totalTracked: allMarkets.length,
              activeBootstrapsCount: bootstraps.length,
              activeBootstraps: bootstraps.map((b) => ({
                token: b.token,
                symbol: b.symbol,
                phase: b.phase,
                tradesCount: b.tradesCount,
                volumeUsdc: formatUsdc(b.totalVolumeUsdc),
              })),
            },
            wallets: this.walletPool.getAllWallets().map((w) => ({
              index: w.index,
              address: w.address,
              monBalance: formatMon(w.monBalance),
              usdcBalance: formatUsdc(w.usdcBalance),
              activePositions: w.activePositionsCount,
            })),
            riskGuard: {
              tripped: risk.circuitBreakerTripped,
              reason: risk.tripReason || null,
            },
          }, null, 2),
        );
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    this.server.listen(SERVICE_PORT, () => {
      console.log(`📊 [MetricsServer] Metrics and health server listening on port ${SERVICE_PORT}`);
    });
  }

  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }

  public printDashboard(): void {
    const risk = this.riskGuard.getSummary();
    const bootstraps = this.bootstrapManager.getActiveBootstraps();
    const allMarkets = this.marketWatcher.getAllMarkets();
    const wallets = this.walletPool.getAllWallets();
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);

    const modeBadge =
      BOT_MODE === 'mainnet'
        ? '\x1b[42m\x1b[30m MONAD MAINNET (Break-Even Mode) \x1b[0m'
        : '\x1b[44m\x1b[37m MONAD TESTNET (No Risk Guard) \x1b[0m';

    console.log('\n' + '═'.repeat(72));
    console.log(`🤖 PERPES LIQUIDITY BOT | ${modeBadge} | Uptime: ${uptimeSec}s`);
    console.log('─'.repeat(72));
    console.log(
      `📈 Volume Generated:  ${formatUsdc(risk.totalVolumeUsdcE6)}  │  PnL Realized:  ${formatUsdc(risk.realizedPnlUsdcE6)}`,
    );
    console.log(
      `⛽ Total Gas Spent:   ${formatMon(risk.totalGasSpentWei)}   │  Locked Collateral: ${formatUsdc(risk.totalLockedCollateralUsdcE6)}`,
    );
    console.log(
      `🌐 Markets Tracked:   ${allMarkets.length}            │  Active Bootstraps: ${bootstraps.length}`,
    );

    if (bootstraps.length > 0) {
      console.log('─'.repeat(72));
      console.log('🔥 Active Token Bootstraps:');
      for (const b of bootstraps) {
        console.log(
          `   • ${b.symbol.padEnd(8)} [${b.phase.toUpperCase()}] Trades: ${b.tradesCount.toString().padStart(3)} | Vol: ${formatUsdc(b.totalVolumeUsdc)} | ${b.token}`,
        );
      }
    }

    console.log('─'.repeat(72));
    console.log(`👛 Sub-Wallet Fleet (${wallets.length} active wallets):`);
    for (const w of wallets.slice(0, 4)) {
      console.log(
        `   #${w.index} (${w.address.slice(0, 8)}...): ${formatMon(w.monBalance)} │ ${formatUsdc(w.usdcBalance)} │ Pos: ${w.activePositionsCount}`,
      );
    }
    if (wallets.length > 4) {
      console.log(`   ... and ${wallets.length - 4} more wallets.`);
    }

    if (risk.circuitBreakerTripped) {
      console.log('─'.repeat(72));
      console.log(`🚨 CIRCUIT BREAKER TRIPPED: ${risk.tripReason}`);
    }
    console.log('═'.repeat(72) + '\n');
  }
}
