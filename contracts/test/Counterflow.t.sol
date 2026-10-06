// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Vm.sol";

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {CounterflowVault} from "../src/CounterflowVault.sol";
import {PerpesEngine} from "../src/PerpesEngine.sol";
import {Defaults} from "../script/Defaults.sol";
import {Fixture} from "./utils/Fixture.sol";

/// Counterflow: every oracle market has its own LP vault, which anyone may back.
contract CounterflowTest is Fixture {
    address token;
    CounterflowVault vault;
    address lp2 = makeAddr("lp2");

    function setUp() public {
        _deployStack(true, address(0), address(0));
        usdc.mint(lp2, 10_000_000 * USDC);
        token = _graduated("AURA");
        vault = _vault(token);
    }

    function _graduated(string memory symbol) internal returns (address t) {
        t = _launch(symbol);
        _skip(1 hours);
        vm.prank(admin);
        engine.approveGraduation(t, true);
        uint256 index = engine.previewMarket(t).indexPriceE6;
        vm.prank(operator);
        engine.graduate(t, 50_000 * USDC, index / 2, index * 2);
    }

    function _key() internal view returns (PoolKey memory) {
        return engine.graduationPoolKey(token);
    }

    function _sec() internal view returns (PerpesEngine.Secondary memory) {
        return engine.getSecondary(token);
    }

    function _market() internal view returns (PerpesEngine.Market memory) {
        return engine.getMarket(token);
    }

    /// Carol goes 10x long $20k, the pool pumps ~49% and the oracle follows.
    function _bigWinner() internal {
        _bigWinner(20_000 * USDC);
    }

    /// The first sample after a deposit picks up the vault's cash (deeper caps).
    function _bigWinner(uint256 notional) internal {
        _skip(1);
        _open(token, carol, PerpesEngine.Side.Long, notional / 10, notional);
        _track(token, 6 hours);
        _swap(_key(), whale, address(usdc), 11_000 * USDC);
        _track(token, 30 minutes);
    }

    /// Pump, carol buys the top with $10k on $20k, dump: a ~30% loss, realized.
    function _bigLoser() internal {
        _track(token, 6 hours);
        uint256 bal = IERC20(token).balanceOf(whale);
        _swap(_key(), whale, address(usdc), 10_000 * USDC);
        _track(token, 30 minutes);
        _open(token, carol, PerpesEngine.Side.Long, 10_000 * USDC, 20_000 * USDC);
        _swap(_key(), whale, token, IERC20(token).balanceOf(whale) - bal);
        _track(token, 30 minutes);
        _closeAll(token, carol);
    }

    // ── Vaults ───────────────────────────────────────────────────────────────

    function test_everyOracleMarketGetsItsOwnVault() public {
        assertTrue(address(vault) != address(0));
        assertEq(vault.market(), token);
        assertEq(vault.engine(), address(engine));
        assertEq(vault.asset(), address(usdc));
        assertEq(vault.name(), "Counterflow AURA");
        assertEq(vault.symbol(), "cfAURA");
        assertEq(vault.decimals(), 12);

        address other = _graduated("ORBT");
        assertTrue(engine.lpVault(other) != address(0) && engine.lpVault(other) != address(vault));

        address primary = _launch("LIFT");
        assertEq(engine.lpVault(primary), address(0), "primary markets have no vault");
        vm.expectRevert(PerpesEngine.NotOracleMarket.selector);
        engine.createLpVault(primary);
        vm.expectRevert(PerpesEngine.LpVaultExists.selector);
        engine.createLpVault(token);
    }

    function test_onlyTheEngineDrivesTheVault() public {
        vm.prank(alice);
        vm.expectRevert(CounterflowVault.OnlyEngine.selector);
        vault.cover(1);
        vm.prank(alice);
        vm.expectRevert(CounterflowVault.OnlyEngine.selector);
        vault.onIncome(1, 1);
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.Unauthorized.selector);
        engine.lpActivate(token);
        vm.expectRevert();
        vault.initialize(alice, token, IERC20(address(usdc)));
    }

    function test_depositsAndCooldownRedemptions() public {
        _lp(token, lp, 1_000_000 * USDC);
        assertApproxEqAbs(vault.totalAssets(), 1_000_000 * USDC, 10, "plus graduation rounding dust");
        uint256 shares = vault.balanceOf(lp);

        // Plain ERC-4626 exits are off; requests wait out the cooldown.
        vm.prank(lp);
        vm.expectRevert();
        vault.redeem(shares, lp, lp);
        vm.prank(lp);
        uint256 id = vault.requestRedeem(shares / 2);
        vm.prank(lp);
        vm.expectRevert();
        vault.claimRedeem(id);
        _skip(3 days);
        vm.prank(bob);
        vm.expectRevert(CounterflowVault.NotRequestOwner.selector);
        vault.claimRedeem(id);
        uint256 before = usdc.balanceOf(lp);
        vm.prank(lp);
        vault.claimRedeem(id);
        assertApproxEqAbs(usdc.balanceOf(lp) - before, 500_000 * USDC, 1);

        // Cancel returns the escrowed shares.
        vm.prank(lp);
        uint256 id2 = vault.requestRedeem(1_000);
        (uint256[] memory ids,) = vault.requestsOf(lp);
        assertEq(ids.length, 1, "claimed requests drop out");
        assertEq(ids[0], id2);
        vm.prank(lp);
        vault.cancelRedeem(id2);
        assertEq(vault.balanceOf(lp), shares - shares / 2);

        PerpesEngine.LpConfig memory c = Defaults.lpConfig(address(vaultBeacon));
        c.depositsPaused = true;
        vm.prank(admin);
        engine.setLpConfig(c);
        assertEq(vault.maxDeposit(lp2), 0);
        vm.startPrank(lp2);
        usdc.approve(address(vault), type(uint256).max);
        vm.expectRevert(CounterflowVault.DepositsClosed.selector);
        vault.deposit(1_000 * USDC, lp2);
        vm.stopPrank();
    }

    function test_delistedMarketsTakeNoDeposits() public {
        vm.prank(admin);
        engine.delistMarket(token);
        assertFalse(engine.lpDepositsOpen(token));
        vm.startPrank(lp);
        usdc.approve(address(vault), type(uint256).max);
        vm.expectRevert(CounterflowVault.DepositsClosed.selector);
        vault.deposit(1_000 * USDC, lp);
        vm.stopPrank();
    }

    // ── Fees ─────────────────────────────────────────────────────────────────

    /// Oracle markets: 70% LPs (kept in the market as its vault's equity), 20%
    /// creator, 10% protocol, no insurance.
    function test_feesSplit70LpsTo20CreatorTo10Protocol() public {
        PerpesEngine.Market memory before = _market();
        _open(token, carol, PerpesEngine.Side.Long, 1_000 * USDC, 10_000 * USDC);
        PerpesEngine.Market memory m = _market();
        uint256 fee = m.totalFeesCollectedUsdc - before.totalFeesCollectedUsdc;
        assertEq(fee, 10 * USDC, "10 bps of $10k");
        assertEq(m.creatorFeesPendingUsdc - before.creatorFeesPendingUsdc, 2 * USDC);
        assertEq(m.protocolFeesPendingUsdc - before.protocolFeesPendingUsdc, 1 * USDC);
        assertEq(m.insuranceTrancheUsdc, before.insuranceTrancheUsdc, "no insurance cut");
        assertEq(m.vaultBalanceUsdc - before.vaultBalanceUsdc, 1_000 * USDC + fee, "the LP 70% stays in the market");
    }

    /// The creator routes half their 20% into the vault: it's deposited in
    /// their name at the next sync, and they hold shares like any LP.
    function test_creatorRoutesFeesIntoTheVault() public {
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.Unauthorized.selector);
        engine.setCreatorLpShare(token, 5_000);
        vm.prank(creator);
        engine.setCreatorLpShare(token, 5_000);

        _lp(token, lp, 100_000 * USDC);
        _open(token, carol, PerpesEngine.Side.Long, 1_000 * USDC, 10_000 * USDC);
        assertEq(_market().creatorLpPendingUsdc, 1 * USDC, "half of the $2 creator share");
        assertEq(_market().creatorFeesPendingUsdc, 1 * USDC);
        (uint256 stake,) = engine.counterflowSurplus(token);
        assertEq(stake, 1 * USDC);

        engine.syncCounterflow(token);
        assertEq(_market().creatorLpPendingUsdc, 0);
        assertGt(vault.balanceOf(creator), 0);
        // Entries price at the higher of the two NAVs (carol's open long moves them apart).
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(creator)), 1 * USDC, 2e15);
        _assertSolvent();
    }

    /// While the vault takes no deposits the set-aside fees wait, and a claim
    /// takes them as cash.
    function test_creatorCanAlwaysClaimSetAsideFees() public {
        vm.prank(creator);
        engine.setCreatorLpShare(token, 10_000);
        _open(token, carol, PerpesEngine.Side.Long, 1_000 * USDC, 10_000 * USDC);
        vm.prank(admin);
        engine.delistMarket(token);
        engine.syncCounterflow(token);
        assertEq(_market().creatorLpPendingUsdc, 2 * USDC, "still waiting");
        uint256 before = usdc.balanceOf(creator);
        vm.prank(creator);
        engine.claimCreatorFees(token);
        assertEq(usdc.balanceOf(creator) - before, 2 * USDC);
        assertEq(_market().creatorLpPendingUsdc, 0);
        _assertSolvent();
    }

    // ── First deposit ────────────────────────────────────────────────────────

    /// What the market earned before anyone backed it goes to the protocol as
    /// shares at the first deposit — the first depositor gets only what they paid.
    function test_firstDepositMintsPriorEquityToTheProtocol() public {
        _open(token, carol, PerpesEngine.Side.Long, 1_000 * USDC, 10_000 * USDC);
        _skip(1);
        _closeAll(token, carol); // pays two fees and the spread
        (int256 atMark, int256 atSpot) = engine.lpClaim(token, vault.cash());
        assertGt(atMark, int256(20 * USDC), "LP fee share and the spread built up");
        uint256 prior = uint256(atMark < atSpot ? atMark : atSpot);

        _lp(token, lp, 1_000 * USDC);
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(protocolWallet)), prior, 2);
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(lp)), 1_000 * USDC, 1e14);
        assertApproxEqAbs(vault.totalAssets(), 1_000 * USDC + prior, 2);
    }

    /// Joining a market whose winners are being haircut raises their payout
    /// (the deposit grows the vault's profit budget): the depositor pays for
    /// that, and whoever held shares before isn't diluted.
    function test_depositsIntoAHaircutMarketPayForTheirOwnEffect() public {
        _open(token, carol, PerpesEngine.Side.Long, 1_000 * USDC, 10_000 * USDC);
        _skip(1);
        _closeAll(token, carol); // some equity for the protocol's opening shares
        _bigWinner(12_000 * USDC);
        assertLt(engine.payoutRatioBps(token), 10_000, "winners are haircut");

        _lp(token, lp, 1_000 * USDC); // activates: the protocol gets the prior equity
        uint256 protocolValue = vault.convertToAssets(vault.balanceOf(protocolWallet));
        uint256 lpValue = vault.convertToAssets(vault.balanceOf(lp));
        assertLt(lpValue, 1_000 * USDC, "the first LP paid for lifting the payout");
        assertGe(lpValue, 499 * USDC, "never more than the budget its cash adds");

        uint256 late = _lp(token, lp2, 100_000 * USDC);
        assertLt(vault.convertToAssets(late), 100_000 * USDC);
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(protocolWallet)), protocolValue, 2, "not diluted");
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(lp)), lpValue, 2, "not diluted");
    }

    /// Closing first gains nothing over closing last: the first closer is paid
    /// no larger share of their profit than the rest are left with.
    function test_closingFirstGainsNothing() public {
        _lp(token, lp, 4_000 * USDC); // a $2k profit budget against ~$5.8k of open profit
        _skip(1);
        _open(token, alice, PerpesEngine.Side.Long, 600 * USDC, 6_000 * USDC);
        _bigWinner(6_000 * USDC); // carol
        assertLt(engine.payoutRatioBps(token), 10_000);
        (,, int256 funding,) = engine.positionHealth(token, alice);
        uint256 principal = uint256(int256(engine.getPosition(token, alice).collateralUsdc) + funding);

        vm.recordLogs();
        _closeAll(token, alice);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 aliceRatio;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != PerpesEngine.PayoutHaircut.selector) continue;
            (uint256 gross, uint256 paid,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
            aliceRatio = ((paid - principal) * 10_000) / (gross - principal);
        }
        assertGt(aliceRatio, 0, "alice was paid pro rata");
        assertGe(engine.payoutRatioBps(token), aliceRatio, "carol is left at least alice's share");

        // Across both payouts the vault never pays more than its budget.
        _skip(1);
        _closeAll(token, carol);
        assertLe(_market().counterflowDrawnUsdc, 2_000 * USDC, "at most half the vault's $4k");
        assertGe(vault.cash(), 2_000 * USDC);
        assertEq(engine.getPosition(token, carol).unsettledProfitUsdc, 0);
        _assertSolvent();
    }

    // ── Depth ────────────────────────────────────────────────────────────────

    /// Vault cash deepens the market by 2× itself, up to 3× pool depth in all.
    function test_vaultCashDeepensItsMarket() public {
        PerpesEngine.Secondary memory s = _sec();
        assertFalse(s.backed);
        assertEq(s.lpDepthUsdc, 0);
        assertEq(s.maxOiUsdc, s.spotLiquidityUsdc, "1x pool depth unbacked");

        _lp(token, lp, 10_000 * USDC);
        _skip(1);
        engine.poke(token);
        s = _sec();
        assertTrue(s.backed);
        assertEq(s.lpDepthUsdc, 20_000 * USDC, "2x the vault's cash");
        assertEq(s.maxOiUsdc, s.spotLiquidityUsdc + 20_000 * USDC);

        _lp(token, lp, 1_000_000 * USDC);
        _skip(1);
        engine.poke(token);
        s = _sec();
        assertEq(s.lpDepthUsdc, s.spotLiquidityUsdc * 2, "capped at 3x pool depth in all");
        assertEq(s.maxOiUsdc, s.spotLiquidityUsdc * 3);
        assertGe(s.skewScaleUsdc, s.spotLiquidityUsdc * 3, "skew premium a third as steep");
    }

    // ── Payouts ──────────────────────────────────────────────────────────────

    /// The market's own funds can't pay a big winner; its vault does, in full.
    function test_winnersArePaidInFullFromTheirVault() public {
        _lp(token, lp, 1_000_000 * USDC);
        _bigWinner();
        uint256 cashBefore = vault.cash();
        uint256 before = usdc.balanceOf(carol);
        _closeAll(token, carol);
        uint256 paid = usdc.balanceOf(carol) - before;

        assertEq(engine.getPosition(token, carol).unsettledProfitUsdc, 0, "nothing deferred");
        assertGt(paid, 9_000 * USDC, "principal plus ~45% on 20k");
        PerpesEngine.Market memory m = _market();
        assertGt(m.counterflowDrawnUsdc, 0);
        assertEq(vault.exposure(), m.counterflowDrawnUsdc);
        assertEq(cashBefore - vault.cash(), m.counterflowDrawnUsdc, "the vault paid it");
        _assertSolvent();
    }

    /// A small vault pays at most its profit budget (half its cash); winners
    /// get their collateral back and a pro-rata share of their profit — the rest
    /// is forfeited, not owed, so the vault can't be drained.
    function test_vaultExposureIsCappedByItsProfitBudget() public {
        _lp(token, lp, 1_000 * USDC);
        _bigWinner(12_000 * USDC);
        assertLt(engine.payoutRatioBps(token), 10_000);
        uint256 before = usdc.balanceOf(carol);
        _closeAll(token, carol);
        assertLe(_market().counterflowDrawnUsdc, 500 * USDC, "at most half the vault's cash");
        assertGe(vault.cash(), 500 * USDC);
        assertEq(engine.getPosition(token, carol).unsettledProfitUsdc, 0, "nothing owed");
        assertGt(usdc.balanceOf(carol) - before, 1_200 * USDC, "collateral back in full");
        _assertSolvent();
    }

    /// A vault that fails must never block closes or liquidations.
    function test_brokenVaultDoesNotBlockCloses() public {
        _lp(token, lp, 1_000_000 * USDC);
        vm.mockCallRevert(address(vault), abi.encodeWithSelector(CounterflowVault.cover.selector), "down");
        _bigWinner();
        _closeAll(token, carol);
        assertEq(engine.getPosition(token, carol).sizeUsdc, 0);
        assertEq(_market().counterflowDrawnUsdc, 0);
        assertGt(engine.getPosition(token, carol).unsettledProfitUsdc, 0);
        _assertSolvent();
    }

    /// Losses beyond a liquidated position's collateral: the vault covers them;
    /// the liquidation penalty stays with LPs rather than insurance.
    function test_badDebtIsAbsorbedByTheVault() public {
        _lp(token, lp, 1_000_000 * USDC);
        _track(token, 6 hours);
        uint256 bal = IERC20(token).balanceOf(whale);
        _swap(_key(), whale, address(usdc), 10_000 * USDC);
        _track(token, 30 minutes);
        _open(token, carol, PerpesEngine.Side.Long, 1_400 * USDC, 20_000 * USDC); // ~14x
        _swap(_key(), whale, token, IERC20(token).balanceOf(whale) - bal); // -30%
        _skip(1 hours); // nobody liquidates in time
        _track(token, 30 minutes);
        uint256 insurance = _market().insuranceTrancheUsdc;
        engine.liquidate(token, carol);
        assertGt(_market().counterflowDrawnUsdc, 0, "there was a shortfall, and the vault covered it");
        assertEq(_market().badDebtUsdc, 0);
        assertLe(_market().insuranceTrancheUsdc, insurance, "no penalty into insurance");
        _assertSolvent();
    }

    // ── Equity and NAV ───────────────────────────────────────────────────────

    /// What traders lose is the vault's the moment it's realized: the sweep
    /// moves it to the vault without changing the share price, and a deposit
    /// made after the loss doesn't share in it.
    function test_lossesAreTheVaultsAndLateDepositsDontShareThem() public {
        _lp(token, lp, 100_000 * USDC);
        uint256 navBefore = vault.totalAssets();
        _bigLoser();
        uint256 navAfterLoss = vault.totalAssets();
        assertGt(navAfterLoss, navBefore + 4_000 * USDC, "carol's ~30% loss on $20k");

        uint256 lateShares = _lp(token, lp2, 100_000 * USDC);
        assertApproxEqRel(vault.convertToAssets(lateShares), 100_000 * USDC, 1e15);

        (, uint256 surplus) = engine.counterflowSurplus(token);
        assertGt(surplus, 4_000 * USDC);
        uint256 cashBefore = vault.cash();
        uint256 nav = vault.totalAssets();
        engine.syncCounterflow(token);
        assertEq(vault.cash() - cashBefore, surplus, "swept");
        assertApproxEqAbs(vault.totalAssets(), nav, 2, "share price unchanged by the sweep");
        assertApproxEqRel(vault.convertToAssets(lateShares), 100_000 * USDC, 1e15);
        _assertSolvent();
    }

    /// Traders' open profit counts against the vault before it's realized, so
    /// a depositor who joins while it's open isn't charged for it afterwards.
    function test_openProfitIsMarkedIntoTheSharePrice() public {
        _lp(token, lp, 1_000_000 * USDC);
        _bigWinner();
        uint256 nav = vault.totalAssets();
        assertLt(nav, 1_000_000 * USDC - 5_000 * USDC, "carol's open profit is already priced in");
        (uint256 low, uint256 high) = vault.navRange();
        assertLe(low, high);

        uint256 lateShares = _lp(token, lp2, 100_000 * USDC);
        uint256 lateValue = vault.convertToAssets(lateShares);
        assertLe(lateValue, 100_000 * USDC, "entries at the higher NAV");
        _closeAll(token, carol); // realized through the vault
        assertApproxEqRel(vault.convertToAssets(lateShares), lateValue, 5e15, "not charged for carol's win");
        _assertSolvent();
    }

    /// An exit the vault's cash can't cover pulls the market's sweepable equity first.
    function test_redemptionPullsTheMarketsEquity() public {
        uint256 shares = _lp(token, lp, 100_000 * USDC);
        _bigLoser();
        vm.prank(lp);
        uint256 id = vault.requestRedeem(shares);
        _skip(3 days);
        uint256 owed = vault.previewRedeem(shares);
        assertGt(owed, vault.cash(), "part of it is still in the market");
        uint256 before = usdc.balanceOf(lp);
        vm.prank(lp);
        vault.claimRedeem(id);
        assertEq(usdc.balanceOf(lp) - before, owed);
        assertGt(owed, 104_000 * USDC);
        _assertSolvent();
    }

    /// A redemption that pulls equity runs a sync from inside the vault; a
    /// creator deposit due in that sync can't re-enter the vault, so it stays
    /// set aside — and the exit still pays.
    function test_creatorStakeDuringARedemptionStaysSetAside() public {
        vm.prank(creator);
        engine.setCreatorLpShare(token, 10_000);
        uint256 shares = _lp(token, lp, 100_000 * USDC);
        _bigLoser();
        uint256 stake = _market().creatorLpPendingUsdc;
        assertGt(stake, 0);
        vm.prank(lp);
        uint256 id = vault.requestRedeem(shares);
        _skip(3 days);
        uint256 owed = vault.previewRedeem(shares);
        uint256 before = usdc.balanceOf(lp);
        vm.prank(lp);
        vault.claimRedeem(id);
        assertEq(usdc.balanceOf(lp) - before, owed);
        assertEq(_market().creatorLpPendingUsdc, stake, "still set aside");
        assertEq(vault.balanceOf(creator), 0);
        _assertSolvent();

        engine.syncCounterflow(token); // the next sync deposits it
        assertEq(_market().creatorLpPendingUsdc, 0);
        assertGt(vault.balanceOf(creator), 0);
        _assertSolvent();
    }
}
