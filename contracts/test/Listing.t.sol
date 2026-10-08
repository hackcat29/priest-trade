// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

import {CounterflowVault} from "../src/CounterflowVault.sol";
import {PerpesEngine} from "../src/PerpesEngine.sol";
import {Defaults} from "../script/Defaults.sol";
import {Fixture} from "./utils/Fixture.sol";
import {MockToken} from "./utils/MockToken.sol";
import {MockV3Pool} from "./utils/MockV3.sol";

/// Permissionless listing of existing tokens with Uniswap v3 / v4 pools.
contract ListingTest is Fixture {
    MockToken meme; // 9 decimals, USDC-quoted on v4
    MockToken wmon;

    function setUp() public {
        _deployStack(false, address(0), address(0));
        meme = new MockToken("MEME", 9);
        wmon = new MockToken("WMON", 18);
    }

    // ── Pool helpers ─────────────────────────────────────────────────────────

    /// v4/v3 sqrt price for `priceE6` USDC-equivalent per whole base, quoted in `quote`.
    function _sqrt(address base, uint8 baseDec, address quote, uint8 quoteDec, uint256 priceQuoteE18)
        internal
        pure
        returns (uint160)
    {
        bool baseIs0 = base < quote;
        // raw currency1 per raw currency0, X192
        uint256 num = priceQuoteE18 * 10 ** quoteDec;
        uint256 den = 1e18 * 10 ** baseDec;
        uint256 ratioX192 = baseIs0 ? FullMath.mulDiv(num, 1 << 192, den) : FullMath.mulDiv(den, 1 << 192, num);
        return uint160(Math.sqrt(ratioX192));
    }

    function _v4Key(address base, address quote) internal pure returns (PoolKey memory) {
        (address a, address b) = base < quote ? (base, quote) : (quote, base);
        return PoolKey(Currency.wrap(a), Currency.wrap(b), 3_000, 60, IHooks(address(0)));
    }

    /// Initializes a full-range v4 pool at `priceQuoteE18` with about `quoteDepthRaw` of quote.
    function _makeV4Pool(MockToken base, address quote, uint8 quoteDec, uint256 priceQuoteE18, uint256 quoteDepthRaw)
        internal
        returns (PoolKey memory key)
    {
        key = _v4Key(address(base), quote);
        uint160 sqrtP = _sqrt(address(base), base.decimals(), quote, quoteDec, priceQuoteE18);
        poolManager.initialize(key, sqrtP);
        bool quoteIs0 = quote < address(base);
        // quote reserve = L·√P (quote is currency1) or L/√P (quote is currency0)
        uint256 liquidity = quoteIs0
            ? FullMath.mulDiv(quoteDepthRaw, sqrtP, 1 << 96)
            : FullMath.mulDiv(quoteDepthRaw, 1 << 96, sqrtP);
        base.mint(lp, 1e40);
        if (quote != address(usdc)) MockToken(quote).mint(lp, 1e40);
        _addFullRange(key, lp, int256(liquidity));
    }

    function _params(PerpesEngine.SourceKind kind, address v3Pool, bool wmonQuote)
        internal
        pure
        returns (PerpesEngine.ListingParams memory p)
    {
        p.kind = kind;
        p.v3Pool = v3Pool;
        p.v4Fee = 3_000;
        p.v4TickSpacing = 60;
        p.quoteIsWmon = wmonQuote;
    }

    function _listV4(address who) internal {
        vm.prank(who);
        engine.listMarket(address(meme), _params(PerpesEngine.SourceKind.V4, address(0), false));
    }

    // ── v4 / USDC ────────────────────────────────────────────────────────────

    function test_listV4UsdcPoolForA9DecimalToken() public {
        _makeV4Pool(meme, address(usdc), 6, 2e18, 100_000 * USDC); // $2, ~$100k deep
        _listV4(alice);

        PerpesEngine.Market memory m = engine.getMarket(address(meme));
        PerpesEngine.Secondary memory s = engine.getSecondary(address(meme));
        assertEq(uint8(m.status), uint8(PerpesEngine.MarketStatus.Graduated), "oracle-priced from the start");
        assertTrue(s.listed && s.active);
        assertFalse(s.backed);
        assertEq(s.baseDecimals, 9);
        assertEq(m.creator, alice, "the lister earns the creator share");
        assertApproxEqRel(s.oracleE6, 2 * USDC, 1e14, "priced from the pool");
        assertApproxEqRel(s.spotLiquidityUsdc, 100_000 * USDC, 1e14);
        assertEq(m.maxLeverageX, 10, "listed markets cap at 10x");
        assertEq(engine.marketCount(), 1);

        // Warmup: no new risk while the oracle settles.
        vm.prank(carol);
        vm.expectRevert(PerpesEngine.MarketWarmingUp.selector);
        engine.openPosition(address(meme), PerpesEngine.Side.Long, 1_000 * USDC, 5_000 * USDC, 0);
        _skip(601);
        _open(address(meme), carol, PerpesEngine.Side.Long, 1_000 * USDC, 5_000 * USDC);
        _open(address(meme), bob, PerpesEngine.Side.Short, 1_000 * USDC, 3_000 * USDC);
        vm.prank(carol);
        vm.expectRevert(PerpesEngine.LeverageTooHigh.selector);
        engine.openPosition(address(meme), PerpesEngine.Side.Long, 100 * USDC, 1_100 * USDC, 0);
        assertGt(engine.getMarket(address(meme)).creatorFeesPendingUsdc, 0);
        _skip(1); // a same-second profitable roundtrip is refused by design
        _closeAll(address(meme), carol);
        _closeAll(address(meme), bob);
        _assertSolvent();
    }

    /// Once Counterflow is configured, a listing gets its own vault; the lister
    /// (or anyone) can back it and the market deepens.
    function test_listingGetsItsOwnCounterflowVault() public {
        address beacon = address(new UpgradeableBeacon(address(new CounterflowVault()), admin));
        vm.prank(admin);
        engine.setLpConfig(Defaults.lpConfig(beacon));
        _makeV4Pool(meme, address(usdc), 6, 2e18, 100_000 * USDC);
        _listV4(alice);
        CounterflowVault v = _vault(address(meme));
        assertTrue(address(v) != address(0));
        assertEq(v.symbol(), "cfMEME");
        _lp(address(meme), alice, 50_000 * USDC);
        _skip(601);
        engine.poke(address(meme));
        PerpesEngine.Secondary memory s = engine.getSecondary(address(meme));
        assertTrue(s.backed);
        assertEq(s.lpDepthUsdc, 100_000 * USDC, "2x the vault's cash");
        _open(address(meme), carol, PerpesEngine.Side.Long, 3_000 * USDC, 30_000 * USDC); // > 25% of a 1x cap
        _assertSolvent();
    }

    function test_listingRejections() public {
        PerpesEngine.ListingParams memory p = _params(PerpesEngine.SourceKind.V4, address(0), false);

        // No pool yet.
        vm.expectRevert(PerpesEngine.InsufficientPoolDepth.selector);
        engine.listMarket(address(meme), p);

        // Too shallow.
        _makeV4Pool(meme, address(usdc), 6, 2e18, 10_000 * USDC);
        vm.expectRevert(PerpesEngine.InsufficientPoolDepth.selector);
        engine.listMarket(address(meme), p);

        // USDC itself, and a non-contract.
        vm.expectRevert(PerpesEngine.InvalidListing.selector);
        engine.listMarket(address(usdc), p);
        vm.expectRevert();
        engine.listMarket(makeAddr("eoa"), p);

        // A Perpes-launched token already has its market.
        address launched = _launch("AURA");
        vm.expectRevert(PerpesEngine.AlreadyListed.selector);
        engine.listMarket(launched, p);

        // Listing switched off.
        PerpesEngine.ListingConfig memory lc = Defaults.listingConfig();
        lc.enabled = false;
        vm.prank(admin);
        engine.setListingConfig(lc);
        vm.expectRevert(PerpesEngine.ListingDisabled.selector);
        engine.listMarket(address(meme), p);
    }

    function test_listingFeeGoesToTreasuryAndDuplicatesFail() public {
        PerpesEngine.ListingConfig memory lc = Defaults.listingConfig();
        lc.listingFeeWei = 1 ether;
        vm.prank(admin);
        engine.setListingConfig(lc);
        _makeV4Pool(meme, address(usdc), 6, 2e18, 100_000 * USDC);
        vm.deal(alice, 5 ether);
        PerpesEngine.ListingParams memory p = _params(PerpesEngine.SourceKind.V4, address(0), false);
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.InvalidLaunchFee.selector);
        engine.listMarket{value: 0.5 ether}(address(meme), p);
        vm.prank(alice);
        engine.listMarket{value: 1.5 ether}(address(meme), p);
        assertEq(treasury.balance, 1 ether);
        assertEq(alice.balance, 4 ether, "excess refunded");
        vm.prank(bob);
        vm.deal(bob, 1 ether);
        vm.expectRevert(PerpesEngine.AlreadyListed.selector);
        engine.listMarket{value: 1 ether}(address(meme), p);
    }

    /// Fills on a listed market are at the worse of oracle and pool: pumping
    /// the pool doesn't buy a cheap long.
    function test_listedMarketFillsAtWorstOf() public {
        PoolKey memory key = _makeV4Pool(meme, address(usdc), 6, 2e18, 100_000 * USDC);
        _listV4(alice);
        _track(address(meme), 15 minutes);
        _swap(key, whale, address(usdc), 30_000 * USDC); // pool +~70%
        uint256 spot = engine.spotPriceE6(address(meme));
        // 1x: the fill is at the pumped pool price while the mark follows the
        // lagging oracle, so a leveraged long here would open underwater.
        _open(address(meme), carol, PerpesEngine.Side.Long, 3_000 * USDC, 3_000 * USDC);
        assertGe(engine.getPosition(address(meme), carol).entryPriceE6, spot);
        _assertSolvent();
    }

    function test_delistedListingIsCloseOnly() public {
        _makeV4Pool(meme, address(usdc), 6, 2e18, 100_000 * USDC);
        _listV4(alice);
        _skip(601);
        _open(address(meme), carol, PerpesEngine.Side.Long, 1_000 * USDC, 5_000 * USDC);
        vm.prank(admin);
        engine.delistMarket(address(meme));
        vm.prank(bob);
        vm.expectRevert(PerpesEngine.InvalidMarketStatus.selector);
        engine.openPosition(address(meme), PerpesEngine.Side.Short, 1_000 * USDC, 2_000 * USDC, 0);
        _closeAll(address(meme), carol);
        _assertSolvent();
    }

    // ── v3 ───────────────────────────────────────────────────────────────────

    function _v3Pool(address base, address quote) internal returns (MockV3Pool pool) {
        pool = new MockV3Pool(base, quote, 3_000);
        v3Factory.register(pool);
    }

    function test_listV3PoolUsesThePoolsOwnTwap() public {
        MockV3Pool pool = _v3Pool(address(meme), address(usdc));
        uint160 sqrtSpot = _sqrt(address(meme), 9, address(usdc), 6, 25e17); // spot $2.50
        int24 twapTick = TickMath.getTickAtSqrtPrice(_sqrt(address(meme), 9, address(usdc), 6, 2e18)); // TWAP ~$2
        bool usdcIs0 = address(usdc) < address(meme);
        uint256 liq = usdcIs0
            ? FullMath.mulDiv(100_000 * USDC, sqrtSpot, 1 << 96)
            : FullMath.mulDiv(100_000 * USDC, 1 << 96, sqrtSpot);
        pool.setSpot(sqrtSpot, uint128(liq));
        pool.setTwapTick(twapTick);
        usdc.mint(address(pool), 100_000 * USDC); // depth counts what the pool actually holds

        // Not from the factory → rejected.
        MockV3Pool fake = new MockV3Pool(address(meme), address(usdc), 3_000);
        fake.setSpot(sqrtSpot, uint128(liq));
        vm.expectRevert(PerpesEngine.InvalidListing.selector);
        engine.listMarket(address(meme), _params(PerpesEngine.SourceKind.V3, address(fake), false));

        // A pool without enough history → rejected.
        pool.setNoHistory(true);
        vm.expectRevert(PerpesEngine.InvalidListing.selector);
        engine.listMarket(address(meme), _params(PerpesEngine.SourceKind.V3, address(pool), false));
        pool.setNoHistory(false);

        engine.listMarket(address(meme), _params(PerpesEngine.SourceKind.V3, address(pool), false));
        PerpesEngine.Secondary memory s = engine.getSecondary(address(meme));
        assertApproxEqRel(s.oracleE6, 2 * USDC, 2e14, "oracle = the pool's TWAP, not its spot");
        assertApproxEqRel(s.lastSpotE6, 25 * USDC / 10, 2e14);

        // Worst-of: a long pays the (higher) spot, a short gets the (lower) TWAP.
        _skip(601);
        _open(address(meme), carol, PerpesEngine.Side.Long, 1_000 * USDC, 2_000 * USDC);
        assertGe(engine.getPosition(address(meme), carol).entryPriceE6, 25 * USDC / 10);

        // If the pool stops serving the window, the market keeps running on an EMA.
        pool.setNoHistory(true);
        _skip(5);
        _open(address(meme), bob, PerpesEngine.Side.Short, 1_000 * USDC, 1_500 * USDC);
        _assertSolvent();
    }

    // ── MON-quoted ───────────────────────────────────────────────────────────

    function test_listMonQuotedPoolPricesThroughMonUsd() public {
        // MON = $3 by the reference v3 pool's TWAP.
        MockV3Pool monUsd = _v3Pool(address(wmon), address(usdc));
        uint160 monSqrt = _sqrt(address(wmon), 18, address(usdc), 6, 3e18);
        monUsd.setSpot(monSqrt, 1e18);
        monUsd.setTwapTick(TickMath.getTickAtSqrtPrice(monSqrt));
        PerpesEngine.OracleConfig memory o = Defaults.oracleConfig(address(v3Factory), address(wmon), address(monUsd));
        vm.prank(admin);
        engine.setOracleConfig(o);

        // MEME = 0.5 MON (= $1.50), ~40k MON (= $120k) deep.
        _makeV4Pool(meme, address(wmon), 18, 5e17, 40_000e18);
        vm.prank(alice);
        engine.listMarket(address(meme), _params(PerpesEngine.SourceKind.V4, address(0), true));
        PerpesEngine.Secondary memory s = engine.getSecondary(address(meme));
        assertTrue(s.quoteIsWmon);
        assertApproxEqRel(s.oracleE6, 15 * USDC / 10, 2e14, "0.5 MON x $3");
        assertApproxEqRel(s.spotLiquidityUsdc, 120_000 * USDC, 2e14, "40k MON x $3");
    }
}
