#!/usr/bin/env bash
# Pinned Solidity dependencies (kept out of git). Run once before `forge build`.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p lib
clone() { [ -d "lib/$1" ] || git clone --depth 1 --branch "$3" "$2" "lib/$1"; }
# Shallow checkout of an exact commit (for repos without release tags).
fetch() {
  [ -d "$1/.git" ] && return
  mkdir -p "$1"
  (cd "$1" && git init -q && git remote add origin "$2" && git fetch -q --depth 1 origin "$3" && git checkout -q FETCH_HEAD)
}

clone forge-std https://github.com/foundry-rs/forge-std v1.9.4
clone openzeppelin-contracts https://github.com/OpenZeppelin/openzeppelin-contracts v5.1.0
clone openzeppelin-contracts-upgradeable https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable v5.1.0

# Uniswap v4 (graduation). v4-periphery has no release tags; these are the
# commits it pins, so the engine's imports match what PositionManager was built from.
P=lib/v4-periphery
fetch "$P" https://github.com/Uniswap/v4-periphery 9969eec44cfdf07e24b41de47f40276a58401976
fetch "$P/lib/v4-core" https://github.com/Uniswap/v4-core 59d3ecf53afa9264a16bba0e38f4c5d2231f80bc
fetch "$P/lib/permit2" https://github.com/Uniswap/permit2 cc56ad0f3439c502c246fc5cfcc3db92bb8b7219
fetch "$P/lib/v4-core/lib/solmate" https://github.com/transmissions11/solmate 4b47a19038b798b4a33d9749d25e570443520647
fetch "$P/lib/v4-core/lib/forge-std" https://github.com/foundry-rs/forge-std 1de6eecf821de7fe2c908cc48d3ab3dced20717f
fetch "$P/lib/v4-core/lib/openzeppelin-contracts" https://github.com/openzeppelin/openzeppelin-contracts dbb6104ce834628e473d2173bbc9d47f81a9eec3

# PoolManager / PositionManager need solc 0.8.26 exactly, so they're built in
# their own repos with their own settings. Tests and the testnet v4 deploy load
# these artifacts (the engine itself only imports version-agnostic interfaces).
[ -f "$P/lib/v4-core/out/PoolManager.sol/PoolManager.json" ] || (cd "$P/lib/v4-core" && forge build --skip test --skip script)
[ -f "$P/foundry-out/PositionManager.sol/PositionManager.json" ] || (cd "$P" && forge build --skip test --skip script)
