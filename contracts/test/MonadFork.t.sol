// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {CounterflowVault} from "../src/CounterflowVault.sol";
import {PerpesEngine} from "../src/PerpesEngine.sol";
import {Defaults} from "../script/Defaults.sol";

/// Against the real Monad mainnet: Uniswap v4 for graduation, Uniswap v3 (its
/// own TWAP) for listing, real USDC.
///   MONAD_MAINNET_FORK_RPC=https://rpc.monad.xyz forge test --match-contract MonadForkTest
contract MonadForkTest is Test {
    uint256 constant USDC = 1e6;
    address constant POOL_MANAGER = 0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e;
    address constant POSITION_MANAGER = 0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant V3_FACTORY = 0x204FAca1764B154221e35c0d20aBb3c525710498;
    address constant MONAD_USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
    // Uniswap v3 WMON/USDC 0.3% — the MON/USD reference and the pool MON is listed on.
    address constant WMON_USDC_V3 = 0x659bD0BC4167BA25c62E05656F78043E7eD4a9da;
    // Kuru (on-chain order book): the market factory and two of its USDC books.
    address constant KURU_ROUTER = 0xd651346d7c789536ebf06dc72aE3C8502cd695CC;
    address constant WETH = 0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242;
    address constant KURU_WETH_USDC = 0xa6aFD386135B7D41A6C40C525abC4A1019b0D132;
    address constant CBBTC = 0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b;
    address constant KURU_CBBTC_USDC = 0x40c49F171202F91ff5d2faE34c22dD2BFdD22aF0;

    PerpesEngine engine;
    address admin = makeAddr("admin");
    address operator = makeAddr("operator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function _fork() internal returns (bool) {
        string memory rpc = vm.envOr("MONAD_MAINNET_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return false;
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 143);
        engine = PerpesEngine(
            address(
                new ERC1967Proxy(
                    address(new PerpesEngine()),
                    abi.encodeCall(
                        PerpesEngine.initialize, (admin, IERC20(MONAD_USDC), Defaults.config(admin, admin, admin))
                    )
                )
            )
        );
        address beacon = address(new UpgradeableBeacon(address(new CounterflowVault()), admin));
        vm.startPrank(admin);
        engine.initializeGraduation(
            Defaults.secondaryConfig(), PerpesEngine.UniswapV4(POOL_MANAGER, POSITION_MANAGER, PERMIT2), operator
        );
        engine.initializeV3(Defaults.oracleConfig(V3_FACTORY, WMON, WMON_USDC_V3), Defaults.listingConfig());
        engine.initializeV4(Defaults.lpConfig(beacon));
        vm.stopPrank();
        // Borrow real USDC from the v3 pool's balance (fork only).
        address[3] memory wallets = [alice, bob, operator];
        for (uint256 i; i < 3; i++) {
            vm.prank(WMON_USDC_V3);
            IERC20(MONAD_USDC).transfer(wallets[i], 30_000 * USDC);
            vm.prank(wallets[i]);
            IERC20(MONAD_USDC).approve(address(engine), type(uint256).max);
        }
        return true;
    }

    function test_graduateOnMonadMainnetUniswapV4() public {
        if (!_fork()) return vm.skip(true);
        PerpesEngine.LaunchParams memory p;
        p.name = "Fork";
        p.symbol = "FORK";
        vm.prank(alice);
        address token = engine.createTokenAndMarket(p);
        vm.prank(alice);
        engine.openPosition(token, PerpesEngine.Side.Long, 500 * USDC, 1_000 * USDC, 0);
        vm.warp(block.timestamp + 1 hours);

        vm.prank(admin);
        engine.approveGraduation(token, true);
        uint256 index = engine.previewMarket(token).indexPriceE6;
        vm.prank(operator);
        engine.graduate(token, 25_000 * USDC, index / 2, index * 2);

        PerpesEngine.Secondary memory s = engine.getSecondary(token);
        assertTrue(s.active);
        assertTrue(engine.lpVault(token) != address(0), "graduations get a Counterflow vault");
        assertEq(IERC721(POSITION_MANAGER).ownerOf(s.lpTokenId), 0x000000000000000000000000000000000000dEaD);
        assertApproxEqAbs(s.seedUsdc, 25_000 * USDC, 2);
        assertApproxEqRel(engine.spotPriceE6(token), index, 1e14);
        assertEq(IERC20(token).balanceOf(address(engine)), 0);

        vm.warp(block.timestamp + 30);
        engine.poke(token);
        vm.prank(alice);
        engine.closePosition(token, 1_000 * USDC, 0);
    }

    /// MON perps: list WMON on Uniswap's own WMON/USDC v3 pool, priced by that
    /// pool's TWAP — no keeper, no outside oracle.
    function test_listMonOnTheRealV3Pool() public {
        if (!_fork()) return vm.skip(true);
        PerpesEngine.ListingParams memory p;
        p.kind = PerpesEngine.SourceKind.V3;
        p.v3Pool = WMON_USDC_V3;
        vm.prank(alice);
        engine.listMarket(WMON, p);

        PerpesEngine.Secondary memory s = engine.getSecondary(WMON);
        assertTrue(s.listed);
        assertTrue(engine.lpVault(WMON) != address(0), "listings get a Counterflow vault");
        assertEq(s.baseDecimals, 18);
        assertGt(s.oracleE6, 0);
        assertGt(s.spotLiquidityUsdc, 25_000 * USDC);
        // TWAP and spot agree on a pool this deep.
        uint256 d = s.oracleE6 > s.lastSpotE6 ? s.oracleE6 - s.lastSpotE6 : s.lastSpotE6 - s.oracleE6;
        assertLt((d * 10_000) / s.oracleE6, 300, "TWAP within 3% of spot");
        emit log_named_decimal_uint("MON/USD (TWAP)", s.oracleE6, 6);
        emit log_named_decimal_uint("pool USDC depth", s.spotLiquidityUsdc, 6);

        vm.warp(block.timestamp + 601);
        vm.prank(bob);
        engine.openPosition(WMON, PerpesEngine.Side.Long, 1_000 * USDC, 3_000 * USDC, 0);
        vm.warp(block.timestamp + 60);
        vm.prank(bob);
        engine.closePosition(WMON, 3_000 * USDC, 0);
    }

    function _kuruParams(address market) internal pure returns (PerpesEngine.ListingParams memory p) {
        p.kind = PerpesEngine.SourceKind.Kuru;
        p.v3Pool = market;
    }

    /// WETH listed off Kuru's WETH/USDC book: the router vouches for the market,
    /// the oracle follows the book's mid, depth is the bids near it.
    function test_listWethOnTheRealKuruBook() public {
        if (!_fork()) return vm.skip(true);
        vm.prank(admin);
        engine.setKuruConfig(KURU_ROUTER, 1_000 * USDC);
        assertEq(engine.kuruMarginAccount(), 0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5);

        vm.prank(alice);
        engine.listMarket(WETH, _kuruParams(KURU_WETH_USDC));
        PerpesEngine.Secondary memory s = engine.getSecondary(WETH);
        assertTrue(s.listed);
        assertEq(uint8(s.sourceKind), uint8(PerpesEngine.SourceKind.Kuru));
        assertEq(s.v3Pool, KURU_WETH_USDC);
        assertEq(s.kuruPricePrecision, 1e4);
        assertEq(s.kuruSizePrecision, 1e10);
        assertTrue(engine.lpVault(WETH) != address(0), "Kuru listings get a Counterflow vault too");
        // A sane ETH price, straight from the book.
        assertGt(s.oracleE6, 500 * USDC);
        assertLt(s.oracleE6, 20_000 * USDC);
        assertEq(s.oracleE6, s.lastSpotE6);
        assertGe(s.spotLiquidityUsdc, 1_000 * USDC);
        assertEq(engine.spotPriceE6(WETH), s.lastSpotE6);
        emit log_named_decimal_uint("ETH/USD (Kuru mid)", s.oracleE6, 6);
        emit log_named_decimal_uint("Kuru bid depth", s.spotLiquidityUsdc, 6);

        vm.warp(block.timestamp + 601);
        vm.prank(bob);
        engine.openPosition(WETH, PerpesEngine.Side.Long, 100 * USDC, 300 * USDC, 0);
        vm.warp(block.timestamp + 60);
        vm.prank(bob);
        engine.closePosition(WETH, 300 * USDC, 0);
    }

    /// An 8-decimal base: Kuru prices whole units, so decimals don't enter the price.
    function test_listCbBtcOnTheRealKuruBook() public {
        if (!_fork()) return vm.skip(true);
        vm.prank(admin);
        engine.setKuruConfig(KURU_ROUTER, 1_000 * USDC);
        vm.prank(alice);
        engine.listMarket(CBBTC, _kuruParams(KURU_CBBTC_USDC));
        PerpesEngine.Secondary memory s = engine.getSecondary(CBBTC);
        assertEq(s.baseDecimals, 8);
        assertGt(s.oracleE6, 10_000 * USDC);
        assertLt(s.oracleE6, 1_000_000 * USDC);
        emit log_named_decimal_uint("BTC/USD (Kuru mid)", s.oracleE6, 6);
    }

    function test_kuruListingChecks() public {
        if (!_fork()) return vm.skip(true);
        // Kuru listings are off until the owner names the router.
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.InvalidListing.selector);
        engine.listMarket(WETH, _kuruParams(KURU_WETH_USDC));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        engine.setKuruConfig(KURU_ROUTER, 0);
        vm.prank(admin);
        engine.setKuruConfig(KURU_ROUTER, 0);

        // Not a market the Kuru router knows.
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.InvalidListing.selector);
        engine.listMarket(WETH, _kuruParams(makeAddr("fake book")));
        // A real market, but for another token.
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.InvalidListing.selector);
        engine.listMarket(CBBTC, _kuruParams(KURU_WETH_USDC));
        // A real market quoted in USDC, listed as if it were WMON-quoted.
        PerpesEngine.ListingParams memory p = _kuruParams(KURU_WETH_USDC);
        p.quoteIsWmon = true;
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.InvalidListing.selector);
        engine.listMarket(WETH, p);
        // With no Kuru minimum of its own, the listing minimum ($25k) applies,
        // and a thin book ($2.5k of bids here) can't meet it.
        vm.mockCall(
            KURU_WETH_USDC,
            abi.encodeWithSignature("getL2Book(uint32,uint32)"),
            abi.encode(abi.encodePacked(block.number, uint256(25e6), uint256(1e10), uint256(0)))
        );
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.InsufficientPoolDepth.selector);
        engine.listMarket(WETH, _kuruParams(KURU_WETH_USDC));
    }

    /// A book with an empty side (or a gaping spread) is no price: the oracle
    /// holds, nothing new opens, exits still go through.
    function test_kuruGappedBookBlocksOpensNotCloses() public {
        if (!_fork()) return vm.skip(true);
        vm.prank(admin);
        engine.setKuruConfig(KURU_ROUTER, 1_000 * USDC);
        vm.prank(alice);
        engine.listMarket(WETH, _kuruParams(KURU_WETH_USDC));
        vm.warp(block.timestamp + 601);
        vm.prank(bob);
        engine.openPosition(WETH, PerpesEngine.Side.Long, 100 * USDC, 300 * USDC, 0);
        uint256 oracleBefore = engine.getSecondary(WETH).oracleE6;

        // Every ask taken.
        vm.mockCall(
            KURU_WETH_USDC, abi.encodeWithSignature("bestBidAsk()"), abi.encode(uint256(2_000e18), type(uint256).max)
        );
        vm.warp(block.timestamp + 30);
        assertEq(engine.spotPriceE6(WETH), 0);
        vm.prank(alice);
        vm.expectRevert(PerpesEngine.InvalidPrice.selector);
        engine.openPosition(WETH, PerpesEngine.Side.Short, 100 * USDC, 300 * USDC, 0);
        vm.prank(bob);
        engine.closePosition(WETH, 150 * USDC, 0);
        assertEq(engine.getSecondary(WETH).oracleE6, oracleBefore, "oracle holds");

        // A 20% spread is no price either.
        vm.mockCall(
            KURU_WETH_USDC, abi.encodeWithSignature("bestBidAsk()"), abi.encode(uint256(2_000e18), uint256(2_400e18))
        );
        assertEq(engine.spotPriceE6(WETH), 0);
        vm.clearMockedCalls();
        assertGt(engine.spotPriceE6(WETH), 0);
        vm.prank(bob);
        engine.closePosition(WETH, 150 * USDC, 0);
    }
}
