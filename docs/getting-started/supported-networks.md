# Supported Networks & Tokens

Priest.trade is purpose-built as an EVM application on the **Monad** network.

---

## Supported Networks

| Network | Chain ID | Purpose | Web URL | Explorer |
|---|---|---|---|---|
| **Monad Mainnet** | `143` | Real capital perpetuals & launches | [priest.trade](https://priest.trade) | [MonadVision](https://monadvision.com) |
| **Monad Testnet** | `10143` | Testing, mock trading & faucet | Testnet interface | [MonadExplorer](https://testnet.monadexplorer.com) |

> **Note on Solana vs Monad:** Perpes.fun operates on Solana (`solana.perpes.fun` / devnet). Priest.trade (`priest.trade`) is the standalone, full-featured deployment on **Monad Mainnet**. The contracts, assets, and vaults on Priest.trade run exclusively on Monad.

---

## Collateral Assets

All perpetuals markets on Priest.trade are denominated, collateralized, and settled in **USDC**.

| Network | Collateral Asset | Decimals | Contract Address |
|---|---|---|---|
| **Monad Mainnet** | Native Circle USDC | 6 | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| **Monad Testnet** | MockUSDC (faucet enabled) | 6 | `0x534EEE2DC77854015A398B9DD6872eF1498B6764` |

- **Collateral Currency:** USDC only.
- **Why not multi-collateral?** Using native USDC avoids cascading liquidations caused by collateral depreciation during market downturns. 1 USDC in margin always equals $1.00 USD of collateral backing.

---

## Tradeable Assets

The list of tradeable markets on Priest.trade is dynamic and permissionless. Any user can create a new market via the launchpad or list an existing asset.

Markets carry the following lifecycle states:

| Status | Tradeable? | Leverage | Notes |
|---|---|---|---|
| **Warmup** | Yes | Up to 10x | First 24 hours of market inception to prevent initial manipulation. |
| **Active (vAMM)** | Yes | Up to 40x | Standard primary-rail virtual AMM market. |
| **Graduation / Transition** | Temporary pause | N/A | Market is executing on-chain Uniswap v4 pool seeding and LP burn. |
| **Graduated (Secondary)** | Yes | Up to 40x | Trades against the on-chain oracle and Uniswap v4 pool depth. |
| **Delisted** | Close-only | N/A | New risk paused; traders can close existing positions and withdraw margin. |

---

## Network Gas & RPC Endpoints

Monad gas fees are paid in native **MON**. Gas is typically less than $0.001 per transaction.

### Official Mainnet RPCs:
- **Default HTTP:** `https://rpc.monad.xyz`
- **Default WebSocket:** `wss://rpc.monad.xyz`

### Official Testnet RPCs:
- **Default HTTP:** `https://testnet-rpc.monad.xyz`
