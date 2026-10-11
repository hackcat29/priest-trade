// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";

import {CounterflowVault} from "../src/CounterflowVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {PerpesEngine} from "../src/PerpesEngine.sol";

/// A plain ERC-20 standing in for an "existing" token on testnet.
contract DemoToken is ERC20 {
    constructor(address to) ERC20("Listing Demo", "LISTD") {
        _mint(to, 1_000_000_000 ether);
    }
}

/// Testnet only: exercises listing + Counterflow end to end. Deploys LISTD, a
/// LISTD/USDC v4 pool (0.3%, $0.50, ~$50k each side), lists it, and seeds the
/// listing's own Counterflow vault with test USDC. The broadcaster must be the
/// MockUSDC minter.
///   forge script script/TestnetDemo.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER
contract TestnetDemo is Script {
    function run() external {
        require(block.chainid == 10143, "testnet only");
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/10143.json"));
        PerpesEngine engine = PerpesEngine(vm.parseJsonAddress(json, ".engine"));
        MockUSDC usdc = MockUSDC(address(engine.usdc()));
        (address pm,,) = engine.uniswap();

        vm.startBroadcast();
        address me = msg.sender;
        DemoToken token = new DemoToken(me);
        usdc.mint(me, 1_000_000e6);

        (address a, address b) = address(token) < address(usdc) ? (address(token), address(usdc)) : (address(usdc), address(token));
        PoolKey memory key = PoolKey(Currency.wrap(a), Currency.wrap(b), 3_000, 60, IHooks(address(0)));
        bool tokenIs0 = a == address(token);
        // $0.50: raw USDC per raw token = 0.5e6 / 1e18
        uint256 ratioX192 = tokenIs0 ? FullMath.mulDiv(5e5, 1 << 192, 1e18) : FullMath.mulDiv(1e18, 1 << 192, 5e5);
        uint160 sqrtP = uint160(Math.sqrt(ratioX192));
        IPoolManager(pm).initialize(key, sqrtP);

        PoolModifyLiquidityTest router = new PoolModifyLiquidityTest(IPoolManager(pm));
        token.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);
        router.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(60),
                tickUpper: TickMath.maxUsableTick(60),
                liquidityDelta: int256(_liquidityFor(sqrtP, tokenIs0)),
                salt: 0
            }),
            ""
        );

        PerpesEngine.ListingParams memory p;
        p.kind = PerpesEngine.SourceKind.V4;
        p.v4Fee = 3_000;
        p.v4TickSpacing = 60;
        engine.listMarket(address(token), p);

        CounterflowVault vault = CounterflowVault(engine.lpVault(address(token)));
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(100_000e6, me);
        vm.stopBroadcast();

        console2.log("LISTD", address(token));
        console2.log("liquidity router", address(router));
        console2.log("listed price E6", engine.getSecondary(address(token)).oracleE6);
        console2.log("pool depth USDC", engine.poolUsdcDepth(address(token)));
        console2.log("counterflow vault", address(vault));
        console2.log("counterflow NAV", vault.totalAssets());
    }

    /// Full-range liquidity holding ~$50k of USDC at `sqrtP`.
    function _liquidityFor(uint160 sqrtP, bool tokenIs0) internal pure returns (uint256) {
        // USDC is currency1 when the token is currency0: amount1 = L·√P/Q96 → L = amount1·Q96/√P.
        // USDC is currency0 otherwise: amount0 = L·Q96/√P → L = amount0·√P/Q96.
        return tokenIs0 ? FullMath.mulDiv(50_000e6, 1 << 96, sqrtP) : FullMath.mulDiv(50_000e6, sqrtP, 1 << 96);
    }
}
