// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PerpesEngine} from "../src/PerpesEngine.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Defaults} from "./Defaults.sol";

/// Deploys the engine (UUPS proxy) and, when USDC_ADDRESS is unset, a MockUSDC
/// faucet token (testnet only). Writes deployments/<chainId>.json.
///
///   forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast \
///     --private-key $MONAD_DEPLOYER_PRIVATE_KEY
///
/// Env: USDC_ADDRESS (optional), PROTOCOL_FEE_WALLET, INSURANCE_FUND_WALLET,
/// TREASURY (default: deployer), LAUNCH_FEE_WEI (default 0), OWNER (default: deployer),
/// ENGINE_IMPL (reuse an implementation that's already deployed).
/// Then run Graduation.s.sol:UpgradeEngine to switch on graduation, listing and
/// Counterflow (it calls the initializers directly when the deployer owns the engine).
contract Deploy is Script {
    function run() external {
        address deployer = msg.sender;
        address owner = vm.envOr("OWNER", deployer);
        address protocolWallet = vm.envOr("PROTOCOL_FEE_WALLET", deployer);
        address insuranceWallet = vm.envOr("INSURANCE_FUND_WALLET", protocolWallet);
        address treasury = vm.envOr("TREASURY", deployer);
        address usdcAddr = vm.envOr("USDC_ADDRESS", address(0));

        PerpesEngine.Config memory c = Defaults.config(protocolWallet, insuranceWallet, treasury);
        c.launchFeeWei = vm.envOr("LAUNCH_FEE_WEI", uint256(0));

        vm.startBroadcast();
        bool mock = usdcAddr == address(0);
        if (mock) {
            require(block.chainid != 143, "refusing to deploy MockUSDC on Monad mainnet");
            usdcAddr = address(new MockUSDC());
        }
        address implAddr = vm.envOr("ENGINE_IMPL", address(0));
        PerpesEngine impl = implAddr != address(0) ? PerpesEngine(implAddr) : new PerpesEngine();
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(impl), abi.encodeCall(PerpesEngine.initialize, (owner, IERC20(usdcAddr), c)));
        vm.stopBroadcast();

        console2.log("engine", address(proxy));
        console2.log("implementation", address(impl));
        console2.log("usdc", usdcAddr);
        // Record only real deployments — a dry run (no --broadcast) must not
        // leave a deployments/<chainId>.json with simulated addresses.
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            console2.log("simulation only - deployments file not written");
            return;
        }

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "deployBlock", block.number);
        vm.serializeAddress(key, "engine", address(proxy));
        vm.serializeAddress(key, "engineImplementation", address(impl));
        vm.serializeAddress(key, "usdc", usdcAddr);
        vm.serializeBool(key, "mockUsdc", mock);
        vm.serializeAddress(key, "owner", owner);
        vm.serializeAddress(key, "protocolFeeWallet", protocolWallet);
        string memory json = vm.serializeAddress(key, "treasury", treasury);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
    }
}

/// Upgrades the engine proxy in deployments/<chainId>.json to a fresh implementation.
contract Upgrade is Script {
    function run() external {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        address proxy = vm.parseJsonAddress(vm.readFile(path), ".engine");
        vm.startBroadcast();
        PerpesEngine impl = new PerpesEngine();
        PerpesEngine(proxy).upgradeToAndCall(address(impl), "");
        vm.stopBroadcast();
        console2.log("upgraded", proxy, "to", address(impl));
    }
}
