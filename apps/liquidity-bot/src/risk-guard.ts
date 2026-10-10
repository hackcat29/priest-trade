import type { Address } from 'viem';
import { BOT_MODE, MAINNET_CONFIG } from './config';
import { formatUsdc } from './math-utils';
import type { BotMode, TradeResult } from './types';

export class RiskGuard {
  private circuitBreakerTripped = false;
  private tripReason = '';
  private readonly mode: BotMode;

  // Capital tracking
  private realizedPnlUsdcE6 = 0n;
  private totalVolumeUsdcE6 = 0n;
  private totalFeesPaidUsdcE6 = 0n;
  private totalGasSpentWei = 0n;

  // Active collateral per token
  private lockedCollateralByToken = new Map<Address, bigint>();

  // Toxic flow cooldowns (token -> cooldownUntilTimestampMs)
  private toxicCooldowns = new Map<Address, number>();

  // Recent price checks for deviation detection
  private lastKnownPriceByToken = new Map<Address, { priceE6: bigint; time: number }>();

  constructor(mode: BotMode = BOT_MODE) {
    this.mode = mode;
  }

  public isTripped(): boolean {
    return this.circuitBreakerTripped;
  }

  public getTripReason(): string {
    return this.tripReason;
  }

  /**
   * Evaluates if a new trade can be opened on `token`.
   * Testnet mode: Always allowed (no risk guard).
   * Mainnet mode: Rigorous checks on capital, drawdown, gas, and toxic flow.
   */
  public canOpenPosition(
    token: Address,
    collateralUsdc: bigint,
    currentGasPriceGwei?: number,
  ): { allowed: boolean; reason?: string } {
    // 1. In Testnet mode, zero risk guards as requested
    if (this.mode === 'testnet') {
      return { allowed: true };
    }

    // 2. Mainnet checks:
    if (this.circuitBreakerTripped) {
      return {
        allowed: false,
        reason: `Global circuit breaker tripped: ${this.tripReason}`,
      };
    }

    // A. Max Drawdown Stop-Loss
    if (this.realizedPnlUsdcE6 < -MAINNET_CONFIG.maxCumulativeDrawdownUsdc) {
      this.circuitBreakerTripped = true;
      this.tripReason = `Cumulative drawdown exceeded limit: ${formatUsdc(this.realizedPnlUsdcE6)}`;
      return { allowed: false, reason: this.tripReason };
    }

    // B. Gas Price Check
    if (
      currentGasPriceGwei &&
      currentGasPriceGwei > MAINNET_CONFIG.maxGasPriceGwei
    ) {
      return {
        allowed: false,
        reason: `Gas price ${currentGasPriceGwei.toFixed(2)} Gwei exceeds limit ${MAINNET_CONFIG.maxGasPriceGwei} Gwei`,
      };
    }

    // C. Toxic Flow / Whale Cooldown
    const cooldownUntil = this.toxicCooldowns.get(token) ?? 0;
    if (Date.now() < cooldownUntil) {
      const remainingSec = Math.round((cooldownUntil - Date.now()) / 1000);
      return {
        allowed: false,
        reason: `Token in toxic flow cooldown (${remainingSec}s remaining)`,
      };
    }

    // D. Per-Token Capital Cap
    const currentLocked = this.lockedCollateralByToken.get(token) ?? 0n;
    if (
      currentLocked + collateralUsdc >
      MAINNET_CONFIG.maxCapitalPerTokenUsdc
    ) {
      return {
        allowed: false,
        reason: `Token collateral limit reached (${formatUsdc(currentLocked)} / ${formatUsdc(MAINNET_CONFIG.maxCapitalPerTokenUsdc)})`,
      };
    }

    // E. Total Portfolio Collateral Cap
    let totalLocked = 0n;
    for (const locked of this.lockedCollateralByToken.values()) {
      totalLocked += locked;
    }
    if (
      totalLocked + collateralUsdc >
      MAINNET_CONFIG.maxTotalCollateralUsdc
    ) {
      return {
        allowed: false,
        reason: `Portfolio collateral limit reached (${formatUsdc(totalLocked)} / ${formatUsdc(MAINNET_CONFIG.maxTotalCollateralUsdc)})`,
      };
    }

    return { allowed: true };
  }

  /**
   * Monitor for external price shocks or whale manipulation on `token`.
   * If price jumped > 4% within 30 seconds from external trading, trigger cooldown.
   */
  public monitorPriceShock(token: Address, currentPriceE6: bigint): void {
    if (this.mode === 'testnet') return;

    const last = this.lastKnownPriceByToken.get(token);
    const now = Date.now();

    if (last && now - last.time < 30_000) {
      const diff =
        currentPriceE6 > last.priceE6
          ? currentPriceE6 - last.priceE6
          : last.priceE6 - currentPriceE6;
      const deviationBps = Number((diff * 10_000n) / last.priceE6);

      if (deviationBps > 400) {
        // > 4.0% move in < 30 seconds
        console.warn(
          `🛡️ [RiskGuard] Abnormal external price volatility on ${token} (${(deviationBps / 100).toFixed(2)}%). Cooling down for 90s.`,
        );
        this.toxicCooldowns.set(token, now + 90_000);
      }
    }

    this.lastKnownPriceByToken.set(token, { priceE6: currentPriceE6, time: now });
  }

  public recordOpen(
    token: Address,
    collateralUsdc: bigint,
    notionalUsdc: bigint,
    feeUsdc: bigint,
  ): void {
    const current = this.lockedCollateralByToken.get(token) ?? 0n;
    this.lockedCollateralByToken.set(token, current + collateralUsdc);
    this.totalVolumeUsdcE6 += notionalUsdc;
    this.totalFeesPaidUsdcE6 += feeUsdc;
  }

  public recordClose(
    token: Address,
    releasedCollateralUsdc: bigint,
    notionalUsdc: bigint,
    pnlUsdc: bigint,
    feeUsdc: bigint,
  ): void {
    const current = this.lockedCollateralByToken.get(token) ?? 0n;
    const nextLocked =
      current > releasedCollateralUsdc ? current - releasedCollateralUsdc : 0n;
    this.lockedCollateralByToken.set(token, nextLocked);

    this.totalVolumeUsdcE6 += notionalUsdc;
    this.totalFeesPaidUsdcE6 += feeUsdc;
    this.realizedPnlUsdcE6 += pnlUsdc - feeUsdc;
  }

  public recordGasSpent(wei: bigint): void {
    this.totalGasSpentWei += wei;
  }

  public resetCircuitBreaker(): void {
    this.circuitBreakerTripped = false;
    this.tripReason = '';
    console.log('🔄 [RiskGuard] Circuit breaker manually reset');
  }

  public getSummary() {
    let totalLocked = 0n;
    for (const locked of this.lockedCollateralByToken.values()) {
      totalLocked += locked;
    }

    return {
      circuitBreakerTripped: this.circuitBreakerTripped,
      tripReason: this.tripReason,
      realizedPnlUsdcE6: this.realizedPnlUsdcE6,
      totalVolumeUsdcE6: this.totalVolumeUsdcE6,
      totalFeesPaidUsdcE6: this.totalFeesPaidUsdcE6,
      totalGasSpentWei: this.totalGasSpentWei,
      totalLockedCollateralUsdcE6: totalLocked,
    };
  }
}
