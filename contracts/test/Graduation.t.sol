// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {PerpesEngine} from "../src/PerpesEngine.sol";
import {PerpesUniswap} from "../src/PerpesUniswap.sol";
import {Defaults} from "../script/Defaults.sol";
import {Fixture} from "./utils/Fixture.sol";

/// Graduation to Uniswap v4 and the secondary engine with its on-chain oracle
/// (no Counterflow here — these markets are unbacked).
contract GraduationTest is Fixture {
    address token;

    function setUp() public {
        _deployStack(false, address(0), address(0));
        token = _launch("AURA");
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function _market() internal view returns (PerpesEngine.Market memory) {
        return engine.getMarket(token);
    }

    function _sec() internal view returns (PerpesEngine.Secondary memory) {
        return engine.getSecondary(token);
    }

    function _pos(address who) internal view returns (PerpesEngine.Position memory) {
        return engine.getPosition(token, who);
    }

    function _open(address who, PerpesEngine.Side side, uint256 collateral, uint256 notional) internal {
        _open(token, who, side, collateral, notional);
    }

    function _closeAll(address who) internal {
        _closeAll(token, who);
    }

    function _key() internal view returns (PoolKey memory) {
        return engine.graduationPoolKey(token);
    }

    function _tokenIs0() internal view returns (bool) {
        return token < address(usdc);
    }

    /// Some two-sided primary trading so fees accrue and the index settles.
    function _tradePrimary() internal {
        _open(alice, PerpesEngine.Side.Long, 500 * USDC, 2_000 * USDC);
        _open(bob, PerpesEngine.Side.Short, 500 * USDC, 1_600 * USDC);
        _skip(1 hours);
    }

    function _approve(bool adminOverride) internal {
        vm.prank(admin);
        engine.approveGraduation(token, adminOverride);
    }

    function _graduate(uint256 seedUsdc) internal {
        uint256 index = engine.previewMarket(token).indexPriceE6;
        vm.prank(operator);
        engine.graduate(token, seedUsdc, index / 2, index * 2);
    }

    function _graduated() internal {
        _tradePrimary();
        _approve(true);
        _graduate(50_000 * USDC);
    }

    function _poke() internal {
        engine.poke(token);
    }

    function _buyTokens(address who, uint256 usdcIn) internal {
        _swap(_key(), who, address(usdc), usdcIn);
    }

    function _sellTokens(address who, uint256 tokensIn) internal {
        _swap(_key(), who, token, tokensIn);
    }

    // ── Eligibility / approval ───────────────────────────────────────────────

    function test_eligibilityIsMeasuredOnChain() public {
        _tradePrimary();
        _open(carol, PerpesEngine.Side.Long, 1_000 * USDC, 3_000 * USDC);
        _closeAll(alice);

        PerpesEngine.Eligibility memory e = engine.graduationEligibility(token);
        assertEq(e.uniqueTraders, 3, "alice, bob, carol");
        assertEq(e.peakOiUsdc, 6_600 * USDC, "peak before alice closed");
        assertEq(e.ageSeconds, 1 hours);
        assertGt(e.volumeUsdc, 8_000 * USDC);
        assertFalse(e.allMet, "default thresholds are far above this");

        PerpesEngine.SecondaryConfig memory c = Defaults.secondaryConfig();
        c.minAgeSeconds = 1 hours;
        c.minUniqueTraders = 3;
        c.minVolumeUsdc = 8_000 * USDC;
        c.minPeakOiUsdc = 6_000 * USDC;
        vm.prank(admin);
        engine.setSecondaryConfig(c);
        assertTrue(engine.graduationEligibility(token).allMet);
    }

    function test_approvalNeedsEligibilityOwnerAndConfig() public {
        _tradePrimary();
        vm.prank(admin);
        vm.expectRevert(PerpesEngine.EligibilityNotMet.selector);
        engine.approveGraduation(token, false);

        vm.prank(operator);
        vm.expectRevert();
        engine.approveGraduation(token, true);

        _approve(true);
        PerpesEngine.Secondary memory s = _sec();
        assertTrue(s.approved);
        assertTrue(s.adminOverride);
        assertEq(s.cfg.initialMaxLeverageX, 15, "config snapshotted");

        vm.prank(admin);
        engine.revokeGraduation(token);
        assertFalse(_sec().approved);
        vm.prank(operator);
        vm.expectRevert(PerpesEngine.InvalidEngineTransition.selector);
        engine.graduate(token, 1_000 * USDC, 0, type(uint256).max);
    }

    function test_onlyOperatorGraduatesAndPriceBoundsApply() public {
        _tradePrimary();
        _approve(true);
        uint256 index = engine.previewMarket(token).indexPriceE6;

        vm.prank(alice);
        vm.expectRevert(PerpesEngine.Unauthorized.selector);
        engine.graduate(token, 10_000 * USDC, 0, type(uint256).max);

        vm.prank(operator);
        vm.expectRevert(PerpesEngine.SlippageExceeded.selector);
        engine.graduate(token, 10_000 * USDC, index + 1, type(uint256).max);
    }

    // ── Graduation ───────────────────────────────────────────────────────────

    function test_graduateSeedsPoolLocksLpAndBurnsSupply() public {
        _tradePrimary();
        _approve(true);
        PerpesEngine.Market memory before = engine.previewMarket(token);
        uint256 fees = before.protocolFeesPendingUsdc;
        assertGt(fees, 0);
        uint256 operatorBefore = usdc.balanceOf(operator);

        _graduate(50_000 * USDC);

        PerpesEngine.Market memory m = _market();
        PerpesEngine.Secondary memory s = _sec();
        assertEq(uint8(m.status), uint8(PerpesEngine.MarketStatus.Graduated));
        assertTrue(s.active);
        assertFalse(s.backed, "no Counterflow in this suite");
        assertEq(m.protocolFeesPendingUsdc, 0, "protocol fees fund the pool first");
        assertEq(operatorBefore - usdc.balanceOf(operator), 50_000 * USDC - fees, "caller funds the rest");

        assertLe(_bps(engine.spotPriceE6(token), before.indexPriceE6), 1, "pool seeded at the index");
        assertEq(IERC721(positionManager).ownerOf(s.lpTokenId), DEAD, "LP NFT burned");
        assertGt(s.lpLiquidity, 0);
        assertApproxEqAbs(s.seedUsdc, 50_000 * USDC, 2, "all seed USDC in the pool");
        assertApproxEqRel(engine.poolUsdcDepth(token), s.seedUsdc, 1e14);

        assertEq(IERC20(token).balanceOf(address(engine)), 0);
        assertEq(IERC20(token).balanceOf(DEAD) + IERC20(token).balanceOf(address(poolManager)), 1_000_000_000 ether);
        assertApproxEqRel(IERC20(token).balanceOf(address(poolManager)), s.seedTokens, 1e12);

        assertEq(m.indexPriceE6, before.indexPriceE6);
        assertEq(s.oracleE6, before.indexPriceE6);
        assertEq(s.lastSpotE6, before.indexPriceE6);
        assertEq(m.fundingVelocityBps, 10);
        assertEq(m.fundingRateCapBps, 20);
        assertEq(m.maxLeverageX, 15);
        assertEq(s.spotLiquidityUsdc, s.seedUsdc);
        assertEq(s.maxOiUsdc, s.seedUsdc);
        assertEq(s.skewScaleUsdc, s.seedUsdc);
        _assertSolvent();
    }

    function test_cannotGraduateTwiceAndDelistMakesItCloseOnly() public {
        _graduated();
        vm.prank(operator);
        vm.expectRevert(PerpesEngine.InvalidEngineTransition.selector);
        engine.graduate(token, 1_000 * USDC, 0, type(uint256).max);
        vm.prank(admin);
        vm.expectRevert(PerpesEngine.InvalidMarketStatus.selector);
        engine.approveGraduation(token, true);

        vm.prank(admin);
        engine.delistMarket(token);
        assertTrue(_sec().closeOnly);
        assertEq(uint8(_market().status), uint8(PerpesEngine.MarketStatus.Graduated), "pricing unchanged");
        vm.prank(carol);
        vm.expectRevert(PerpesEngine.InvalidMarketStatus.selector);
        engine.openPosition(token, PerpesEngine.Side.Long, 1_000 * USDC, 2_000 * USDC, 0);
        _closeAll(alice);
        assertEq(_pos(alice).sizeUsdc, 0, "exits still work");
    }

    /// Anyone can initialize the v4 pool first at a silly price; graduation
    /// swaps it back into line for (at most) 1 wei.
    function test_preInitializedLowPriceIsCorrectedForFree() public {
        _tradePrimary();
        _approve(true);
        uint256 index = engine.previewMarket(token).indexPriceE6;
        poolManager.initialize(_key(), PerpesUniswap.toSqrtPriceX96(index / 100, _tokenIs0()));

        _graduate(50_000 * USDC);
        assertLe(_bps(engine.spotPriceE6(token), index), 50);
        assertApproxEqAbs(_sec().seedUsdc, 50_000 * USDC, 3);
        _assertSolvent();
    }

    /// An attacker initializes far above the price and parks USDC bids below
    /// it. Graduation sells tokens into those bids — the attacker overpays and
    /// the market keeps the USDC.
    function test_preInitializedHighPriceWithBidsCostsTheAttacker() public {
        _tradePrimary();
        _approve(true);
        uint256 index = engine.previewMarket(token).indexPriceE6;
        bool tokenIs0 = _tokenIs0();
        PoolKey memory key = _key();
        uint160 high = PerpesUniswap.toSqrtPriceX96(index * 10, tokenIs0);
        poolManager.initialize(key, high);

        int24 tick = TickMath.getTickAtSqrtPrice(high);
        int24 spacing = key.tickSpacing;
        int24 aligned = (tick / spacing) * spacing;
        ModifyLiquidityParams memory p = tokenIs0
            ? ModifyLiquidityParams({tickLower: aligned - 50 * spacing, tickUpper: aligned - spacing, liquidityDelta: 1e15, salt: 0})
            : ModifyLiquidityParams({tickLower: aligned + spacing, tickUpper: aligned + 50 * spacing, liquidityDelta: 1e15, salt: 0});
        uint256 attackerBefore = usdc.balanceOf(attacker);
        vm.prank(attacker);
        lpRouter.modifyLiquidity(key, p, "");
        assertGt(attackerBefore - usdc.balanceOf(attacker), 0);
        PerpesEngine.Market memory pre = engine.previewMarket(token);
        uint256 fromFees = pre.protocolFeesPendingUsdc < 50_000 * USDC ? pre.protocolFeesPendingUsdc : 50_000 * USDC;

        _graduate(50_000 * USDC);
        assertLe(_bps(engine.spotPriceE6(token), index), 50, "pool price back in line");
        assertGt(_market().vaultBalanceUsdc + fromFees, pre.vaultBalanceUsdc, "attacker's USDC ends up with the market");
        assertEq(_market().insuranceTrancheUsdc, 0, "as equity: oracle markets carry no insurance");
        _assertSolvent();
    }

    // ── Secondary pricing ────────────────────────────────────────────────────

    function test_fillsPriceOffOracleWithSkewPremiumAndSpread() public {
        _graduated();
        _poke();
        uint256 oracle = _market().indexPriceE6;
        PerpesEngine.Market memory m0 = _market();
        assertEq(int256(m0.oiLongUsdc) - int256(m0.oiShortUsdc), 400 * int256(USDC), "primary positions carried over");

        uint256 quoteLong = engine.quoteSecondary(token, PerpesEngine.Side.Long, 5_000 * USDC);
        uint256 quoteShort = engine.quoteSecondary(token, PerpesEngine.Side.Short, 5_000 * USDC);
        assertGt(quoteLong, oracle, "buying into long skew costs premium + spread");
        assertLt(quoteShort, (oracle * 10_010) / 10_000, "selling into long skew is rewarded");

        _open(carol, PerpesEngine.Side.Long, 1_000 * USDC, 5_000 * USDC);
        assertApproxEqAbs(_pos(carol).entryPriceE6, quoteLong, 1);
        PerpesEngine.Market memory m = _market();
        assertGt(m.markPriceE6, oracle, "mark carries the skew premium");
        assertLe(m.markPriceE6, (oracle * 10_100) / 10_000, "clamped to 1%");
        _assertSolvent();
    }

    function test_splittingAnOrderCostsTheSame() public {
        _graduated();
        _poke();
        uint256 snap = vm.snapshotState();
        _open(carol, PerpesEngine.Side.Long, 2_000 * USDC, 10_000 * USDC);
        uint256 oneBase = _pos(carol).baseAmount;
        vm.revertToState(snap);
        _open(carol, PerpesEngine.Side.Long, 1_000 * USDC, 5_000 * USDC);
        _open(carol, PerpesEngine.Side.Long, 1_000 * USDC, 5_000 * USDC);
        assertApproxEqRel(_pos(carol).baseAmount, oneBase, 1e14, "same base for one order or two halves");
    }

    function test_existingPrimaryPositionsCloseOnTheSecondaryEngine() public {
        _graduated();
        uint256 before = usdc.balanceOf(bob);
        _closeAll(bob);
        assertEq(_pos(bob).sizeUsdc, 0);
        assertGt(usdc.balanceOf(bob), before);
        _closeAll(alice);
        assertEq(_pos(alice).sizeUsdc, 0);
        _assertSolvent();
    }

    // ── On-chain oracle ──────────────────────────────────────────────────────

    /// A pool pumped and dumped within one block never reaches the oracle, and
    /// one held for a second moves it by a fraction of a percent.
    function test_flashMovesBarelyMoveTheOracle() public {
        _graduated();
        _track(token, 6 hours + 60); // transition over: oracle = pool EMA
        uint256 oracle = _sec().oracleE6;

        uint256 bal = IERC20(token).balanceOf(whale);
        _buyTokens(whale, 15_000 * USDC); // pool +~70%
        _poke(); // same second as the last sample: spot read, no EMA step
        assertEq(_sec().oracleE6, oracle, "same-second sample doesn't move the oracle");
        _sellTokens(whale, IERC20(token).balanceOf(whale) - bal);

        _buyTokens(whale, 15_000 * USDC);
        _skip(1);
        _poke(); // held across one second
        assertLt(_bps(_sec().oracleE6, oracle), 30, "one-second manipulation moves it < 0.3%");
    }

    /// No keeper needed: a market idle for a day still trades — at the worse of
    /// the stale oracle and the live pool, so the lag can't be farmed.
    function test_idleMarketTradesAtWorstOfOracleAndPool() public {
        _graduated();
        _skip(1 days);
        _buyTokens(whale, 8_000 * USDC); // pool +~35% while nobody pokes
        uint256 spot = engine.spotPriceE6(token);
        uint256 staleOracle = _sec().oracleE6;
        assertGt(spot, (staleOracle * 130) / 100);

        _open(carol, PerpesEngine.Side.Long, 1_000 * USDC, 2_000 * USDC);
        assertGe(_pos(carol).entryPriceE6, spot, "a long pays at least the live pool price");
        _open(bob, PerpesEngine.Side.Short, 1_000 * USDC, 1_000 * USDC);
        assertLt(_pos(bob).entryPriceE6, spot, "a short can't sell at the pumped pool price");
        _assertSolvent();
    }

    function test_oracleBlendsFromSyntheticToSpotOverTransition() public {
        _graduated();
        uint256 seed = _sec().syntheticSnapshotE6;
        _buyTokens(whale, 6_000 * USDC); // spot up ~25%
        uint256 spot = engine.spotPriceE6(token);
        assertGt(spot, (seed * 115) / 100);

        _track(token, 3 hours); // EMA converges on the pool; half the 6h transition
        assertApproxEqRel(_sec().spotTwapE6, spot, 1e15, "EMA tracked the pool");
        assertApproxEqRel(_sec().oracleE6, (seed + spot) / 2, 5e15, "about 50/50 at half time");

        _track(token, 3 hours);
        assertApproxEqRel(_sec().oracleE6, spot, 1e15, "pure pool price after the transition");
        assertEq(_market().indexPriceE6, _sec().oracleE6);
    }

    function test_breakerTripsWhenThePoolRunsAwayFromTheOracle() public {
        _graduated();
        _track(token, 10 minutes);
        _buyTokens(whale, 7_000 * USDC); // pool +~30% vs a lagging oracle
        _skip(1);
        _poke();
        PerpesEngine.Secondary memory s = _sec();
        assertTrue(s.velocityTripped);
        assertEq(_market().maxLeverageX, 5);
        vm.prank(carol);
        vm.expectRevert(PerpesEngine.LeverageTooHigh.selector);
        engine.openPosition(token, PerpesEngine.Side.Short, 1_000 * USDC, 6_000 * USDC, 0);
        uint256 quarter = s.spotLiquidityUsdc / 4;
        vm.prank(carol);
        vm.expectRevert(PerpesEngine.OpenInterestCapExceeded.selector);
        engine.openPosition(token, PerpesEngine.Side.Short, quarter / 4, quarter, 0);
        _closeAll(bob); // exits still work

        _track(token, 30 minutes); // oracle catches up, breaker resets
        assertFalse(_sec().velocityTripped);
    }

    function test_leverageStepsUpDaily() public {
        _graduated();
        _skip(1 days);
        _poke();
        assertEq(_market().maxLeverageX, 20);
        _skip(10 days);
        _poke();
        assertEq(_market().maxLeverageX, 40);
    }

    /// Liquidity added for one transaction can't inflate the caps; depth that
    /// leaves is reflected at once.
    function test_depthIncreasesAreSmoothedDecreasesImmediate() public {
        _graduated();
        _poke();
        uint256 depth = _sec().spotLiquidityUsdc;
        // Whale buys tokens, then adds a full-range position ~30% the size of the pool's.
        _buyTokens(whale, 20_000 * USDC);
        _addFullRange(_key(), whale, int256(uint256(_sec().lpLiquidity) * 3 / 10));
        uint256 live = engine.poolUsdcDepth(token);
        assertGt(live, depth + depth / 2);
        _skip(1);
        _poke();
        uint256 afterOne = _sec().spotLiquidityUsdc;
        assertLt(afterOne, depth + (live - depth) / 100, "one second of JIT liquidity counts < 1%");

        _addFullRange(_key(), whale, -int256(uint256(_sec().lpLiquidity) * 3 / 10));
        _skip(1);
        _poke();
        assertLe(_sec().spotLiquidityUsdc, engine.poolUsdcDepth(token), "removal reflected at once");
    }

    function test_ownerRetunesAGraduatedMarket() public {
        _graduated();
        PerpesEngine.SecondaryConfig memory c = _sec().cfg;
        c.maxPositionShareBps = 5_000;
        vm.prank(operator);
        vm.expectRevert();
        engine.setMarketSecondaryConfig(token, c);
        vm.prank(admin);
        engine.setMarketSecondaryConfig(token, c);
        assertEq(_sec().cfg.maxPositionShareBps, 5_000);

        c.tickSpacing = 60; // the pool can't change
        vm.prank(admin);
        vm.expectRevert(PerpesEngine.InvalidConfig.selector);
        engine.setMarketSecondaryConfig(token, c);
    }

    // ── Caps ─────────────────────────────────────────────────────────────────

    function test_oiCapAndPerWalletShare() public {
        _graduated();
        _poke();
        uint256 cap = _sec().maxOiUsdc;
        vm.prank(carol);
        vm.expectRevert(PerpesEngine.PositionLimitExceeded.selector);
        engine.openPosition(token, PerpesEngine.Side.Short, 5_000 * USDC, cap / 4 + USDC, 0);
        _open(carol, PerpesEngine.Side.Short, 5_000 * USDC, cap / 4 - 100 * USDC);
    }

    // ── Payouts ──────────────────────────────────────────────────────────────

    /// Unbacked: winners can only claim the market's own free funds. Collateral
    /// comes back in full; the profit beyond what the market holds is forfeited
    /// (no IOU), and the market keeps what it didn't pay.
    function test_profitIsProRataToWhatTheMarketHolds() public {
        _graduated();
        _open(carol, PerpesEngine.Side.Long, 2_500 * USDC, 12_000 * USDC);
        _track(token, 6 hours);
        _buyTokens(whale, 20_000 * USDC);
        _track(token, 30 minutes);
        uint256 ratio = engine.payoutRatioBps(token);
        assertLt(ratio, 10_000, "more open profit than the market holds");
        (,, int256 funding,) = engine.positionHealth(token, carol);
        uint256 collateral = uint256(int256(_pos(carol).collateralUsdc) + funding); // net of funding paid
        uint256 before = usdc.balanceOf(carol);
        _closeAll(carol);
        uint256 paid = usdc.balanceOf(carol) - before;
        assertEq(_pos(carol).unsettledProfitUsdc, 0, "nothing owed: the rest is forfeited");
        assertGt(paid, collateral, "collateral back in full, plus the profit the market can pay");
        _assertSolvent();
    }

    /// Pump, a 12x long at the top, dump: the long is liquidated at the oracle.
    function test_liquidationOnGraduatedMarketUsesOracle() public {
        _graduated();
        _track(token, 6 hours);
        uint256 bal = IERC20(token).balanceOf(whale);
        _buyTokens(whale, 3_000 * USDC); // ~+12%
        _track(token, 30 minutes);
        _open(carol, PerpesEngine.Side.Long, 1_000 * USDC, 12_000 * USDC);
        _sellTokens(whale, IERC20(token).balanceOf(whale) - bal); // back down ~11%
        _track(token, 30 minutes);
        (, bool liquidatable,,) = engine.positionHealth(token, carol);
        assertTrue(liquidatable, "carol underwater");
        engine.liquidate(token, carol);
        assertEq(_pos(carol).sizeUsdc, 0);
        _assertSolvent();
    }

    // ── Limit orders / triggers ──────────────────────────────────────────────

    function test_limitOrderFillsOnGraduatedMarket() public {
        _graduated();
        _poke();
        uint256 limit = (_market().indexPriceE6 * 98) / 100;
        vm.prank(carol);
        uint256 id = engine.placeLimitOrder(
            token, PerpesEngine.Side.Short, PerpesEngine.OrderType.Limit, 500 * USDC, 4, limit, 0, false, 0
        );
        engine.executeLimitOrder(id, 2_000 * USDC);
        assertEq(_pos(carol).sizeUsdc, 2_000 * USDC);
        assertGe(_pos(carol).entryPriceE6, limit, "filled at the limit or better");
        _assertSolvent();
    }

    function test_takeProfitExecutesOnGraduatedMarket() public {
        _graduated();
        _open(carol, PerpesEngine.Side.Long, 2_000 * USDC, 8_000 * USDC);
        uint256 entry = _pos(carol).entryPriceE6;
        vm.prank(carol);
        engine.setTriggers(token, (entry * 105) / 100, 0);
        _track(token, 6 hours);
        _buyTokens(whale, 10_000 * USDC);
        _track(token, 30 minutes);
        (bool hit,) = engine.triggerStatus(token, carol);
        assertTrue(hit);
        engine.executeTrigger(token, carol);
        assertEq(_pos(carol).sizeUsdc, 0);
        _assertSolvent();
    }

    // ── Misc ─────────────────────────────────────────────────────────────────

    function test_unlockCallbackRejectsOutsiders() public {
        vm.expectRevert(PerpesEngine.Unauthorized.selector);
        engine.unlockCallback("");
        vm.prank(address(poolManager));
        vm.expectRevert(PerpesEngine.Unauthorized.selector);
        engine.unlockCallback("");
    }

    function test_configValidation() public {
        PerpesEngine.SecondaryConfig memory c = Defaults.secondaryConfig();
        c.maxExecutionImpactBps = 9_995;
        vm.prank(admin);
        vm.expectRevert(PerpesEngine.InvalidConfig.selector);
        engine.setSecondaryConfig(c);
        c = Defaults.secondaryConfig();
        c.tickSpacing = 0;
        vm.prank(admin);
        vm.expectRevert(PerpesEngine.InvalidConfig.selector);
        engine.setSecondaryConfig(c);
        vm.prank(admin);
        vm.expectRevert(); // reinitializers already used
        engine.initializeGraduation(
            Defaults.secondaryConfig(), PerpesEngine.UniswapV4(address(poolManager), positionManager, permit2), operator
        );
    }

    function test_fundsStayAccountedThroughAFullLifecycle() public {
        _graduated();
        _open(carol, PerpesEngine.Side.Short, 2_000 * USDC, 6_000 * USDC);
        _skip(2 hours);
        _buyTokens(whale, 5_000 * USDC);
        _track(token, 20 minutes);
        _closeAll(alice);
        _closeAll(bob);
        _closeAll(carol);
        _poke();
        _assertSolvent();
        PerpesEngine.Market memory m = _market();
        assertEq(m.oiLongUsdc + m.oiShortUsdc, 0);
    }
}
