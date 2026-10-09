// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";

import {CounterflowVault} from "../src/CounterflowVault.sol";
import {PerpesEngine} from "../src/PerpesEngine.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Defaults} from "../script/Defaults.sol";
import {PerpesEngineV1} from "./legacy/PerpesEngineV1.sol";
import {PerpesEngineV2} from "./legacy/PerpesEngineV2.sol";
import {PerpesEngineV3} from "./legacy/PerpesEngineV3.sol";
import {CounterflowVaultV1} from "./legacy/CounterflowVaultV1.sol";

/// Testnet and mainnet run v3 (listing, on-chain oracle, one shared Counterflow
/// vault); v1 and v2 ran before it. Every one must upgrade to the current engine
/// in place — markets, positions, orders and graduated state intact — with the
/// exact deployed sources in test/legacy.
contract UpgradeTest is Test {
    uint256 constant USDC = 1e6;

    MockUSDC usdc;
    address proxy;
    address pm;
    address posm;
    address permit2;
    address admin = makeAddr("admin");
    address operator = makeAddr("operator");
    address protocolWallet = makeAddr("protocol");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address token;
    uint256 orderId;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        permit2 = new DeployPermit2().deployPermit2();
        pm = vm.deployCode("lib/v4-periphery/lib/v4-core/out/PoolManager.sol/PoolManager.json", abi.encode(address(this)));
        posm = vm.deployCode(
            "lib/v4-periphery/foundry-out/PositionManager.sol/PositionManager.json",
            abi.encode(pm, permit2, 100_000, address(0), address(0))
        );
        address[3] memory wallets = [alice, bob, operator];
        for (uint256 i; i < 3; i++) usdc.mint(wallets[i], 1_000_000 * USDC);
    }

    function _approveAll() internal {
        address[3] memory wallets = [alice, bob, operator];
        for (uint256 i; i < 3; i++) {
            vm.prank(wallets[i]);
            usdc.approve(proxy, type(uint256).max);
        }
    }

    function _config() internal view returns (PerpesEngine.Config memory) {
        return Defaults.config(protocolWallet, protocolWallet, protocolWallet);
    }

    function _beacon() internal returns (address) {
        return address(new UpgradeableBeacon(address(new CounterflowVault()), admin));
    }

    // ── v1 → current (the mainnet path) ──────────────────────────────────────

    function test_v1UpgradesInOneSafeBatch() public {
        PerpesEngine.Config memory c = _config();
        PerpesEngineV1.Config memory c1;
        assembly ("memory-safe") {
            c1 := c
        }
        proxy = address(
            new ERC1967Proxy(
                address(new PerpesEngineV1()), abi.encodeCall(PerpesEngineV1.initialize, (admin, IERC20(address(usdc)), c1))
            )
        );
        _approveAll();
        PerpesEngineV1.LaunchParams memory p;
        p.name = "Legacy";
        p.symbol = "OLD";
        vm.prank(alice);
        token = PerpesEngineV1(proxy).createTokenAndMarket(p);
        vm.prank(alice);
        PerpesEngineV1(proxy).openPosition(token, PerpesEngineV1.Side.Long, 500 * USDC, 2_000 * USDC, 0);
        vm.prank(bob);
        PerpesEngineV1(proxy).openPosition(token, PerpesEngineV1.Side.Short, 500 * USDC, 1_500 * USDC, 0);
        vm.prank(bob);
        orderId = PerpesEngineV1(proxy).placeLimitOrder(
            token, PerpesEngineV1.Side.Short, PerpesEngineV1.OrderType.Limit, 100 * USDC, 5, 50e6, 0, false, 0
        );
        vm.warp(block.timestamp + 1 hours);
        PerpesEngineV1.Market memory before = PerpesEngineV1(proxy).getMarket(token);
        uint256 balance = usdc.balanceOf(proxy);

        // Upgrade + graduation init, then the v3 and v4 inits.
        address beacon = _beacon();
        vm.startPrank(admin);
        UUPSUpgradeable(proxy).upgradeToAndCall(
            address(new PerpesEngine()),
            abi.encodeCall(
                PerpesEngine.initializeGraduation,
                (Defaults.secondaryConfig(), PerpesEngine.UniswapV4(pm, posm, permit2), operator)
            )
        );
        PerpesEngine(proxy).initializeV3(Defaults.oracleConfig(address(0), address(0), address(0)), Defaults.listingConfig());
        PerpesEngine(proxy).initializeV4(Defaults.lpConfig(beacon));
        vm.stopPrank();
        PerpesEngine engine = PerpesEngine(proxy);

        PerpesEngine.Market memory m = engine.getMarket(token);
        assertEq(m.vaultBalanceUsdc, before.vaultBalanceUsdc);
        assertEq(m.orderEscrowUsdc, before.orderEscrowUsdc);
        assertEq(m.oiLongUsdc, before.oiLongUsdc);
        assertEq(m.counterflowDrawnUsdc, 0, "appended fields start at zero");
        assertEq(engine.getOrder(orderId).trader, bob);
        assertEq(engine.lpConfig().vaultBeacon, beacon);
        assertTrue(engine.listingConfig().enabled);
        assertEq(usdc.balanceOf(proxy), balance);

        // The legacy market graduates — with its own Counterflow vault — and trades.
        vm.prank(admin);
        engine.approveGraduation(token, true);
        uint256 index = engine.previewMarket(token).indexPriceE6;
        vm.prank(operator);
        engine.graduate(token, 20_000 * USDC, index / 2, index * 2);
        assertTrue(engine.lpVault(token) != address(0));
        vm.prank(alice);
        engine.closePosition(token, 2_000 * USDC, 0);
        vm.prank(bob);
        engine.cancelLimitOrder(orderId);
    }

    // ── v2 → current (the testnet path) ──────────────────────────────────────

    function test_v2WithAGraduatedMarketUpgradesInPlace() public {
        PerpesEngine.Config memory c = _config();
        PerpesEngineV2.Config memory c2;
        assembly ("memory-safe") {
            c2 := c
        }
        proxy = address(
            new ERC1967Proxy(
                address(new PerpesEngineV2()), abi.encodeCall(PerpesEngineV2.initialize, (admin, IERC20(address(usdc)), c2))
            )
        );
        _approveAll();
        PerpesEngine.SecondaryConfig memory sc = Defaults.secondaryConfig();
        PerpesEngineV2.SecondaryConfig memory sc2;
        assembly ("memory-safe") {
            sc2 := sc
        }
        vm.prank(admin);
        PerpesEngineV2(proxy).initializeGraduation(sc2, PerpesEngineV2.UniswapV4(pm, posm, permit2), operator);

        PerpesEngineV2.LaunchParams memory p;
        p.name = "Orbit";
        p.symbol = "ORBT";
        vm.prank(alice);
        token = PerpesEngineV2(proxy).createTokenAndMarket(p);
        vm.prank(alice);
        PerpesEngineV2(proxy).openPosition(token, PerpesEngineV2.Side.Long, 500 * USDC, 2_000 * USDC, 0);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(admin);
        PerpesEngineV2(proxy).approveGraduation(token, true);
        uint256 index = PerpesEngineV2(proxy).previewMarket(token).indexPriceE6;
        vm.prank(operator);
        PerpesEngineV2(proxy).graduate(token, 20_000 * USDC, index / 2, index * 2);
        PerpesEngineV2.Secondary memory s2 = PerpesEngineV2(proxy).getSecondary(token);
        assertTrue(s2.active);

        address impl = address(new PerpesEngine());
        vm.startPrank(admin);
        UUPSUpgradeable(proxy).upgradeToAndCall(
            impl,
            abi.encodeCall(
                PerpesEngine.initializeV3,
                (Defaults.oracleConfig(address(0), address(0), address(0)), Defaults.listingConfig())
            )
        );
        PerpesEngine(proxy).initializeV4(Defaults.lpConfig(address(0)));
        vm.stopPrank();
        PerpesEngine engine = PerpesEngine(proxy);

        PerpesEngine.Secondary memory s = engine.getSecondary(token);
        assertTrue(s.active);
        assertEq(s.poolId, s2.poolId);
        assertEq(s.seedUsdc, s2.seedUsdc);
        assertEq(s.oracleE6, s2.oracleE6);
        assertEq(s.cfg.tickSpacing, s2.cfg.tickSpacing);
        assertEq(uint8(s.sourceKind), uint8(PerpesEngine.SourceKind.V4), "graduation pools read as v4");
        assertFalse(s.listed);
        assertFalse(s.backed, "no Counterflow configured here");

        // The graduated market runs on the on-chain oracle now — no pushes.
        vm.warp(block.timestamp + 2 hours);
        engine.poke(token);
        assertGt(engine.getSecondary(token).lastSpotE6, 0);
        assertApproxEqRel(engine.getSecondary(token).lastSpotE6, s2.oracleE6, 1e14);
        vm.prank(bob);
        engine.openPosition(token, PerpesEngine.Side.Short, 500 * USDC, 1_000 * USDC, 0);
        vm.prank(alice);
        engine.closePosition(token, 2_000 * USDC, 0);
    }

    // ── v3 → current (the live path: testnet and mainnet) ────────────────────

    function test_v3WithTheSharedVaultUpgradesToPerMarketVaults() public {
        PerpesEngine.Config memory c = _config();
        PerpesEngineV3.Config memory c3;
        PerpesEngine.SecondaryConfig memory sc = Defaults.secondaryConfig();
        PerpesEngineV3.SecondaryConfig memory sc3;
        PerpesEngine.OracleConfig memory o = Defaults.oracleConfig(address(0), address(0), address(0));
        PerpesEngineV3.OracleConfig memory o3;
        PerpesEngine.ListingConfig memory l = Defaults.listingConfig();
        PerpesEngineV3.ListingConfig memory l3;
        assembly ("memory-safe") {
            c3 := c
            sc3 := sc
            o3 := o
            l3 := l
        }
        proxy = address(
            new ERC1967Proxy(
                address(new PerpesEngineV3()), abi.encodeCall(PerpesEngineV3.initialize, (admin, IERC20(address(usdc)), c3))
            )
        );
        _approveAll();
        address sharedVault = address(
            new ERC1967Proxy(
                address(new CounterflowVaultV1()),
                abi.encodeCall(CounterflowVaultV1.initialize, (admin, IERC20(address(usdc)), proxy))
            )
        );
        vm.startPrank(admin);
        PerpesEngineV3(proxy).initializeGraduation(sc3, PerpesEngineV3.UniswapV4(pm, posm, permit2), operator);
        PerpesEngineV3(proxy).initializeV3(
            o3,
            l3,
            PerpesEngineV3.CounterflowConfig({
                vault: sharedVault,
                feeShareBps: 3_000,
                backedOiMultiplier: 3,
                surplusBufferBps: 1_000,
                autoBackGraduated: true
            })
        );
        vm.stopPrank();

        PerpesEngineV3.LaunchParams memory p;
        p.name = "Orbit";
        p.symbol = "ORBT";
        vm.prank(alice);
        token = PerpesEngineV3(proxy).createTokenAndMarket(p);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.prank(admin);
        PerpesEngineV3(proxy).approveGraduation(token, true);
        uint256 index = PerpesEngineV3(proxy).previewMarket(token).indexPriceE6;
        vm.prank(operator);
        PerpesEngineV3(proxy).graduate(token, 20_000 * USDC, index / 2, index * 2);
        assertTrue(PerpesEngineV3(proxy).getSecondary(token).backed);
        vm.warp(vm.getBlockTimestamp() + 30);
        // Offsetting positions: traders aren't net in profit, so LPs may join after the upgrade.
        vm.prank(bob);
        PerpesEngineV3(proxy).openPosition(token, PerpesEngineV3.Side.Short, 500 * USDC, 1_000 * USDC, 0);
        vm.prank(alice);
        PerpesEngineV3(proxy).openPosition(token, PerpesEngineV3.Side.Long, 500 * USDC, 1_000 * USDC, 0);
        PerpesEngineV3.Market memory before = PerpesEngineV3(proxy).getMarket(token);
        assertGt(before.counterflowPendingUsdc, 0, "the shared vault's fee share is waiting");
        uint256 balance = usdc.balanceOf(proxy);

        address beacon = _beacon();
        address impl = address(new PerpesEngine());
        vm.prank(admin);
        UUPSUpgradeable(proxy).upgradeToAndCall(impl, abi.encodeCall(PerpesEngine.initializeV4, (Defaults.lpConfig(beacon))));
        PerpesEngine engine = PerpesEngine(proxy);

        PerpesEngine.Market memory m = engine.getMarket(token);
        assertEq(m.vaultBalanceUsdc, before.vaultBalanceUsdc);
        assertEq(m.oiLongUsdc, before.oiLongUsdc);
        assertEq(m.oiShortUsdc, before.oiShortUsdc);
        assertEq(
            m.protocolFeesPendingUsdc,
            before.protocolFeesPendingUsdc + before.counterflowPendingUsdc,
            "the shared vault's unswept share goes back to the protocol"
        );
        assertEq(m.creatorLpPendingUsdc, 0);
        assertEq(m.counterflowDrawnUsdc, 0);
        assertEq(m.creatorLpBps, 0, "appended fields start at zero");
        assertEq(usdc.balanceOf(proxy), balance);
        address vault = engine.lpVault(token);
        assertTrue(vault != address(0), "every oracle market gets its vault");
        PerpesEngine.Secondary memory s = engine.getSecondary(token);
        assertTrue(s.active);
        assertFalse(s.backed, "its vault is empty");
        assertEq(s.maxOiUsdc, s.spotLiquidityUsdc);
        vm.prank(admin);
        vm.expectRevert();
        engine.initializeV4(Defaults.lpConfig(beacon));

        // LPs back it; trading goes on.
        vm.startPrank(operator);
        usdc.approve(vault, type(uint256).max);
        CounterflowVault(vault).deposit(10_000 * USDC, operator);
        vm.stopPrank();
        assertGt(CounterflowVault(vault).balanceOf(operator), 0);
        vm.warp(vm.getBlockTimestamp() + 30);
        engine.poke(token);
        assertTrue(engine.getSecondary(token).backed);
        vm.prank(alice);
        engine.closePosition(token, 1_000 * USDC, 0);
        vm.prank(bob);
        engine.closePosition(token, 1_000 * USDC, 0);
    }

    function test_onlyOwnerCanUpgrade() public {
        PerpesEngine.Config memory c = _config();
        PerpesEngineV1.Config memory c1;
        assembly ("memory-safe") {
            c1 := c
        }
        proxy = address(
            new ERC1967Proxy(
                address(new PerpesEngineV1()), abi.encodeCall(PerpesEngineV1.initialize, (admin, IERC20(address(usdc)), c1))
            )
        );
        address impl = address(new PerpesEngine());
        vm.prank(alice);
        vm.expectRevert();
        UUPSUpgradeable(proxy).upgradeToAndCall(impl, "");
    }
}
