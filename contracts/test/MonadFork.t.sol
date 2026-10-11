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
}
