import { fromE6, toE6 } from '@perpes/evm';

/**
 * Samples a random interval following a Poisson arrival process with mean `meanMs`,
 * clamped to `[minMs, maxMs]`.
 */
export function samplePoissonInterval(
  meanMs: number,
  minMs: number,
  maxMs: number,
): number {
  const u = Math.random();
  // Inverse transform sampling for exponential distribution: -ln(1-u) * mean
  const sample = -Math.log(1 - u) * meanMs;
  return Math.max(minMs, Math.min(maxMs, Math.round(sample)));
}

/**
 * Generates an organic, non-round trade notional between minUsdc and maxUsdc.
 * Adds natural fractional cents (e.g., $18.43 instead of $18.00).
 */
export function sampleOrganicNotional(
  minUsdcE6: bigint,
  maxUsdcE6: bigint,
): bigint {
  const minNum = fromE6(minUsdcE6);
  const maxNum = fromE6(maxUsdcE6);
  // Uniform base + log-normal tilt
  const base = minNum + Math.random() * (maxNum - minNum);
  // Add natural fractional cents (.12, .87, etc.)
  const cents = Math.floor(Math.random() * 100) / 100;
  const rounded = Math.floor(base) + cents;
  const clamped = Math.max(minNum, Math.min(maxNum, rounded));
  return toE6(clamped.toFixed(2));
}

/**
 * Calculate the expected mark price after a trade on a vAMM curve.
 * Symmetrical to PerpesMath.sol:
 * For Long: newQuote = quote + notional; newBase = k / newQuote; price = newQuote / newBase
 * For Short: newBase = base + (notional * base) / quote; newQuote = k / newBase; price = newQuote / newBase
 */
export function predictVammPrice(
  quoteReserve: bigint,
  baseReserve: bigint,
  notionalE6: bigint,
  isLong: boolean,
): { newPriceE6: bigint; priceImpactBps: number } {
  if (quoteReserve === 0n || baseReserve === 0n) {
    return { newPriceE6: 1_000_000n, priceImpactBps: 0 };
  }

  const k = quoteReserve * baseReserve;
  const currentPriceE6 = (quoteReserve * 1_000_000n) / baseReserve;

  let newPriceE6: bigint;
  if (isLong) {
    const newQuote = quoteReserve + notionalE6;
    const newBase = k / newQuote;
    newPriceE6 = (newQuote * 1_000_000n) / newBase;
  } else {
    // For short: base increases
    const baseAmount = (notionalE6 * baseReserve) / quoteReserve;
    const newBase = baseReserve + baseAmount;
    const newQuote = k / newBase;
    newPriceE6 = (newQuote * 1_000_000n) / newBase;
  }

  const diff =
    newPriceE6 > currentPriceE6
      ? newPriceE6 - currentPriceE6
      : currentPriceE6 - newPriceE6;
  const priceImpactBps = Number((diff * 10_000n) / currentPriceE6);

  return { newPriceE6, priceImpactBps };
}

export function formatUsdc(amountE6: bigint): string {
  const sign = amountE6 < 0n ? '-' : '';
  const abs = amountE6 < 0n ? -amountE6 : amountE6;
  const whole = abs / 1_000_000n;
  const fraction = (abs % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${sign}$${whole}.${fraction}`;
}

export function formatPrice(priceE6: bigint): string {
  const whole = priceE6 / 1_000_000n;
  const fraction = (priceE6 % 1_000_000n).toString().padStart(6, '0');
  return `$${whole}.${fraction}`;
}

export function formatMon(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  return `${eth.toFixed(4)} MON`;
}
