// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {PerpesSecondaryMath as M} from "../src/PerpesSecondaryMath.sol";

/// The vectors from programs/perpes/src/math/secondary.rs's tests, so both
/// chains' graduated markets compute the same numbers.
contract SecondaryMathTest is Test {
    uint256 constant E6 = 1e6;
    uint256 constant Q9 = 1e9;
    uint256 constant USDC = 1e6;

    function test_transitionProgress() public pure {
        assertEq(M.transitionProgressQ9(100, 200, 21_600), 0);
        assertEq(M.transitionProgressQ9(200, 200, 21_600), 0);
        assertEq(M.transitionProgressQ9(10_800, 0, 21_600), Q9 / 2);
        assertEq(M.transitionProgressQ9(21_600, 0, 21_600), Q9);
        assertEq(M.transitionProgressQ9(999_999_999, 0, 21_600), Q9);
        assertEq(M.transitionProgressQ9(100, 0, 0), Q9);
    }

    function test_blendedPrice() public pure {
        assertEq(M.blendedPriceE6(2 * E6, 2_500_000, 0), 2 * E6);
        assertEq(M.blendedPriceE6(2 * E6, 2_500_000, Q9), 2_500_000);
        assertApproxEqAbs(M.blendedPriceE6(2 * E6, 2_500_000, Q9 / 2), 2_250_000, 1);
        assertEq(M.blendedPriceE6(0, 0, Q9 / 2), 1);
    }

    function test_skewScaleAndOiCap() public pure {
        assertEq(M.skewScaleUsdc(1_000 * E6, 8, 500_000 * E6), 500_000 * E6);
        assertEq(M.skewScaleUsdc(100_000 * E6, 8, 500_000 * E6), 800_000 * E6);
        assertEq(M.maxOiUsdc(100_000 * E6, 10, false), 1_000_000 * E6);
        assertEq(M.maxOiUsdc(1_000 * E6, 1, true), 250 * E6, "breaker quarters the cap");
    }

    function test_leverageSchedule() public pure {
        assertEq(M.maxLeverageX(1_000, 1_000, 15, 5, 40, false), 15);
        assertEq(M.maxLeverageX(1_000, 1_000 + 86_399, 15, 5, 40, false), 15);
        assertEq(M.maxLeverageX(1_000, 1_000 + 86_400, 15, 5, 40, false), 20);
        assertEq(M.maxLeverageX(1_000, 1_000 + 86_400 * 365, 15, 5, 40, false), 40);
        assertEq(M.maxLeverageX(1_000, 0, 15, 5, 40, false), 15);
        assertEq(M.maxLeverageX(1_000, 1_000 + 86_400 * 365, 15, 5, 40, true), 5);
        assertEq(M.maxLeverageX(0, 0, 3, 5, 40, true), 3);
    }

    function test_velocity() public pure {
        assertEq(M.velocityBps(2 * E6, 0), 0);
        assertEq(M.velocityBps(2_500_000, 2 * E6), 2_500);
        assertGt(M.velocityBps(2 * E6, 2_500_000), 0);
    }

    function _fill(int256 skew, bool buy, uint256 notional) internal pure returns (uint256) {
        return M.executionPriceE6(E6, skew, buy, notional, 100_000 * USDC, 10, 500);
    }

    function test_skewPriceOnBalancedMarketIsOraclePlusSpread() public pure {
        assertEq(_fill(0, true, 1_000 * USDC), 1_006_000);
        assertEq(_fill(0, false, 1_000 * USDC), 994_000);
    }

    function test_buyingIntoSkewCostsMoreAndReducingItIsRewarded() public pure {
        int256 longSkew = int256(20_000 * USDC);
        assertGt(_fill(longSkew, true, 1_000 * USDC), _fill(0, true, 1_000 * USDC));
        assertGt(_fill(longSkew, false, 1_000 * USDC), E6);
    }

    function test_splittingAnOrderDoesNotChangeItsCost() public pure {
        uint256[3] memory totals = [uint256(4_000 * USDC), 10_000 * USDC, 30_000 * USDC];
        for (uint256 i; i < 3; i++) {
            uint256 total = totals[i];
            uint256 half = total / 2;
            int256 one = int256(_fill(0, true, total) * total);
            int256 split = int256(_fill(0, true, half) * half + _fill(int256(half), true, half) * half);
            int256 tolerance = int256((2 * total) / 10_000);
            int256 diff = one > split ? one - split : split - one;
            assertLe(diff, tolerance);
        }
    }

    function test_averagePremiumSaturatesPastTheCap() public pure {
        assertEq(M.averagePremiumBps(0, int256(10_000 * USDC), 100_000 * USDC, 500), 375);
        assertEq(M.averagePremiumBps(0, -int256(10_000 * USDC), 100_000 * USDC, 500), -375);
    }

    function test_premiumIsClamped() public pure {
        assertEq(M.skewPremiumBps(int256(10_000_000 * USDC), 100_000 * USDC, 500), 500);
        assertEq(M.skewPremiumBps(-int256(10_000_000 * USDC), 100_000 * USDC, 500), -500);
        assertEq(M.skewPremiumBps(1, 0, 500), 500);
    }

    function test_skewMarkIsOracleAdjustedAndBounded() public pure {
        assertEq(M.markPriceE6(E6, 0, 100_000 * USDC, 100), E6);
        assertEq(M.markPriceE6(E6, int256(50_000 * USDC), 100_000 * USDC, 100), 1_010_000);
    }

    function test_utilizationAndClaimRatio() public pure {
        assertEq(M.utilizationBps(-5, 100), 0);
        assertEq(M.utilizationBps(30, 100), 3_000);
        assertEq(M.claimRatioBps(3_000), 7_000);
        assertEq(M.claimRatioBps(9_000), 5_000);
    }

    function test_baseRoundsAgainstTheTrader() public pure {
        assertEq(M.baseForNotional(10 * USDC, 3 * E6, false), 3_333_333);
        assertEq(M.baseForNotional(10 * USDC, 3 * E6, true), 3_333_334);
    }

    function testFuzz_splitNeverCheaperThanOneOrder(uint64 a, uint64 b, int64 skew) public pure {
        uint256 x = bound(uint256(a), USDC, 200_000 * USDC);
        uint256 y = bound(uint256(b), USDC, 200_000 * USDC);
        int256 s0 = int256(bound(int256(skew), -int256(500_000 * USDC), int256(500_000 * USDC)));
        uint256 one = _fill(s0, true, x + y) * (x + y);
        uint256 split = _fill(s0, true, x) * x + _fill(s0 + int256(x), true, y) * y;
        // Splitting may differ only by rounding: the average premium is whole
        // bps, so each slice can be off by < 1 bps of its value (cost here is
        // price E6 × notional).
        assertGe(split + (2 * (x + y) * E6) / 10_000, one);
    }
}
