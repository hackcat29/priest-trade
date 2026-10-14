// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

import {CounterflowVault} from "../src/CounterflowVault.sol";
import {PerpesEngine} from "../src/PerpesEngine.sol";
import {Defaults} from "./Defaults.sol";

/// Uniswap v4 addresses per chain live in deployments/<chainId>.uniswap.json.
/// Monad mainnet uses Uniswap's own deployment (checked in); Monad testnet has
/// none, so DeployUniswapV4 deploys PoolManager + PositionManager from the
/// artifacts built in lib/v4-periphery (see install-deps.sh).
library UniswapDeployments {
    function path(VmSafe vm) internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".uniswap.json");
    }

    /// Uniswap v3 factory, WMON and the WMON/USDC reference pool, when this
    /// chain has them (Monad mainnet); otherwise v3 and MON-quoted listings are off.
    function oracleConfig(VmSafe vm) internal view returns (PerpesEngine.OracleConfig memory) {
        string memory json = vm.readFile(path(vm));
        address factory = vm.keyExistsJson(json, ".v3Factory") ? vm.parseJsonAddress(json, ".v3Factory") : address(0);
        address wmon = vm.keyExistsJson(json, ".wmon") ? vm.parseJsonAddress(json, ".wmon") : address(0);
        address monUsd = vm.keyExistsJson(json, ".monUsdPool") ? vm.parseJsonAddress(json, ".monUsdPool") : address(0);
        return Defaults.oracleConfig(factory, wmon, monUsd);
    }

    function load(VmSafe vm) internal view returns (PerpesEngine.UniswapV4 memory u) {
        string memory json = vm.readFile(path(vm));
        u.poolManager = vm.parseJsonAddress(json, ".poolManager");
        u.positionManager = vm.parseJsonAddress(json, ".positionManager");
        u.permit2 = vm.parseJsonAddress(json, ".permit2");
    }
}

/// Kuru (order-book DEX) per chain, in deployments/<chainId>.kuru.json: the
/// market factory listings are verified against and the minimum book depth
/// (USDC E6; 0 = the listing config's). No file = no Kuru listings.
library KuruDeployments {
    function load(VmSafe vm) internal returns (address router, uint256 minDepthUsdc) {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".kuru.json");
        if (!vm.exists(path)) return (address(0), 0);
        string memory json = vm.readFile(path);
        router = vm.parseJsonAddress(json, ".router");
        minDepthUsdc = vm.parseJsonUint(json, ".minDepthUsdc");
    }
}

/// Testnet only:
///   forge script script/Graduation.s.sol:DeployUniswapV4 --rpc-url monad_testnet --broadcast \
///     --private-key $MONAD_DEPLOYER_PRIVATE_KEY --disable-code-size-limit
contract DeployUniswapV4 is Script {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        require(block.chainid != 143, "Monad mainnet has Uniswap's own v4 deployment");
        require(PERMIT2.code.length > 0, "Permit2 missing on this chain");
        vm.startBroadcast();
        address pm = vm.deployCode("lib/v4-periphery/lib/v4-core/out/PoolManager.sol/PoolManager.json", abi.encode(msg.sender));
        address posm = vm.deployCode(
            "lib/v4-periphery/foundry-out/PositionManager.sol/PositionManager.json",
            abi.encode(pm, PERMIT2, 300_000, address(0), address(0))
        );
        vm.stopBroadcast();
        console2.log("poolManager", pm);
        console2.log("positionManager", posm);
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            console2.log("simulation only - deployments file not written");
            return;
        }
        string memory key = "uniswap";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeBool(key, "selfDeployed", true);
        vm.serializeAddress(key, "poolManager", pm);
        vm.serializeAddress(key, "positionManager", posm);
        string memory json = vm.serializeAddress(key, "permit2", PERMIT2);
        vm.writeJson(json, UniswapDeployments.path(vm));
    }
}

