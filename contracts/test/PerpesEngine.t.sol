// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PerpesEngine} from "../src/PerpesEngine.sol";
import {PerpesToken} from "../src/PerpesToken.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Defaults} from "../script/Defaults.sol";

contract PerpesEngineTest is Test {
    uint256 constant USDC = 1e6;

    PerpesEngine engine;
    MockUSDC usdc;
    address admin = makeAddr("admin");
    address protocolWallet = makeAddr("protocol");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address keeper = makeAddr("keeper");
    address token;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        PerpesEngine.Config memory c = Defaults.config(protocolWallet, protocolWallet, treasury);
        c.launchFeeWei = 0.1 ether;
        PerpesEngine impl = new PerpesEngine();
        engine = PerpesEngine(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(PerpesEngine.initialize, (admin, IERC20(address(usdc)), c))))
        );
        address[4] memory traders = [alice, bob, carol, creator];
        for (uint256 i; i < traders.length; i++) {
            usdc.mint(traders[i], 1_000_000 * USDC);
            vm.prank(traders[i]);
            usdc.approve(address(engine), type(uint256).max);
        }
        vm.deal(creator, 10 ether);
        token = _launch(creator, "Aura", "AURA", bytes32(0));
    }

    function _launch(address who, string memory name, string memory symbol, bytes32 salt) internal returns (address) {
        PerpesEngine.LaunchParams memory p = PerpesEngine.LaunchParams({
            name: name,
            symbol: symbol,
            uri: "ipfs://meta",
            imageUrl: "https://img",
            description: "desc",
            twitter: "",
            telegram: "",
            website: "",
            cashbackEnabled: false,
            salt: salt
        });
        vm.prank(who);
        return engine.createTokenAndMarket{value: 0.1 ether}(p);
    }

    function _skip(uint256 secs) internal {
        vm.warp(vm.getBlockTimestamp() + secs);
    }

    function _market() internal view returns (PerpesEngine.Market memory) {
        return engine.getMarket(token);
    }

    function _pos(address who) internal view returns (PerpesEngine.Position memory) {
        return engine.getPosition(token, who);
    }

    function _open(address who, PerpesEngine.Side side, uint256 collateral, uint256 notional) internal {
        vm.prank(who);
        engine.openPosition(token, side, collateral, notional, 0);
    }

    function _closeAll(address who) internal {
        uint256 size = _pos(who).sizeUsdc;
        vm.prank(who);
        engine.closePosition(token, size, 0);
    }

    /// The engine's USDC balance always equals what the markets account for.
    function _assertSolvent() internal view {
        uint256 accounted;
        uint256 n = engine.marketCount();
        for (uint256 i; i < n; i++) {
            PerpesEngine.Market memory m = engine.getMarket(engine.allMarkets(i));
            accounted += m.vaultBalanceUsdc + m.orderEscrowUsdc;
        }
        assertEq(usdc.balanceOf(address(engine)), accounted, "vault accounting drift");
    }

    // ── Launch ───────────────────────────────────────────────────────────────

    function test_launchMintsWholeSupplyToEngineAndPaysTreasury() public view {
        assertEq(PerpesToken(token).totalSupply(), 1_000_000_000 ether);
        assertEq(PerpesToken(token).balanceOf(address(engine)), 1_000_000_000 ether);
        assertEq(PerpesToken(token).balanceOf(creator), 0);
        assertEq(treasury.balance, 0.1 ether);
        assertEq(engine.creatorLaunchCount(creator), 1);
        PerpesEngine.Market memory m = _market();
        assertEq(uint8(m.status), uint8(PerpesEngine.MarketStatus.Warmup));
        assertEq(m.markPriceE6, 1_000_000);
        assertEq(m.creator, creator);
    }

    function test_launchRefundsExcessAndPredictsAddress() public {
        address predicted = engine.predictTokenAddress(creator, bytes32(uint256(7)), "Lift", "LIFT", "ipfs://meta");
        uint256 before = creator.balance;
        PerpesEngine.LaunchParams memory p = PerpesEngine.LaunchParams(
            "Lift", "LIFT", "ipfs://meta", "", "", "", "", "", true, bytes32(uint256(7))
        );
        vm.prank(creator);
        address t = engine.createTokenAndMarket{value: 1 ether}(p);
        assertEq(t, predicted);
        assertEq(before - creator.balance, 0.1 ether);
    }

    function test_launchRejectsUnderpaymentAndPause() public {
        PerpesEngine.LaunchParams memory p =
            PerpesEngine.LaunchParams("X", "X", "", "", "", "", "", "", false, bytes32(uint256(1)));
        vm.prank(creator);
        vm.expectRevert(PerpesEngine.InvalidLaunchFee.selector);
        engine.createTokenAndMarket{value: 0.01 ether}(p);

        vm.prank(admin);
        engine.setLaunchPaused(true);
        vm.prank(creator);
        vm.expectRevert(PerpesEngine.ProtocolPaused.selector);
        engine.createTokenAndMarket{value: 0.1 ether}(p);
    }

    function test_launchRejectsLongSymbol() public {
        PerpesEngine.LaunchParams memory p =
            PerpesEngine.LaunchParams("X", "TOOLONGSYMBOL", "", "", "", "", "", "", false, bytes32(uint256(1)));
        vm.prank(creator);
        vm.expectRevert(PerpesEngine.SymbolTooLong.selector);
        engine.createTokenAndMarket{value: 0.1 ether}(p);
    }

    // ── vAMM pricing ─────────────────────────────────────────────────────────

    function test_longMovesPriceUpShortMovesItDown() public {
        // $10k depth: $1k of notional ≈ +21%.
        _open(alice, PerpesEngine.Side.Long, 100 * USDC, 1_000 * USDC);
        uint256 afterLong = _market().markPriceE6;
        assertApproxEqAbs(afterLong, 1_210_000, 1_000);
        _closeAll(alice);
        assertApproxEqAbs(_market().markPriceE6, 1_000_000, 2);

        _open(bob, PerpesEngine.Side.Short, 100 * USDC, 1_000 * USDC);
        assertApproxEqAbs(_market().markPriceE6, 810_000, 1_000);
        _assertSolvent();
    }

    function test_roundTripLosesOnlyFees() public {
        uint256 before = usdc.balanceOf(alice);
        _open(alice, PerpesEngine.Side.Long, 100 * USDC, 1_000 * USDC);
        _closeAll(alice);
        uint256 lost = before - usdc.balanceOf(alice);
        // 10 bps in + 10 bps out (+ rounding against the trader).
        assertApproxEqAbs(lost, 2 * USDC, 3);
        assertEq(_pos(alice).sizeUsdc, 0);
        _assertSolvent();
    }

    function test_tradersPnlIsZeroSumAndVaultKeepsOnlyReserved() public {
        _open(alice, PerpesEngine.Side.Long, 300 * USDC, 3_000 * USDC);
        _open(bob, PerpesEngine.Side.Long, 3_500 * USDC, 7_000 * USDC);
        uint256 aBefore = usdc.balanceOf(alice);
        _closeAll(alice);
        assertGt(usdc.balanceOf(alice) - aBefore, 300 * USDC, "early buyer profits");
        _closeAll(bob);

        PerpesEngine.Market memory m = _market();
        assertEq(m.oiLongUsdc, 0);
        assertEq(m.baseLong, 0);
        // Everything left in the vault is fees/insurance (+ curve rounding dust).
        uint256 reserved = m.insuranceTrancheUsdc + m.creatorFeesPendingUsdc + m.protocolFeesPendingUsdc;
        assertApproxEqAbs(m.vaultBalanceUsdc, reserved, 10);
        assertGe(m.vaultBalanceUsdc, reserved);
        _assertSolvent();
    }

    /// On the curve a winner is paid from the losers' collateral: in full while
    /// it's there — claims are valued at what positions would realize unwinding
    /// through the curve, not at the marginal price.
    function test_primaryWinnerIsPaidInFull() public {
        _open(alice, PerpesEngine.Side.Long, 300 * USDC, 3_000 * USDC);
        _open(bob, PerpesEngine.Side.Long, 3_500 * USDC, 7_000 * USDC);
        assertEq(engine.payoutRatioBps(token), 10_000, "every long looks like a winner at the mark, but not in an unwind");
        _closeAll(alice);
        assertEq(_pos(alice).unsettledProfitUsdc, 0);
        _closeAll(bob);
        _assertSolvent();
    }

    /// A loser whose loss ran past their collateral leaves the winner less than
    /// their profit: the winner gets their collateral back and the rest pro
    /// rata to what the market holds — forfeited, not owed.
    function test_primaryLossesPastCollateralArePaidProRataNotOwed() public {
        _skip(1 days); // past the 10x warmup
        engine.poke(token);
        _open(carol, PerpesEngine.Side.Long, 50 * USDC, 2_000 * USDC); // 40x
        _open(bob, PerpesEngine.Side.Short, 2_000 * USDC, 4_000 * USDC); // dump
        _skip(1 hours); // index follows the mark down
        vm.prank(keeper);
        engine.liquidate(token, carol);
        assertGt(_market().badDebtUsdc, 0, "carol lost more than her $50");

        assertLt(engine.payoutRatioBps(token), 10_000, "bob's profit outruns what's left");
        (,, int256 funding,) = engine.positionHealth(token, bob);
        uint256 collateral = uint256(int256(_pos(bob).collateralUsdc) + funding);
        uint256 before = usdc.balanceOf(bob);
        _closeAll(bob);
        assertEq(_pos(bob).unsettledProfitUsdc, 0, "nothing owed");
        assertGe(usdc.balanceOf(bob) - before, collateral, "collateral back in full");
        _assertSolvent();
    }

    function test_slippageGuard() public {
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.SlippageExceeded.selector);
        engine.openPosition(token, PerpesEngine.Side.Long, 100 * USDC, 1_000 * USDC, 500); // 5% max, moves ~10% avg
    }

    function test_partialClose() public {
        _open(alice, PerpesEngine.Side.Long, 200 * USDC, 1_000 * USDC);
        vm.prank(alice);
        engine.closePosition(token, 400 * USDC, 0);
        PerpesEngine.Position memory p = _pos(alice);
        assertEq(p.sizeUsdc, 600 * USDC);
        assertApproxEqAbs(p.collateralUsdc, 120 * USDC, 1);
        _closeAll(alice);
        _assertSolvent();
    }

    function test_cannotFlipSideWithoutClosing() public {
        _open(alice, PerpesEngine.Side.Long, 100 * USDC, 500 * USDC);
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.PositionSideMismatch.selector);
        engine.openPosition(token, PerpesEngine.Side.Short, 100 * USDC, 500 * USDC, 0);
    }

    // ── Leverage ────────────────────────────────────────────────────────────

    function test_warmupCapsLeverageAt10xThen40x() public {
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.LeverageTooHigh.selector);
        engine.openPosition(token, PerpesEngine.Side.Long, 10 * USDC, 110 * USDC, 0);

        _open(alice, PerpesEngine.Side.Long, 10 * USDC, 100 * USDC);
        _closeAll(alice);

        _skip(1 days + 1);
        // 40x passes the leverage gate, but initial entry on a thin curve must
        // still clear maintenance — use a small size so impact is tiny.
        _open(alice, PerpesEngine.Side.Long, 1 * USDC, 30 * USDC);
        assertEq(uint8(_market().status), uint8(PerpesEngine.MarketStatus.Active));
    }

    function test_removeCollateralCannotBreachInitialMargin() public {
        // Entry ≈1.05, index still 1.00 → ≈ −$24 at the index, which counts.
        _open(alice, PerpesEngine.Side.Long, 200 * USDC, 500 * USDC);
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.WithdrawalBreachesMargin.selector);
        engine.removeCollateral(token, 150 * USDC);
        vm.prank(alice);
        engine.removeCollateral(token, 100 * USDC);
        assertEq(_pos(alice).collateralUsdc, 100 * USDC);
        _assertSolvent();
    }

    function test_addCollateral() public {
        _open(alice, PerpesEngine.Side.Long, 100 * USDC, 500 * USDC);
        vm.prank(alice);
        engine.addCollateral(token, 25 * USDC);
        assertEq(_pos(alice).collateralUsdc, 125 * USDC);
        _assertSolvent();
    }

    // ── Liquidation ─────────────────────────────────────────────────────────

    function test_singleBlockDumpDoesNotLiquidateButSustainedOneDoes() public {
        // Small relative to the $10k curve so the liquidation's own exit impact
        // leaves equity for the reward (a big position exits underwater).
        _open(alice, PerpesEngine.Side.Long, 10 * USDC, 100 * USDC); // 10x
        _skip(600); // index catches up to alice's entry
        engine.poke(token);
        _open(bob, PerpesEngine.Side.Short, 50 * USDC, 328 * USDC); // dump to ~0.955

        (, bool liquidatable,,) = engine.positionHealth(token, alice);
        assertFalse(liquidatable, "index still high");
        vm.prank(keeper);
        vm.expectRevert(PerpesEngine.LiquidationNotAllowed.selector);
        engine.liquidate(token, alice);

        _skip(600); // index follows the mark down
        (, liquidatable,,) = engine.positionHealth(token, alice);
        assertTrue(liquidatable);
        vm.prank(keeper);
        engine.liquidate(token, alice);
        assertEq(_pos(alice).sizeUsdc, 0);
        assertGt(usdc.balanceOf(keeper), 0, "liquidator rewarded");
        _closeAll(bob);
        _assertSolvent();
    }

    function test_healthyPositionCannotBeLiquidated() public {
        _open(alice, PerpesEngine.Side.Long, 500 * USDC, 1_000 * USDC);
        vm.expectRevert(PerpesEngine.LiquidationNotAllowed.selector);
        engine.liquidate(token, alice);
    }

    // ── TP / SL ─────────────────────────────────────────────────────────────

    function test_takeProfitExecutesToOwner() public {
        _open(alice, PerpesEngine.Side.Long, 100 * USDC, 500 * USDC);
        uint256 entry = _pos(alice).entryPriceE6;
        vm.prank(alice);
        engine.setTriggers(token, entry * 11 / 10, 0);

        vm.expectRevert(PerpesEngine.TriggerNotHit.selector);
        engine.executeTrigger(token, alice);

        _open(bob, PerpesEngine.Side.Long, 200 * USDC, 2_000 * USDC); // pumps the mark
        (bool hit, bool tp) = engine.triggerStatus(token, alice);
        assertTrue(hit && tp);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(keeper);
        engine.executeTrigger(token, alice);
        assertGt(usdc.balanceOf(alice) - before, 100 * USDC);
        assertEq(_pos(alice).sizeUsdc, 0);
        assertEq(_pos(alice).tpPriceE6, 0);
        _assertSolvent();
    }

    function test_stopLossNeedsIndexToo() public {
        _open(alice, PerpesEngine.Side.Long, 500 * USDC, 1_000 * USDC); // 2x, survives the dump
        _skip(600);
        engine.poke(token);
        uint256 entry = _pos(alice).entryPriceE6;
        vm.prank(alice);
        engine.setTriggers(token, 0, entry * 9 / 10);
        _open(bob, PerpesEngine.Side.Short, 500 * USDC, 2_000 * USDC);
        (bool hit,) = engine.triggerStatus(token, alice);
        assertFalse(hit, "mark alone is not enough");
        _skip(600);
        (hit,) = engine.triggerStatus(token, alice);
        assertTrue(hit);
        engine.executeTrigger(token, alice);
        assertEq(_pos(alice).sizeUsdc, 0);
        _assertSolvent();
    }

    function test_invalidTriggerRejected() public {
        _open(alice, PerpesEngine.Side.Long, 100 * USDC, 500 * USDC);
        uint256 entry = _pos(alice).entryPriceE6;
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.InvalidTrigger.selector);
        engine.setTriggers(token, entry - 1, 0);
    }

    // ── Limit orders ────────────────────────────────────────────────────────

    function test_limitOrderExecutesWhenMarkCrossesAndPaysExecutor() public {
        vm.prank(alice);
        uint256 id = engine.placeLimitOrder(
            token, PerpesEngine.Side.Long, PerpesEngine.OrderType.Limit, 50 * USDC, 5, 950_000, 0, false, 0
        );
        assertEq(_market().orderEscrowUsdc, 50 * USDC);
        _assertSolvent();

        vm.prank(keeper);
        vm.expectRevert(PerpesEngine.OrderTriggerNotMet.selector);
        engine.executeLimitOrder(id, 250 * USDC);

        _open(bob, PerpesEngine.Side.Short, 100 * USDC, 500 * USDC); // mark → ~0.90
        vm.prank(keeper);
        engine.executeLimitOrder(id, 250 * USDC);
        PerpesEngine.LimitOrder memory o = engine.getOrder(id);
        assertEq(uint8(o.status), uint8(PerpesEngine.OrderStatus.Filled));
        assertEq(o.collateralUsdc, 0);
        assertEq(_market().orderEscrowUsdc, 0);
        assertEq(_pos(alice).sizeUsdc, 250 * USDC);
        assertEq(usdc.balanceOf(keeper), 25_000); // 0.01% of $250
        assertEq(engine.activeOrderCount(alice, token), 0);
        _assertSolvent();
    }

    function test_partialFillsConsumeAllEscrow() public {
        vm.prank(alice);
        uint256 id = engine.placeLimitOrder(
            token, PerpesEngine.Side.Long, PerpesEngine.OrderType.StopMarket, 100 * USDC, 4, 0, 1_050_000, false, 0
        );
        _open(bob, PerpesEngine.Side.Long, 100 * USDC, 500 * USDC); // mark → ~1.10
        engine.executeLimitOrder(id, 100 * USDC);
        engine.executeLimitOrder(id, 300 * USDC);
        assertEq(engine.getOrder(id).collateralUsdc, 0);
        assertEq(_market().orderEscrowUsdc, 0);
        _assertSolvent();
    }

    function test_iocRefundsUnfilledRemainder() public {
        _open(bob, PerpesEngine.Side.Short, 100 * USDC, 500 * USDC); // mark ~0.90
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 id = engine.placeLimitOrder(
            token, PerpesEngine.Side.Long, PerpesEngine.OrderType.ImmediateOrCancel, 100 * USDC, 4, 1_000_000, 0, false, 0
        );
        engine.executeLimitOrder(id, 100 * USDC);
        assertEq(uint8(engine.getOrder(id).status), uint8(PerpesEngine.OrderStatus.Cancelled));
        assertEq(_market().orderEscrowUsdc, 0);
        // spent: 25 collateral for the $100 slice; 75 refunded
        assertEq(before - usdc.balanceOf(alice), 25 * USDC);
        _assertSolvent();
    }

    function test_cancelRefundsAndOnlyTraderMayCancel() public {
        vm.prank(alice);
        uint256 id = engine.placeLimitOrder(
            token, PerpesEngine.Side.Short, PerpesEngine.OrderType.Limit, 50 * USDC, 2, 1_200_000, 0, true, 0
        );
        vm.prank(bob);
        vm.expectRevert(PerpesEngine.Unauthorized.selector);
        engine.cancelLimitOrder(id);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        engine.cancelLimitOrder(id);
        assertEq(usdc.balanceOf(alice) - before, 50 * USDC);
        _assertSolvent();
    }

    function test_expiredOrderCancellableByAnyone() public {
        vm.prank(alice);
        uint256 id = engine.placeLimitOrder(
            token, PerpesEngine.Side.Long, PerpesEngine.OrderType.Limit, 50 * USDC, 2, 900_000, 0, false, uint64(vm.getBlockTimestamp() + 60)
        );
        _skip(61);
        vm.prank(keeper);
        engine.cancelLimitOrder(id);
        assertEq(uint8(engine.getOrder(id).status), uint8(PerpesEngine.OrderStatus.Cancelled));
    }

    function test_postOnlyRejectsCrossingOrder() public {
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.PostOnlyRejection.selector);
        engine.placeLimitOrder(token, PerpesEngine.Side.Long, PerpesEngine.OrderType.Limit, 50 * USDC, 2, 1_100_000, 0, true, 0);
    }

    // ── Funding ─────────────────────────────────────────────────────────────

    function test_crowdedLongPaysFunding() public {
        _open(alice, PerpesEngine.Side.Long, 5_000 * USDC, 20_000 * USDC); // lone long, full skew → 25 bps/h cap
        uint256 c0 = _pos(alice).collateralUsdc;
        _skip(1 hours);
        vm.prank(alice);
        engine.addCollateral(token, 1); // touches and settles
        uint256 paid = c0 + 1 - _pos(alice).collateralUsdc;
        assertApproxEqAbs(paid, 50 * USDC, 1); // 25 bps of $20k
        _closeAll(alice);
        _assertSolvent();
    }

    // ── Fees ────────────────────────────────────────────────────────────────

    function test_feeSplitAndClaims() public {
        _open(alice, PerpesEngine.Side.Long, 1_000 * USDC, 5_000 * USDC); // fee $5
        PerpesEngine.Market memory m = _market();
        assertEq(m.creatorFeesPendingUsdc, 1_250_000); // 25% unqualified
        assertEq(m.insuranceTrancheUsdc, 500_000); // 10%
        assertEq(m.protocolFeesPendingUsdc, 3_250_000);

        vm.prank(bob);
        vm.expectRevert(PerpesEngine.Unauthorized.selector);
        engine.claimCreatorFees(token);

        uint256 before = usdc.balanceOf(creator);
        vm.prank(creator);
        engine.claimCreatorFees(token);
        assertEq(usdc.balanceOf(creator) - before, 1_250_000);

        vm.prank(protocolWallet);
        engine.claimProtocolFees(token);
        assertEq(usdc.balanceOf(protocolWallet), 3_250_000);
        _assertSolvent();
    }

    function test_delistedMarketBlocksOpensButAllowsCloses() public {
        _open(alice, PerpesEngine.Side.Long, 100 * USDC, 500 * USDC);
        vm.prank(admin);
        engine.delistMarket(token);
        vm.prank(bob);
        vm.expectRevert(PerpesEngine.InvalidMarketStatus.selector);
        engine.openPosition(token, PerpesEngine.Side.Long, 100 * USDC, 500 * USDC, 0);
        _closeAll(alice);
        _assertSolvent();
    }

    function test_onlyOwnerAdmin() public {
        PerpesEngine.Config memory c = engine.config();
        vm.prank(alice);
        vm.expectRevert();
        engine.setConfig(c);
        address impl = address(new PerpesEngine());
        vm.prank(alice);
        vm.expectRevert();
        engine.upgradeToAndCall(impl, "");
        vm.prank(admin);
        engine.upgradeToAndCall(impl, "");
        assertEq(_market().creator, creator, "state survives upgrade");
    }

    // ── Audit fixes ───────────────────────────────────────────────────────────

    function test_tradingPauseBlocksNewRiskButNotExits() public {
        _open(alice, PerpesEngine.Side.Long, 100 * USDC, 500 * USDC);
        vm.prank(admin);
        engine.setTradingPaused(true);
        vm.prank(bob);
        vm.expectRevert(PerpesEngine.TradingPaused.selector);
        engine.openPosition(token, PerpesEngine.Side.Long, 100 * USDC, 500 * USDC, 0);
        vm.prank(bob);
        vm.expectRevert(PerpesEngine.TradingPaused.selector);
        engine.placeLimitOrder(token, PerpesEngine.Side.Long, PerpesEngine.OrderType.Limit, 50 * USDC, 2, 900_000, 0, false, 0);
        vm.prank(alice);
        engine.addCollateral(token, 10 * USDC);
        _closeAll(alice);
        vm.prank(alice);
        vm.expectRevert();
        engine.setTradingPaused(false);
        _assertSolvent();
    }

    function test_removeCollateralCannotReachReservedFunds() public {
        // A lone long funds a small short; once the long is liquidated its unpaid
        // funding leaves the short holding more collateral than traders' money.
        _open(bob, PerpesEngine.Side.Long, 2_000 * USDC, 20_000 * USDC);
        _open(alice, PerpesEngine.Side.Short, 1_000 * USDC, 1_000 * USDC);
        _skip(4_000 hours);
        (, bool liquidatable,,) = engine.positionHealth(token, bob);
        assertTrue(liquidatable, "funding has eaten the long");
        engine.liquidate(token, bob);
        vm.prank(alice);
        engine.addCollateral(token, 1); // settle alice's funding credits
        PerpesEngine.Market memory m = _market();
        uint256 reserved = m.insuranceTrancheUsdc + m.creatorFeesPendingUsdc + m.protocolFeesPendingUsdc;
        uint256 headroom = m.vaultBalanceUsdc - reserved;
        uint256 attempt = headroom + 1;
        assertGt(_pos(alice).collateralUsdc, attempt, "short was over-credited");
        assertLe(attempt, m.vaultBalanceUsdc, "without the cap this would succeed");
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.InsufficientVaultHeadroom.selector);
        engine.removeCollateral(token, attempt);
        _assertSolvent();
    }

    function test_addingToPositionDropsTriggerNowOnWrongSide() public {
        _open(alice, PerpesEngine.Side.Long, 100 * USDC, 300 * USDC);
        uint256 entry = _pos(alice).entryPriceE6;
        vm.prank(alice);
        engine.setTriggers(token, entry + 10_000, entry - 10_000);
        _open(bob, PerpesEngine.Side.Long, 300 * USDC, 1_500 * USDC); // pump
        _open(alice, PerpesEngine.Side.Long, 100 * USDC, 500 * USDC); // average up past the TP
        PerpesEngine.Position memory p = _pos(alice);
        assertGt(p.entryPriceE6, entry + 10_000);
        assertEq(p.tpPriceE6, 0, "stale TP cleared");
        assertEq(p.slPriceE6, entry - 10_000, "SL still below entry, kept");
    }

    function test_fundingOwedBeyondCollateralIsCarriedNotForgiven() public {
        _open(bob, PerpesEngine.Side.Long, 2_000 * USDC, 20_000 * USDC); // big curve profit
        _open(alice, PerpesEngine.Side.Short, 1_000 * USDC, 1_000 * USDC);
        _skip(150 hours); // ~$6.8k of funding owed vs $2k collateral, still in profit
        (int256 ratio, bool liq, int256 pending, int256 upnl) = engine.positionHealth(token, bob);
        assertLt(pending, -int256(2_000 * USDC), "owes more than collateral");
        assertGt(upnl + pending + int256(2_000 * USDC), 0, "but still solvent");
        assertFalse(liq);
        ratio;
        uint256 before = usdc.balanceOf(bob);
        _closeAll(bob);
        uint256 got = usdc.balanceOf(bob) - before;
        // Proceeds = collateral + PnL − funding owed − fee; the excess over
        // collateral must not be forgiven.
        assertLe(int256(got), int256(2_000 * USDC) + upnl + pending, "debt paid from proceeds");
        _assertSolvent();
    }

    function test_positionStateLogMatchesDeclaredEvent() public {
        _open(alice, PerpesEngine.Side.Long, 100 * USDC, 500 * USDC);
        PerpesEngine.Position memory p = _pos(alice);
        uint256 tp = p.entryPriceE6 * 2;
        vm.expectEmit(true, true, false, true, address(engine));
        emit PerpesEngine.PositionState(
            alice, token, p.side, p.sizeUsdc, p.baseAmount, p.collateralUsdc, p.entryPriceE6, tp, 0, false, 0
        );
        vm.prank(alice);
        engine.setTriggers(token, tp, 0);
    }

    // ── Fuzz: random flow stays solvent and fully unwinds ──────────────────

    function testFuzz_randomFlowStaysSolvent(uint256 seed) public {
        address[3] memory who = [alice, bob, carol];
        for (uint256 i; i < 12; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address t = who[seed % 3];
            PerpesEngine.Position memory p = _pos(t);
            _skip((seed >> 8) % 900);
            if (p.sizeUsdc > 0 && (seed >> 16) % 3 == 0) {
                uint256 amt = (seed >> 24) % 2 == 0 ? p.sizeUsdc : p.sizeUsdc / 2;
                vm.prank(t);
                try engine.closePosition(token, amt, 0) {} catch {}
            } else {
                PerpesEngine.Side side = p.sizeUsdc > 0 ? p.side : PerpesEngine.Side((seed >> 32) % 2);
                uint256 collateral = 10 * USDC + ((seed >> 40) % 500) * USDC;
                uint256 lev = 1 + (seed >> 56) % 5;
                vm.prank(t);
                try engine.openPosition(token, side, collateral, collateral * lev, 0) {} catch {}
            }
            for (uint256 j; j < 3; j++) {
                try engine.liquidate(token, who[j]) {} catch {}
            }
            _assertSolvent();
        }
        // Unwind longs before shorts: a short buys base back from the curve,
        // which can't happen while longs hold most of it.
        for (uint256 pass; pass < 2; pass++) {
            for (uint256 j; j < 3; j++) {
                PerpesEngine.Position memory p = _pos(who[j]);
                if (p.sizeUsdc == 0 || (pass == 0 && p.side == PerpesEngine.Side.Short)) continue;
                vm.prank(who[j]);
                try engine.closePosition(token, p.sizeUsdc, 0) {}
                catch {
                    engine.liquidate(token, who[j]);
                }
            }
        }
        PerpesEngine.Market memory m = _market();
        assertEq(m.oiLongUsdc + m.oiShortUsdc, 0);
        _assertSolvent();
    }
}
