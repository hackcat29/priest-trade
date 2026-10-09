// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PerpesEngine} from "../src/PerpesEngine.sol";
import {Defaults} from "../script/Defaults.sol";

/// USDC-like token whose issuer can block addresses (Circle's blacklist).
contract BlacklistUSDC is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address who, bool b) external {
        blocked[who] = b;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[from] && !blocked[to], "blacklisted");
        super._update(from, to, value);
    }
}

contract BlacklistTest is Test {
    uint256 constant USDC = 1e6;
    PerpesEngine engine;
    BlacklistUSDC usdc;
    address token;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address keeper = makeAddr("keeper");

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new BlacklistUSDC();
        PerpesEngine.Config memory c = Defaults.config(address(this), address(this), address(this));
        engine = PerpesEngine(
            address(
                new ERC1967Proxy(
                    address(new PerpesEngine()),
                    abi.encodeCall(PerpesEngine.initialize, (address(this), IERC20(address(usdc)), c))
                )
            )
        );
        for (uint256 i; i < 2; i++) {
            address who = i == 0 ? alice : bob;
            usdc.mint(who, 1_000_000 * USDC);
            vm.prank(who);
            usdc.approve(address(engine), type(uint256).max);
        }
        PerpesEngine.LaunchParams memory p =
            PerpesEngine.LaunchParams("Aura", "AURA", "", "", "", "", "", "", false, bytes32(0));
        token = engine.createTokenAndMarket(p);
    }

    function _accounted() internal view returns (uint256) {
        PerpesEngine.Market memory m = engine.getMarket(token);
        return m.vaultBalanceUsdc + m.orderEscrowUsdc;
    }

    function test_blacklistedOwnerCanStillBeLiquidated() public {
        vm.prank(alice);
        engine.openPosition(token, PerpesEngine.Side.Long, 10 * USDC, 100 * USDC, 0);
        vm.warp(vm.getBlockTimestamp() + 600);
        engine.poke(token);
        vm.prank(bob);
        engine.openPosition(token, PerpesEngine.Side.Short, 50 * USDC, 328 * USDC, 0);
        vm.warp(vm.getBlockTimestamp() + 600);
        usdc.setBlocked(alice, true);

        vm.prank(keeper);
        engine.liquidate(token, alice);
        PerpesEngine.Position memory pos = engine.getPosition(token, alice);
        assertEq(pos.sizeUsdc, 0, "liquidated despite the blacklist");
        assertGt(pos.unsettledProfitUsdc, 0, "owner share kept as claimable");
        assertEq(usdc.balanceOf(address(engine)), _accounted(), "vault accounting");

        usdc.setBlocked(alice, false);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        engine.claimUnsettledProfit(token);
        assertEq(usdc.balanceOf(alice) - before, pos.unsettledProfitUsdc);
        assertEq(usdc.balanceOf(address(engine)), _accounted());
    }

    function test_blacklistedOwnerCanStillBeStoppedOut() public {
        vm.prank(alice);
        engine.openPosition(token, PerpesEngine.Side.Long, 100 * USDC, 300 * USDC, 0);
        uint256 entry = engine.getPosition(token, alice).entryPriceE6;
        vm.prank(alice);
        engine.setTriggers(token, entry * 11 / 10, 0);
        vm.prank(bob);
        engine.openPosition(token, PerpesEngine.Side.Long, 200 * USDC, 2_000 * USDC, 0);
        usdc.setBlocked(alice, true);
        engine.executeTrigger(token, alice);
        PerpesEngine.Position memory pos = engine.getPosition(token, alice);
        assertEq(pos.sizeUsdc, 0);
        assertGt(pos.unsettledProfitUsdc, 100 * USDC);
        assertEq(usdc.balanceOf(address(engine)), _accounted());
    }
}