/// Upgrades the engine to the current implementation and switches Counterflow
/// to per-market vaults: deploys the vault implementation behind an
/// UpgradeableBeacon (owned by the engine's owner), then
///   - v3 (live on testnet and mainnet): upgradeToAndCall(impl, initializeV4)
///   - fresh (Deploy.s.sol only):        upgradeToAndCall(impl, initializeGraduation) + initializeV3 + initializeV4
/// initializeV4 retires the shared v3 vault and opens a vault for every oracle
/// market. An engine already on per-market vaults is refreshed instead:
///   - v4:                               upgradeToAndCall(impl, setLpConfig) + beacon.upgradeTo(vault impl)
/// Sends directly when the broadcaster owns the engine; otherwise (a Safe)
/// writes the transactions to deployments/<chainId>.upgrade-pending.json.
///   [OPERATOR=<keeper>] forge script script/Graduation.s.sol:UpgradeEngine \
///     --rpc-url <rpc> --broadcast --private-key $KEY --disable-code-size-limit
/// Monad prices cold storage above Ethereum, so forge's local estimate can run
/// initializers out of gas; check with `cast estimate` against the chain and
/// raise --gas-estimate-multiplier. To resume after a failure, pass
/// ENGINE_IMPL / VAULT_IMPL / VAULT_BEACON for contracts that already landed.
contract UpgradeEngine is Script {
    function run() external {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        address proxy = vm.parseJsonAddress(vm.readFile(path), ".engine");
        PerpesEngine engine = PerpesEngine(proxy);
        address owner = engine.owner();
        PerpesEngine.UniswapV4 memory u = UniswapDeployments.load(vm);
        require(u.poolManager.code.length > 0 && u.positionManager.code.length > 0, "Uniswap v4 not deployed here");
        if (_hasLpVaults(proxy)) return _refreshV4(engine, owner, path);
        bool live = _isV3(proxy);

        address engineImpl = vm.envOr("ENGINE_IMPL", address(0));
        address vaultImpl = vm.envOr("VAULT_IMPL", address(0));
        address beacon = vm.envOr("VAULT_BEACON", address(0));
        require(engineImpl == address(0) || engineImpl.code.length > 0, "ENGINE_IMPL has no code");
        require(vaultImpl == address(0) || vaultImpl.code.length > 0, "VAULT_IMPL has no code");
        require(beacon == address(0) || beacon.code.length > 0, "VAULT_BEACON has no code");

        vm.startBroadcast();
        PerpesEngine impl = engineImpl != address(0) ? PerpesEngine(engineImpl) : new PerpesEngine();
        if (beacon == address(0)) {
            if (vaultImpl == address(0)) vaultImpl = address(new CounterflowVault());
            beacon = address(new UpgradeableBeacon(vaultImpl, owner));
        }
        bytes memory initV4 = abi.encodeCall(PerpesEngine.initializeV4, (Defaults.lpConfig(beacon)));
        bytes[] memory calls = new bytes[](live ? 1 : 3);
        if (live) {
            calls[0] = abi.encodeCall(engine.upgradeToAndCall, (address(impl), initV4));
        } else {
            bytes memory initGraduation = abi.encodeCall(
                PerpesEngine.initializeGraduation, (Defaults.secondaryConfig(), u, vm.envAddress("OPERATOR"))
            );
            calls[0] = abi.encodeCall(engine.upgradeToAndCall, (address(impl), initGraduation));
            calls[1] = abi.encodeCall(
                PerpesEngine.initializeV3, (UniswapDeployments.oracleConfig(vm), Defaults.listingConfig())
            );
            calls[2] = initV4;
        }
        bool direct = msg.sender == owner;
        if (direct) {
            for (uint256 i; i < calls.length; i++) {
                (bool ok,) = proxy.call(calls[i]);
                require(ok, "upgrade call failed");
            }
        }
        vm.stopBroadcast();

        console2.log("implementation", address(impl));
        console2.log("counterflow beacon", beacon);
        console2.log("upgraded from live v3", live);
        console2.log("upgraded directly", direct);
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            console2.log("simulation only - nothing recorded");
            return;
        }
        vm.writeJson(vm.toString(beacon), path, ".counterflowBeacon");
        if (direct) {
            vm.writeJson(vm.toString(address(impl)), path, ".engineImplementation");
            return;
        }
        string memory key = "pending";
        vm.serializeAddress(key, "safe", owner);
        vm.serializeAddress(key, "to", proxy);
        vm.serializeAddress(key, "implementation", address(impl));
        vm.serializeAddress(key, "counterflowBeacon", beacon);
        string memory json = vm.serializeBytes(key, "calls", calls);
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".upgrade-pending.json"));
        console2.log("Safe transactions written to deployments/<chainId>.upgrade-pending.json");
    }

    /// New engine and vault implementations for an engine already on per-market
    /// vaults; the LP config is rewritten from Defaults (keeping its beacon).
    function _refreshV4(PerpesEngine engine, address owner, string memory path) internal {
        // The live engine's LpConfig may predate fields this build added: read just the beacon.
        (, bytes memory ret) = address(engine).staticcall(abi.encodeWithSignature("lpConfig()"));
        address beacon = abi.decode(ret, (address));
        address engineImpl = vm.envOr("ENGINE_IMPL", address(0));
        address vaultImpl = vm.envOr("VAULT_IMPL", address(0));
        require(msg.sender == owner && UpgradeableBeacon(beacon).owner() == owner, "refresh sends directly: run as the owner");
        vm.startBroadcast();
        if (engineImpl == address(0)) engineImpl = address(new PerpesEngine());
        if (vaultImpl == address(0)) vaultImpl = address(new CounterflowVault());
        engine.upgradeToAndCall(engineImpl, abi.encodeCall(PerpesEngine.setLpConfig, (Defaults.lpConfig(beacon))));
        UpgradeableBeacon(beacon).upgradeTo(vaultImpl);
        (address kuru, uint256 kuruMinDepth) = KuruDeployments.load(vm);
        if (kuru != address(0) && (engine.kuruRouter() != kuru || engine.kuruMinDepthUsdc() != kuruMinDepth)) {
            engine.setKuruConfig(kuru, kuruMinDepth);
        }
        vm.stopBroadcast();
        console2.log("kuru router", kuru);
        console2.log("implementation", engineImpl);
        console2.log("vault implementation", vaultImpl);
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) && !vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            console2.log("simulation only - nothing recorded");
            return;
        }
        vm.writeJson(vm.toString(engineImpl), path, ".engineImplementation");
        vm.writeJson(vm.toString(vaultImpl), path, ".counterflowVaultImplementation");
    }

    /// v3 answers listingConfig() with its configured (non-zero) minimum depth;
    /// a fresh proxy on the current implementation answers with zeros.
    function _isV3(address proxy) internal view returns (bool) {
        (bool ok, bytes memory ret) = proxy.staticcall(abi.encodeWithSignature("listingConfig()"));
        if (!ok || ret.length < 160) return false;
        (,,,, uint256 minDepthUsdc) = abi.decode(ret, (bool, uint8, uint32, uint256, uint256));
        return minDepthUsdc != 0;
    }

    function _hasLpVaults(address proxy) internal view returns (bool) {
        (bool ok, bytes memory ret) = proxy.staticcall(abi.encodeWithSignature("lpConfig()"));
        return ok && ret.length >= 32 && abi.decode(ret, (address)) != address(0);
    }
}

