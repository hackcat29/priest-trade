// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";

import {CounterflowVault} from "../../src/CounterflowVault.sol";
import {PerpesEngine} from "../../src/PerpesEngine.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";
import {Defaults} from "../../script/Defaults.sol";
import {MockV3Factory} from "./MockV3.sol";

/// Engine + real Uniswap v4 (PoolManager / PositionManager built from their own
/// repos, Permit2 at its canonical address) + the Counterflow vault beacon, funded
/// actors and helpers shared by the graduation, listing and Counterflow suites.
abstract contract Fixture is Test {
    uint256 constant USDC = 1e6;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    string constant POOL_MANAGER_ARTIFACT = "lib/v4-periphery/lib/v4-core/out/PoolManager.sol/PoolManager.json";
    string constant POSM_ARTIFACT = "lib/v4-periphery/foundry-out/PositionManager.sol/PositionManager.json";

    PerpesEngine engine;
    UpgradeableBeacon vaultBeacon;
    MockUSDC usdc;
    IPoolManager poolManager;
    address positionManager;
    address permit2;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest lpRouter;
    MockV3Factory v3Factory;

    address admin = makeAddr("admin");
    address operator = makeAddr("operator");
    address protocolWallet = makeAddr("protocol");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address whale = makeAddr("whale");
    address attacker = makeAddr("attacker");
    address lp = makeAddr("lp");

    /// `withVault`: deploy the Counterflow beacon, so every oracle market gets a vault.
    function _deployStack(bool withVault, address wmon, address monUsdPool) internal {
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        permit2 = new DeployPermit2().deployPermit2();
        poolManager = IPoolManager(vm.deployCode(POOL_MANAGER_ARTIFACT, abi.encode(address(this))));
        positionManager =
            vm.deployCode(POSM_ARTIFACT, abi.encode(address(poolManager), permit2, 100_000, address(0), address(0)));
        swapRouter = new PoolSwapTest(poolManager);
        lpRouter = new PoolModifyLiquidityTest(poolManager);
        v3Factory = new MockV3Factory();

        PerpesEngine.Config memory c = Defaults.config(protocolWallet, protocolWallet, treasury);
        engine = PerpesEngine(
            address(
                new ERC1967Proxy(
                    address(new PerpesEngine()), abi.encodeCall(PerpesEngine.initialize, (admin, IERC20(address(usdc)), c))
                )
            )
        );
        if (withVault) vaultBeacon = new UpgradeableBeacon(address(new CounterflowVault()), admin);
        vm.startPrank(admin);
        engine.initializeGraduation(
            Defaults.secondaryConfig(), PerpesEngine.UniswapV4(address(poolManager), positionManager, permit2), operator
        );
        engine.initializeV3(Defaults.oracleConfig(address(v3Factory), wmon, monUsdPool), Defaults.listingConfig());
        engine.initializeV4(Defaults.lpConfig(address(vaultBeacon)));
        vm.stopPrank();

        address[9] memory wallets = [alice, bob, carol, creator, whale, attacker, operator, lp, address(this)];
        for (uint256 i; i < wallets.length; i++) {
            usdc.mint(wallets[i], 10_000_000 * USDC);
            vm.startPrank(wallets[i]);
            usdc.approve(address(engine), type(uint256).max);
            usdc.approve(address(swapRouter), type(uint256).max);
            usdc.approve(address(lpRouter), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ── Generic helpers ──────────────────────────────────────────────────────

    function _skip(uint256 secs) internal {
        vm.warp(vm.getBlockTimestamp() + secs);
    }

    function _launch(string memory symbol) internal returns (address) {
        PerpesEngine.LaunchParams memory p;
        p.name = symbol;
        p.symbol = symbol;
        p.uri = "ipfs://meta";
        vm.prank(creator);
        return engine.createTokenAndMarket(p);
    }

    function _open(address mkt, address who, PerpesEngine.Side side, uint256 collateral, uint256 notional) internal {
        vm.prank(who);
        engine.openPosition(mkt, side, collateral, notional, 0);
    }

    function _closeAll(address mkt, address who) internal {
        uint256 size = engine.getPosition(mkt, who).sizeUsdc;
        vm.prank(who);
        engine.closePosition(mkt, size, 0);
    }

    /// Advances time, poking every 30s so the oracle tracks the pool.
    function _track(address mkt, uint256 secs) internal {
        for (uint256 t; t < secs; t += 30) {
            _skip(30);
            engine.poke(mkt);
        }
    }

    /// Exact-input v4 swap of `amountIn` of `tokenIn` from `who`.
    function _swap(PoolKey memory key, address who, address tokenIn, uint256 amountIn) internal {
        bool zeroForOne = tokenIn == _c0(key);
        vm.startPrank(who);
        IERC20(tokenIn).approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
    }

    function _c0(PoolKey memory key) internal pure returns (address a) {
        assembly ("memory-safe") {
            a := mload(key)
        }
    }

    /// Full-range liquidity from `who` (both tokens must be approved / held).
    function _addFullRange(PoolKey memory key, address who, int256 liquidity) internal {
        vm.startPrank(who);
        IERC20(_c0(key)).approve(address(lpRouter), type(uint256).max);
        IERC20(_c1(key)).approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(key.tickSpacing),
                tickUpper: TickMath.maxUsableTick(key.tickSpacing),
                liquidityDelta: liquidity,
                salt: 0
            }),
            ""
        );
        vm.stopPrank();
    }

    function _c1(PoolKey memory key) internal pure returns (address a) {
        assembly ("memory-safe") {
            a := mload(add(key, 0x20))
        }
    }

    function _vault(address mkt) internal view returns (CounterflowVault) {
        return CounterflowVault(engine.lpVault(mkt));
    }

    /// `who` deposits `amount` USDC into the market's vault.
    function _lp(address mkt, address who, uint256 amount) internal returns (uint256 shares) {
        CounterflowVault v = _vault(mkt);
        vm.startPrank(who);
        usdc.approve(address(v), type(uint256).max);
        shares = v.deposit(amount, who);
        vm.stopPrank();
    }

    function _assertSolvent() internal view {
        uint256 accounted;
        uint256 n = engine.marketCount();
        for (uint256 i; i < n; i++) {
            PerpesEngine.Market memory m = engine.getMarket(engine.allMarkets(i));
            accounted += m.vaultBalanceUsdc + m.orderEscrowUsdc;
        }
        assertEq(usdc.balanceOf(address(engine)), accounted, "vault accounting drift");
    }

    function _bps(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 d = a > b ? a - b : b - a;
        return (d * 10_000) / b;
    }
}
