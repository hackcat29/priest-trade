# Priest.trade — Monad Metropolis Hackathon Submission

> **Conviction, leveraged. Every coin on Monad gets its own perp market.**

Priest.trade is the Monad-native perpetuals launchpad and exchange. It unifies fair-launch token mechanics with instant perpetual futures trading, transitioning mature tokens into locked **Uniswap v4** spot liquidity backed by an automated LP vault (**Counterflow**).

[![Monad Mainnet](https://img.shields.io/badge/Monad%20Mainnet-Chain%20ID%20143-8A2BE2.svg)](https://monadvision.com/address/0xdCb4FbCdebBeB3C3D1233EDDBFE21e086acE923d)
[![Monad Testnet](https://img.shields.io/badge/Monad%20Testnet-Chain%20ID%2010143-4B0082.svg)](https://testnet.monadexplorer.com/address/0x041f3b8A1874E8ceBa41C29782Baba20B38F9c35)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.28-363636.svg)](https://soliditylang.org/)
[![Foundry](https://img.shields.io/badge/Built%20with-Foundry-FF4F00.svg)](https://getfoundry.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🏛️ The Problem & Our Solution

Most token launchpads end at a bonding curve with no leverage, forcing communities to wait months for centralized exchanges or deep liquidity pools to short, hedge, or trade. Meanwhile, traditional perpetual DEXes only support a curated allowlist of high-market-cap blue chips.

**Priest.trade merges both worlds on Monad:**
1. **Instant Perpetual Markets from Block Zero:** Any token launched on Priest.trade immediately has a live perpetual futures market with up to **40x leverage** (10x warmup cap), funding rates, and on-chain risk protections.
2. **Permanent Uniswap v4 Graduation:** When a market clears 5 volume and resilience gates, the engine seeds a real Uniswap v4 spot pool and **burns the LP position NFT to `0x...dEaD` forever**, eliminating liquidity rug pulls.
3. **On-Chain Secondary Engine:** Graduated markets switch to an on-chain oracle with worst-of fills ($\\max$ for buys, $\\min$ for sells) that mathematically neutralizes front-running.
4. **Counterflow LP Vault (`cfUSDC`):** An ERC-4626 vault that automatically backs graduated markets, earning 30% of platform fees and market surplus with conservative 10% per-market exposure caps and a 3-day withdrawal cooldown.
5. **Permissionless Listings:** Anyone can list an existing Monad token that has an eligible Uniswap v3 or v4 pool ($\\ge \$25\\text{k}$ depth) and earn creator fees.

---

## ⚡ Why Monad?

Priest.trade is engineered from the ground up for Monad's architecture:
- **10,000 TPS & 1-Second Block Times:** Sub-second trade execution, responsive funding adjustments, and prompt liquidations.
- **Asynchronous Execution & MonadDb:** High-performance disk state access allows continuous EWMA funding index accumulation without state bottlenecks.
- **Sub-Cent Gas Fees:** Micro-adjustments (like on-chain TP/SL repositioning and partial fills) are economically practical.

---

## 📐 Architecture

```
                          ┌───────────────────────────┐
                          │   Token Launch / Listing  │
                          └─────────────┬─────────────┘
                                        │
                ┌───────────────────────┴───────────────────────┐
                ▼                                               ▼
    [ Launch New Token ]                               [ List Existing Token ]
    • 100% supply minted to engine                     • Requires >= $25k depth on Uniswap
    • Zero creator pre-mine                            • Trades directly on Secondary Rail
    • Primary Rail (vAMM Curve)                        • Oracle pricing against spot pool
    • Up to 40x leverage (10x in 24h warmup)           • Earns creator fee share
                │
                │ Clears 5 Gates:
                │ $2M Vol, 50 Traders, Funding Stability,
                │ 7+ Days Resilience, Fair-Launch Lock
                ▼
    [ Graduation into Uniswap v4 ]
    • Protocol seeds full-range Uniswap v4 pool
    • Position NFT minted to 0x...dEaD (LP burned)
    • Remaining unminted token supply burned
                │
                ▼
    [ Secondary Market Engine ]
    • On-chain Uniswap v4 EMA / v3 TWAP
    • Worst-of execution pricing (slippage immunity)
    • Skew premium + 10 bps spread
    • Backed by Counterflow LP Vault (cfUSDC)
```

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
