// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title PerpesMath
/// @notice Pure engine math, ported 1:1 from the Solana program
/// (programs/perpes/src/math/{vamm,primary}.rs). All USDC amounts are 6-decimal
/// raw units, prices are E6 (USDC per base unit × 1e6), base is 6-decimal
/// synthetic units, and the funding index is E9.
///
/// Primary markets price off a constant-product virtual AMM: virtual reserves
/// `quote × base ≥ k`, price `quote × 1e6 / base`. Buying moves the price up,
/// selling moves it down, and because the curve returns to its starting
/// reserves once net base returns to zero, traders' PnL is zero-sum across a
/// full unwind (rounding always favours the curve).
library PerpesMath {
    uint256 internal constant PRICE_SCALE = 1e6;
    int256 internal constant ACCUMULATOR_SCALE = 1e9;
    int256 internal constant MAX_PREMIUM_BPS = 500;

    error InvalidPrice();
    error InvalidSize();
    error PriceImpactTooHigh();

    struct Swap {
        uint256 baseAmount;
        uint256 quoteAmount;
        uint256 newQuoteReserve;
        uint256 newBaseReserve;
    }

    function ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) revert InvalidPrice();
        return a / b + (a % b == 0 ? 0 : 1);
    }

    // ── vAMM ──────────────────────────────────────────────────────────────────

    function initialReserves(uint256 depthQuoteUsdc, uint256 initialPriceE6)
        internal
        pure
        returns (uint256 quote, uint256 base, uint256 k)
    {
        if (depthQuoteUsdc == 0 || initialPriceE6 == 0) revert InvalidPrice();
        quote = depthQuoteUsdc;
        base = (quote * PRICE_SCALE) / initialPriceE6;
        if (base == 0) revert InvalidPrice();
        k = quote * base;
    }

    function priceE6(uint256 quoteReserve, uint256 baseReserve) internal pure returns (uint256) {
        if (baseReserve == 0) revert InvalidPrice();
        uint256 p = (quoteReserve * PRICE_SCALE) / baseReserve;
        if (p > type(uint64).max) p = type(uint64).max;
        return p == 0 ? 1 : p;
    }

    /// Long open: trader pays `quoteIn` and receives base out of the curve.
    function openLong(uint256 q, uint256 b, uint256 k, uint256 quoteIn) internal pure returns (Swap memory s) {
        if (quoteIn == 0) revert InvalidSize();
        uint256 newQuote = q + quoteIn;
        uint256 newBase = ceilDiv(k, newQuote);
        if (newBase >= b) revert PriceImpactTooHigh();
        s = Swap(b - newBase, quoteIn, newQuote, newBase);
    }

    /// Short open: trader sells base into the curve for `quoteOut`; base owed is rounded up.
    function openShort(uint256 q, uint256 b, uint256 k, uint256 quoteOut) internal pure returns (Swap memory s) {
        if (quoteOut == 0) revert InvalidSize();
        if (quoteOut >= q) revert PriceImpactTooHigh();
        uint256 newQuote = q - quoteOut;
        uint256 newBase = ceilDiv(k, newQuote);
        s = Swap(newBase - b, quoteOut, newQuote, newBase);
    }

    /// Long close: trader returns `baseIn` and receives quote.
    function closeLong(uint256 q, uint256 b, uint256 k, uint256 baseIn) internal pure returns (Swap memory s) {
        if (baseIn == 0) revert InvalidSize();
        uint256 newBase = b + baseIn;
        uint256 newQuote = ceilDiv(k, newBase);
        s = Swap(baseIn, q > newQuote ? q - newQuote : 0, newQuote, newBase);
    }

    /// Short close: trader buys `baseOut` back, paying quote (rounded up).
    function closeShort(uint256 q, uint256 b, uint256 k, uint256 baseOut) internal pure returns (Swap memory s) {
        if (baseOut == 0) revert InvalidSize();
        if (baseOut >= b) revert PriceImpactTooHigh();
        uint256 newBase = b - baseOut;
        uint256 newQuote = ceilDiv(k, newBase);
        s = Swap(baseOut, newQuote - q, newQuote, newBase);
    }

    // ── Fees / leverage ─────────────────────────────────────────────────────

    /// `notional × bps`, rounded up so a trade can't be split into dust to dodge the fee.
    function notionalFee(uint256 notional, uint256 bps) internal pure returns (uint256) {
        uint256 p = notional * bps;
        return p / 10_000 + (p % 10_000 == 0 ? 0 : 1);
    }

    /// Maintenance margin is half of initial margin at the market's leverage cap.
    function maintenanceMarginBps(uint256 maxLeverageX100) internal pure returns (uint16) {
        if (maxLeverageX100 == 0) return 10_000;
        uint256 v = 1_000_000 / (maxLeverageX100 * 2);
        return uint16(v == 0 ? 1 : v);
    }

    /// Quote value of `base` at `price`; `roundUp` for a short's liability.
    function baseValue(uint256 base, uint256 price, bool roundUp) internal pure returns (uint256) {
        uint256 p = base * price;
        return p / PRICE_SCALE + (roundUp && p % PRICE_SCALE != 0 ? 1 : 0);
    }

    function averagePriceE6(uint256 quote, uint256 base) internal pure returns (uint256) {
        if (base == 0) return 0;
        uint256 p = (quote * PRICE_SCALE) / base;
        return p == 0 ? 1 : p;
    }

    /// Long PnL `base × p − cost`, short `cost − base × p`.
    function unrealizedPnl(bool isLong, uint256 sizeUsdc, uint256 base, uint256 price) internal pure returns (int256) {
        if (sizeUsdc == 0) return 0;
        if (isLong) return int256(baseValue(base, price, false)) - int256(sizeUsdc);
        return int256(sizeUsdc) - int256(baseValue(base, price, true));
    }

    /// Collateral left after a withdrawal must cover initial margin at the live
    /// leverage cap; unrealized losses count against it, unrealized profits don't.
    function withdrawalKeepsInitialMargin(uint256 size, uint256 collateralAfter, int256 pnl, uint256 maxLeverageX)
        internal
        pure
        returns (bool)
    {
        if (size == 0) return true;
        if (maxLeverageX == 0) return false;
        int256 equity = int256(collateralAfter) + (pnl < 0 ? pnl : int256(0));
        return equity * int256(maxLeverageX) >= int256(size);
    }

    // ── Payouts / liquidation ───────────────────────────────────────────────

    /// Principal is paid in full while the vault can; profit is throttled by
    /// `claimRatioBps`; both are capped by `headroom`. The rest is deferred.
    function splitClosePayout(uint256 principal, uint256 profit, uint256 claimRatioBps, uint256 headroom)
        internal
        pure
        returns (uint256 payNow, uint256 deferred)
    {
        uint256 throttled = (profit * claimRatioBps) / 10_000;
        payNow = principal + throttled;
        if (payNow > headroom) payNow = headroom;
        deferred = principal + profit - payNow;
    }

    /// Splits a liquidated position's remaining equity: liquidator reward first,
    /// then the insurance penalty, then the owner. Negative equity is a shortfall.
    function splitLiquidation(int256 equity, uint256 notional, uint256 rewardBps, uint256 penaltyBps)
        internal
        pure
        returns (uint256 liquidator, uint256 insurance, uint256 owner, uint256 shortfall)
    {
        if (equity <= 0) return (0, 0, 0, uint256(-equity));
        uint256 eq = uint256(equity);
        liquidator = notionalFee(notional, rewardBps);
        if (liquidator > eq) liquidator = eq;
        insurance = notionalFee(notional, penaltyBps);
        if (insurance > eq - liquidator) insurance = eq - liquidator;
        owner = eq - liquidator - insurance;
    }

    // ── Funding / index ─────────────────────────────────────────────────────

    /// Funding rate in bps per interval (positive ⇒ longs pay). Skew is measured
    /// against max(total OI, floor) so a tiny one-sided market isn't charged the
    /// full-skew rate. No premium term on the primary curve.
    function fundingRateBps(uint256 longOi, uint256 shortOi, uint256 oiFloor, int256 velocityBps, int256 capBps)
        internal
        pure
        returns (int256)
    {
        uint256 denom = longOi + shortOi;
        if (denom < oiFloor) denom = oiFloor;
        if (denom == 0) denom = 1;
        int256 skew = ((int256(longOi) - int256(shortOi)) * 10_000) / int256(denom);
        if (skew > 10_000) skew = 10_000;
        if (skew < -10_000) skew = -10_000;
        int256 rate = (skew * velocityBps) / 10_000;
        if (rate > capBps) return capBps;
        if (rate < -capBps) return -capBps;
        return rate;
    }

    /// Time-weighted EWMA step of the index toward the mark.
    function ewmaIndexE6(uint256 index, uint256 mark, uint256 elapsed, uint256 tau) internal pure returns (uint256) {
        if (index == 0 || tau == 0 || elapsed >= tau) return mark == 0 ? 1 : mark;
        if (elapsed == 0) return index;
        int256 delta = int256(mark) - int256(index);
        int256 next = int256(index) + (delta * int256(elapsed)) / int256(tau);
        return next < 1 ? 1 : uint256(next);
    }

    /// Funding owed to (+) or by (−) a position: `−side × size × Δindex`.
    function pendingFunding(bool isLong, uint256 sizeUsdc, int256 marketIndexE9, int256 positionIndexE9)
        internal
        pure
        returns (int256)
    {
        int256 delta = marketIndexE9 - positionIndexE9;
        int256 sign = isLong ? int256(-1) : int256(1);
        return (int256(sizeUsdc) * delta * sign) / ACCUMULATOR_SCALE;
    }

    function hRatioBps(uint256 longOi, uint256 shortOi) internal pure returns (uint16) {
        if (longOi == 0 && shortOi == 0) return 10_000;
        uint256 larger = longOi > shortOi ? longOi : shortOi;
        uint256 smaller = longOi > shortOi ? shortOi : longOi;
        return uint16((smaller * 10_000) / larger);
    }

    /// A TP fires on the mark alone; an SL needs mark AND index through it (same
    /// rule as liquidation) so a single-block push can't stop-hunt. Returns
    /// (hit, isTakeProfit).
    function hitTrigger(bool isLong, uint256 tp, uint256 sl, uint256 mark, uint256 index)
        internal
        pure
        returns (bool, bool)
    {
        if (isLong) {
            if (tp > 0 && mark >= tp) return (true, true);
            if (sl > 0 && mark <= sl && index <= sl) return (true, false);
        } else {
            if (tp > 0 && mark <= tp) return (true, true);
            if (sl > 0 && mark >= sl && index >= sl) return (true, false);
        }
        return (false, false);
    }
}