/// Owner step: approve a market for graduation (the keeper then executes it).
/// Without ADMIN_OVERRIDE=true every on-chain criterion must be met. Sends
/// directly when the broadcaster owns the engine; otherwise writes the Safe
/// transaction to deployments/<chainId>.approve-<token>.json.
///   TOKEN=0x… [ADMIN_OVERRIDE=true] forge script script/Graduation.s.sol:ApproveGraduation \
///     --rpc-url monad_mainnet --sender <any> (Safe) | --broadcast --private-key $KEY (EOA owner)
contract ApproveGraduation is Script {
    function run() external {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        PerpesEngine engine = PerpesEngine(vm.parseJsonAddress(vm.readFile(path), ".engine"));
        address token = vm.envAddress("TOKEN");
        bool adminOverride = vm.envOr("ADMIN_OVERRIDE", false);

        PerpesEngine.Eligibility memory e = engine.graduationEligibility(token);
        console2.log("age (h)", e.ageSeconds / 3600);
        console2.log("volume (USDC)", e.volumeUsdc / 1e6);
        console2.log("unique traders", e.uniqueTraders);
        console2.log("peak OI (USDC)", e.peakOiUsdc / 1e6);
        console2.log("vault stress (bps)", e.vaultStressBps);
        console2.log("all criteria met", e.allMet);
        require(e.allMet || adminOverride, "criteria not met (set ADMIN_OVERRIDE=true to override)");

        bytes memory data = abi.encodeCall(PerpesEngine.approveGraduation, (token, adminOverride));
        address owner = engine.owner();
        if (msg.sender == owner) {
            vm.broadcast();
            engine.approveGraduation(token, adminOverride);
            console2.log("approved");
            return;
        }
        string memory key = "approve";
        vm.serializeAddress(key, "safe", owner);
        vm.serializeAddress(key, "to", address(engine));
        vm.serializeUint(key, "value", 0);
        string memory json = vm.serializeBytes(key, "data", data);
        string memory out = string.concat(
            vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".approve-", vm.toString(token), ".json"
        );
        vm.writeJson(json, out);
        console2.log("Safe transaction written to", out);
    }
}
