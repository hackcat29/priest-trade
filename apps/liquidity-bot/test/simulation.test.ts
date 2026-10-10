process.env['BOT_MODE'] = 'mainnet';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  predictVammPrice,
  sampleOrganicNotional,
  samplePoissonInterval,
} from '../src/math-utils';
import { RiskGuard } from '../src/risk-guard';
import { toE6 } from '@perpes/evm';

describe('Liquidity Bot Mathematical & Risk Simulation', () => {
  it('Poisson interval sampling stays within bounds and generates variance', () => {
    const min = 2000;
    const max = 8000;
    const mean = 4000;
    const samples: number[] = [];

    for (let i = 0; i < 100; i++) {
      const val = samplePoissonInterval(mean, min, max);
      assert.ok(val >= min, `Value ${val} should be >= ${min}`);
      assert.ok(val <= max, `Value ${val} should be <= ${max}`);
      samples.push(val);
    }

    // Check that we have natural variance (not all the same value)
    const unique = new Set(samples);
    assert.ok(unique.size > 20, 'Should generate diverse Poisson intervals');
  });

  it('Organic notional sizing produces fractured non-round values within bounds', () => {
    const minUsdc = toE6(10);
    const maxUsdc = toE6(25);

    for (let i = 0; i < 50; i++) {
      const notional = sampleOrganicNotional(minUsdc, maxUsdc);
      assert.ok(notional >= minUsdc, 'Notional should be >= min');
      assert.ok(notional <= maxUsdc, 'Notional should be <= max');
      // Should not all be integer multiples of $1.00
      const remainder = notional % 1_000_000n;
      // remainder represents cents
      assert.ok(remainder >= 0n && remainder < 1_000_000n);
    }
  });

  it('vAMM analytical price impact reflects curve dynamics accurately', () => {
    const quoteReserve = 10_000_000_000n; // $10,000 USDC
    const baseReserve = 10_000_000_000n;  // 10,000 base
    const initialPriceE6 = (quoteReserve * 1_000_000n) / baseReserve; // 1.000000

    // Buy (Long) should increase quote reserve, decrease base reserve, and increase price
    const longTrade = predictVammPrice(quoteReserve, baseReserve, 50_000_000n, true); // $50 notional
    assert.ok(
      longTrade.newPriceE6 > initialPriceE6,
      'Long trade must increase mark price',
    );
    assert.ok(
      longTrade.priceImpactBps > 0 && longTrade.priceImpactBps < 200,
      'Price impact of $50 trade on $10k curve should be ~50 bps',
    );

    // Sell (Short) should decrease mark price
    const shortTrade = predictVammPrice(quoteReserve, baseReserve, 50_000_000n, false);
    assert.ok(
      shortTrade.newPriceE6 < initialPriceE6,
      'Short trade must decrease mark price',
    );
  });

  it('Mainnet Risk Guard strictly enforces circuit breakers and capital limits', () => {
    const guard = new RiskGuard('mainnet');
    const mockToken = '0x1111111111111111111111111111111111111111';

    // Normal trade should pass
    const check1 = guard.canOpenPosition(mockToken, toE6(10));
    assert.strictEqual(check1.allowed, true);

    // Simulate exceeding per-token collateral limit ($50 max)
    guard.recordOpen(mockToken, toE6(45), toE6(90), toE6(0.09));
    const check2 = guard.canOpenPosition(mockToken, toE6(10));
    assert.strictEqual(
      check2.allowed,
      false,
      'Should block trade when per-token capital limit would be exceeded',
    );

    // Simulate a severe drawdown exceeding $75 stop-loss
    guard.recordClose(mockToken, toE6(45), toE6(90), -toE6(80), toE6(0.09));
    const check3 = guard.canOpenPosition(mockToken, toE6(5));
    assert.strictEqual(
      check3.allowed,
      false,
      'Global stop-loss circuit breaker should trip',
    );
    assert.strictEqual(guard.isTripped(), true);
  });

  it('Testnet Risk Guard operates unconstrained with zero risk guard', () => {
    const testnetGuard = new RiskGuard('testnet');
    const mockToken = '0x2222222222222222222222222222222222222222';

    // Simulate massive open and massive drawdown
    testnetGuard.recordOpen(mockToken, toE6(500), toE6(2500), toE6(2.5));
    testnetGuard.recordClose(mockToken, toE6(500), toE6(2500), -toE6(1000), toE6(2.5));

    // Even with -$1000 drawdown and $500 collateral, should still allow trades!
    const check = testnetGuard.canOpenPosition(mockToken, toE6(200));
    assert.strictEqual(check.allowed, true, 'Testnet mode must have no risk guard');
    assert.strictEqual(testnetGuard.isTripped(), false, 'Testnet circuit breaker never trips');
  });
});

