// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PerpesMath} from "./PerpesMath.sol";

/// @title PerpesSecondaryMath
/// @notice Graduated-market math — a port of programs/perpes/src/math/secondary.rs
/// (and the profit throttle from math/primary.rs). A graduated market prices
/// off an oracle (the Uniswap v4 spot TWAP, blended in from the synthetic price
/// over the transition window) plus a premium that grows with open-interest skew.
library PerpesSecondaryMath {
    uint256 internal constant Q9 = 1e9;
    uint256 internal constant DAY = 86_400;

    // ── Oracle blending ─────────────────────────────────────────────────────

    /// Share of the transition window elapsed since graduation, Q9 (1e9 = 100%).
    function transitionProgressQ9(uint256 nowTs, uint256 startTs, uint256 durationSeconds)
        internal
        pure
        returns (uint256)
    {
        if (nowTs <= startTs) return 0;
        uint256 d = durationSeconds == 0 ? 1 : durationSeconds;
        uint256 p = ((nowTs - startTs) * Q9) / d;
        return p > Q9 ? Q9 : p;
    }

    /// Synthetic price weighted out and spot weighted in as the transition progresses.
    function blendedPriceE6(uint256 syntheticE6, uint256 spotE6, uint256 progressQ9) internal pure returns (uint256) {
        uint256 b = (syntheticE6 * (Q9 - progressQ9)) / Q9 + (spotE6 * progressQ9) / Q9;
        return b == 0 ? 1 : b;
    }

    // ── Liquidity, OI and leverage ──────────────────────────────────────────

    /// Skew scale (the "virtual liquidity"): spot depth × multiplier, floored.
    function skewScaleUsdc(uint256 spotLiquidityUsdc, uint256 multiplier, uint256 minVirtualUsdc)
        internal
        pure
        returns (uint256)
    {
        uint256 scaled = spotLiquidityUsdc * multiplier;
        return scaled > minVirtualUsdc ? scaled : minVirtualUsdc;
    }

    /// Open-interest cap: spot depth × multiplier, quartered while the spot
    /// velocity breaker is tripped. OI far above spot depth would make pushing
    /// the spot oracle profitable.
    function maxOiUsdc(uint256 spotLiquidityUsdc, uint256 multiplier, bool velocityTripped)
        internal
        pure
        returns (uint256)
    {
        uint256 cap = spotLiquidityUsdc * multiplier;
        return velocityTripped ? cap / 4 : cap;
    }

    /// Opening leverage: starts at `initialX`, steps up by `stepPerDay` every
    /// full 24h since graduation, capped at `capX`; 5× while the breaker is tripped.
    function maxLeverageX(
        uint256 graduatedAt,
        uint256 nowTs,
        uint256 initialX,
        uint256 stepPerDay,
        uint256 capX,
        bool velocityTripped
    ) internal pure returns (uint256 lev) {
        uint256 age = nowTs > graduatedAt ? nowTs - graduatedAt : 0;
        lev = initialX + (age / DAY) * stepPerDay;
        if (lev > capX) lev = capX;
        if (velocityTripped && lev > 5) lev = 5;
        if (lev == 0) lev = 1;
    }

    // ── Execution: oracle + skew premium ────────────────────────────────────

    /// Premium at skew `s` (long OI − short OI, USDC): `s / scale` in bps,
    /// clamped to ±`maxBps`.
    function skewPremiumBps(int256 skew, uint256 scale, uint256 maxBps) internal pure returns (int256) {
        int256 cap = int256(maxBps);
        if (scale == 0) return skew > 0 ? cap : (skew < 0 ? -cap : int256(0));
        int256 p = (skew * 10_000) / int256(scale);
        if (p > cap) return cap;
        if (p < -cap) return -cap;
        return p;
    }

    /// ∫ clamp(x / scale, ±max) dx from 0 to x, in bps × USDC. Even in x.
    function _premiumIntegral(int256 x, int256 scale, int256 maxBps) private pure returns (int256) {
        int256 xSat = (maxBps * scale) / 10_000;
        int256 ax = x < 0 ? -x : x;
        if (ax <= xSat) return (ax * ax * 10_000) / (2 * scale);
        return (xSat * xSat * 10_000) / (2 * scale) + maxBps * (ax - xSat);
    }

    /// Exact average of the clamped premium along the skew path from → to, so
    /// one large order costs the same as the same order split into slices.
    function averagePremiumBps(int256 skewFrom, int256 skewTo, uint256 scale, uint256 maxBps)
        internal
        pure
        returns (int256)
    {
        if (skewFrom == skewTo) return skewPremiumBps(skewFrom, scale, maxBps);
        int256 cap = int256(maxBps);
        if (scale == 0) return skewTo > skewFrom ? cap : -cap;
        int256 s = int256(scale);
        return (_premiumIntegral(skewTo, s, cap) - _premiumIntegral(skewFrom, s, cap)) / (skewTo - skewFrom);
    }

    /// Fill price for a taker moving skew by ±`notional`: oracle × (1 + average
    /// premium along the path ± half-spread against the taker).
    function executionPriceE6(
        uint256 oracleE6,
        int256 skewBefore,
        bool takerIsBuy,
        uint256 notional,
        uint256 scale,
        uint256 halfSpreadBps,
        uint256 maxPremiumBps
    ) internal pure returns (uint256) {
        int256 signed = takerIsBuy ? int256(notional) : -int256(notional);
        int256 adj = averagePremiumBps(skewBefore, skewBefore + signed, scale, maxPremiumBps);
        adj += takerIsBuy ? int256(halfSpreadBps) : -int256(halfSpreadBps);
        int256 p = (int256(oracleE6) * (10_000 + adj)) / 10_000;
        return p < 1 ? 1 : uint256(p);
    }

    /// Mark price: oracle × (1 + skew premium), clamped to ±`maxDeviationBps`.
    function markPriceE6(uint256 oracleE6, int256 skew, uint256 scale, uint256 maxDeviationBps)
        internal
        pure
        returns (uint256)
    {
        int256 premium = skewPremiumBps(skew, scale, maxDeviationBps);
        int256 p = (int256(oracleE6) * (10_000 + premium)) / 10_000;
        return p < 1 ? 1 : uint256(p);
    }

    /// Base bought (long) or owed (short) for `notional` at `priceE6`; shorts
    /// round up so the liability is never understated.
    function baseForNotional(uint256 notional, uint256 priceE6, bool isShort) internal pure returns (uint256) {
        uint256 num = notional * PerpesMath.PRICE_SCALE;
        return isShort ? PerpesMath.ceilDiv(num, priceE6) : num / priceE6;
    }

    // ── Circuit breaker ─────────────────────────────────────────────────────

    /// Absolute move from `thenE6` to `nowE6`, in bps of `thenE6`.
    function velocityBps(uint256 nowE6, uint256 thenE6) internal pure returns (uint256) {
        if (thenE6 == 0) return 0;
        uint256 diff = nowE6 > thenE6 ? nowE6 - thenE6 : thenE6 - nowE6;
        return (diff * 10_000) / thenE6;
    }

    // ── Vault protection ────────────────────────────────────────────────────

    /// Traders' net unrealized PnL at `priceE6` (positive = the vault owes them).
    function aggregateTraderPnl(uint256 baseLong, uint256 oiLong, uint256 baseShort, uint256 oiShort, uint256 priceE6)
        internal
        pure
        returns (int256)
    {
        int256 longs = int256(PerpesMath.baseValue(baseLong, priceE6, false)) - int256(oiLong);
        int256 shorts = int256(oiShort) - int256(PerpesMath.baseValue(baseShort, priceE6, true));
        return longs + shorts;
    }

    /// Share of the vault's free balance that open profit already claims, bps (≤ 100%).
    function utilizationBps(int256 aggregatePnl, uint256 headroom) internal pure returns (uint256) {
        if (aggregatePnl <= 0) return 0;
        uint256 bps = (uint256(aggregatePnl) * 10_000) / (headroom == 0 ? 1 : headroom);
        return bps > 10_000 ? 10_000 : bps;
    }

    /// As utilization climbs, less of a close's profit is paid immediately
    /// (floor 50%); the rest is deferred, never forfeited. Principal is never throttled.
    function claimRatioBps(uint256 utilization) internal pure returns (uint256) {
        if (utilization >= 5_000) return 5_000;
        return 10_000 - utilization;
    }
}
