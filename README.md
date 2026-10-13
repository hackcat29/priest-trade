# Priest.trade — Monad Metropolis Hackathon Submission

> **Any token on Monad can have a perpetual market. No application, no allowlist, no approval.**

Priest.trade is a perpetuals exchange on Monad where **anyone can list any token as a perp market** in a single transaction. If the token has a Uniswap pool with enough liquidity, a market opens on the spot, priced from that pool by an on-chain oracle. Every listed market gets its own **Counterflow** LP vault that anyone can deposit into, and the person who listed it earns a share of the trading fees.

Priest.trade also includes a fair-launch **launchpad** for creating brand-new tokens with a perp market from day one. It is a secondary feature, described [below](#-secondary-feature-the-launchpad).

[![Monad Mainnet](https://img.shields.io/badge/Monad%20Mainnet-Chain%20ID%20143-8A2BE2.svg)](https://monadvision.com/address/0xdCb4FbCdebBeB3C3D1233EDDBFE21e086acE923d)
[![Monad Testnet](https://img.shields.io/badge/Monad%20Testnet-Chain%20ID%2010143-4B0082.svg)](https://testnet.monadexplorer.com/address/0x041f3b8A1874E8ceBa41C29782Baba20B38F9c35)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.28-363636.svg)](https://soliditylang.org/)
[![Foundry](https://img.shields.io/badge/Built%20with-Foundry-FF4F00.svg)](https://getfoundry.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🏛️ The Problem & Our Solution

Perpetual exchanges only list a short, curated set of large tokens. If you hold or want to short anything else on Monad, you have no way to get leverage or hedge, and no way to bring a market into existence yourself. Someone has to approve it first, and for most tokens that never happens.

**Priest.trade removes the gatekeeper.** Calling `listMarket(token, params)` on the engine opens a perp market for any Monad token that passes the on-chain checks:

1. **Permissionless listing:** No team approval and no fee by default. The contract checks the token and pool itself and either opens the market or reverts.
2. **Priced from real spot liquidity:** The token must have a Uniswap **v3** pool (from the configured factory) or a hookless **v4** pool, paired with USDC or WMON, holding at least **$25k** of depth. A v3 pool must also have enough history to produce a TWAP.
3. **Oracle-based pricing that resists manipulation:** Trades fill at the worse of the oracle price and the pool price (higher for buys, lower for sells), so a trader cannot profit by briefly pushing the pool.
4. **Lister earns fees:** The wallet that lists the market earns the creator share of its trading fees.
5. **Its own Counterflow vault:** Each listed market gets a separate ERC-4626 LP vault (`cfUSDC`) that anyone can fund. Vaults are isolated, so one market's losses cannot drain another's.
6. **Safe start:** New markets default to up to **10x** leverage, with a short warmup (10 minutes by default) while the oracle settles before new positions open.

All defaults live in [`contracts/script/Defaults.sol`](contracts/script/Defaults.sol) and can be tuned by the protocol owner. The listing code is `PerpesEngine.listMarket` in [`contracts/src/PerpesEngine.sol`](contracts/src/PerpesEngine.sol), with tests in [`contracts/test/Listing.t.sol`](contracts/test/Listing.t.sol).

---

## ⚡ Why Monad?

Priest.trade is engineered from the ground up for Monad's architecture:
- **10,000 TPS & 1-Second Block Times:** Sub-second trade execution, responsive funding adjustments, and prompt liquidations.
- **Asynchronous Execution & MonadDb:** High-performance disk state access allows continuous EWMA funding index accumulation without state bottlenecks.
- **Sub-Cent Gas Fees:** Micro-adjustments (like on-chain TP/SL repositioning and partial fills) are economically practical.

---

## 📐 Architecture

### Main path: list any Monad token

```
   Any ERC-20 on Monad with a Uniswap v3 / v4 pool (>= $25k depth)
                          │
                          │  engine.listMarket(token, params)   (anyone, one transaction)
                          ▼
   [ Perp market opens ]
   • Price from the token's own Uniswap pool (v4 EMA / v3 TWAP)
   • Fills at the worse of oracle and pool price
   • Premium for open-interest skew + 10 bps spread
   • Lister earns the creator share of fees
                          │
                          ▼
   [ Counterflow vault for that market ]
   • ERC-4626 (cfUSDC), open to any depositor
   • Isolated per market, backs traders' profits
```

---

## 🚀 Secondary Feature: The Launchpad

For tokens that don't exist yet, Priest.trade can also launch one. The new token has a perp market from its first block, and it moves through two stages:

1. **Primary stage (virtual curve):** 100% of supply is minted to the engine with no creator pre-mine. Trading runs against a virtual AMM curve, with up to 40x leverage after a 24-hour warmup at 10x.
2. **Secondary stage (Uniswap graduation):** Once a market clears the graduation gates ($2M volume, 50 traders, stable funding, 7+ days of resilience, fair-launch lock), the engine seeds a full-range **Uniswap v4** pool and sends the LP position NFT to `0x...dEaD`, so the liquidity can never be pulled. Unminted supply is burned, and the market then runs on the same oracle-priced engine as every listed token.

```
   [ Launch new token ]  →  [ Primary: virtual curve ]  →  5 graduation gates
                                                              │
                                                              ▼
                         [ Secondary: Uniswap v4 pool, LP burned, oracle pricing ]
```

A graduated launchpad market is functionally the same as a listed one, which is why listing is the main path and the launchpad is an optional on-ramp.

---

## 📜 Deployed Contracts

### Monad Mainnet (Chain ID: `143`)

| Contract | Address | Explorer Link |
|---|---|---|
| **PerpesEngine (Proxy)** | `0xdCb4FbCdebBeB3C3D1233EDDBFE21e086acE923d` | [MonadVision](https://monadvision.com/address/0xdCb4FbCdebBeB3C3D1233EDDBFE21e086acE923d) |
| **PerpesEngine (Implementation)** | `0x6CF8964546FB6292081Ab6AE4DCAc39871A6BB63` | [MonadVision](https://monadvision.com/address/0x6CF8964546FB6292081Ab6AE4DCAc39871A6BB63) |
| **CounterflowVault (`cfUSDC`)** | `0x7AA4Bc202A7FB54766b83D8a01046248D1b250F1` | [MonadVision](https://monadvision.com/address/0x7AA4Bc202A7FB54766b83D8a01046248D1b250F1) |
| **Native Circle USDC** | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | [MonadVision](https://monadvision.com/address/0x754704Bc059F8C67012fEd69BC8A327a5aafb603) |
| **Uniswap v4 PoolManager** | `0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e` | [MonadVision](https://monadvision.com/address/0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e) |
| **Uniswap v4 PositionManager** | `0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016` | [MonadVision](https://monadvision.com/address/0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016) |
| **Uniswap v3 Factory** | `0x204FAca1764B154221e35c0d20aBb3c525710498` | [MonadVision](https://monadvision.com/address/0x204FAca1764B154221e35c0d20aBb3c525710498) |
| **Burn Address** | `0x000000000000000000000000000000000000dEaD` | Permanent LP & Token Burn |

### Monad Testnet (Chain ID: `10143`)

| Contract | Address | Explorer Link |
|---|---|---|
| **PerpesEngine (Proxy)** | `0x041f3b8A1874E8ceBa41C29782Baba20B38F9c35` | [Testnet Explorer](https://testnet.monadexplorer.com/address/0x041f3b8A1874E8ceBa41C29782Baba20B38F9c35) |
| **CounterflowVault (`cfUSDC`)** | `0x0cDa05B16734793AeF452C983bE5773c720Da471` | [Testnet Explorer](https://testnet.monadexplorer.com/address/0x0cDa05B16734793AeF452C983bE5773c720Da471) |
| **MockUSDC (Faucet)** | `0x534EEE2DC77854015A398B9DD6872eF1498B6764` | Public faucet for testnet trading |

---

## 🛡️ Security & Audit Hardening

The core engine was subjected to an extensive internal security review and static analysis (documented in [`contracts/AUDIT.md`](contracts/AUDIT.md)):

- **H-1 Resolved (Carried Funding Debt):** Unpaid funding exceeding collateral is carried on-chain rather than forgiven, preventing unbacked credits.
- **M-1 Resolved (Vault Headroom Caps):** Payouts and collateral withdrawals are strictly bounded by $\\text{Vault} - (\\text{Insurance} + \\text{Unclaimed Fees})$, ensuring reserved funds can never be withdrawn by winning trades.
- **M-2 Resolved (Blacklist Resilience):** Implemented `_payOrDefer` to ensure blacklisted addresses cannot block keeper liquidations or trigger stops.
- **M-3 Resolved (Emergency Pause):** `setTradingPaused` freezes new opens and limit placements while **always permitting position closes and margin withdrawals**.
- **Solvency Invariant:** Rigorously asserted in Foundry fuzzing tests:
  $$\\text{Engine USDC Balance} = \\sum(\\text{VaultBalance} + \\text{OrderEscrow})$$

---

## 📦 Repository Structure

- **`contracts/`**: Complete Solidity smart contracts, Foundry scripts, and test suite.
  - `src/PerpesEngine.sol`: The core perpetuals engine, vAMM, and secondary orchestrator.
  - `src/CounterflowVault.sol`: The ERC-4626 `cfUSDC` LP vault.
  - `src/PerpesToken.sol`: Fair-launch ERC-20 token contract.
  - `src/PerpesOracle.sol` & `PerpesSecondaryMath.sol`: On-chain oracle & worst-of fill math.
- **`apps/`**: Monad-native backend microservices.
  - `apps/indexer/`: Real-time block listener and event indexer using Viem, PostgreSQL, and Redis.
  - `apps/keeper/`: Automated keeper daemon for funding settlement sweeps, liquidations, and TP/SL execution.
  - `apps/liquidity-bot/`: Automated testnet simulation and break-even market-making engine.
  - `apps/candle-engine/`: Real-time OHLCV candlestick aggregation engine.
- **`packages/`**:
  - `packages/evm/`: Viem chain configurations, ABI typings, and deployment loaders.
  - `packages/types/`: Shared TypeScript models.
  - `packages/offchain/`: Shared logging, PostgreSQL pool, and Redis utilities.
  - `packages/config/`: Monorepo configurations (ESLint, Prettier, tsconfig).
- **`docs/`**: Complete GitBook documentation covering getting started, core concepts, trading, launchpad, vaults, rewards, and API.

---

## 🛠️ Local Development & Testing

### Prerequisites
- [Foundry](https://getfoundry.sh/) (`forge`, `cast`)
- Node.js >= 20 & `pnpm`

### 1. Install & Build Contracts
```bash
cd contracts
./install-deps.sh
forge build
forge test
```

### 2. Fork Testing on Monad Mainnet
```bash
MONAD_MAINNET_FORK_RPC=https://rpc.monad.xyz forge test --match-contract MonadForkTest
```

### 3. Install Monorepo Dependencies
```bash
pnpm install
pnpm build
```

---

## 🏆 Metropolis Hackathon Submission Team

- **Project:** Priest.trade
- **Live Platform:** [priest.trade](https://priest.trade)
- **Developer Documentation:** [docs.priest.trade](https://docs.priest.trade) / `docs/`
