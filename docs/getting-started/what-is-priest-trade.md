# What is Priest.trade

**Priest.trade is a perpetuals launchpad and trading exchange built for Monad.** Conviction, leveraged.

It combines two features into one simple platform:

1. **A fair-launch token launchpad** where anyone can launch a new coin on Monad with guaranteed mint locks and transparent rules.
2. **An instant perpetual futures market** where every coin gets a live perp with up to 40x leverage, funding rates, and on-chain protections the moment it's created.

No more waiting for centralized exchanges or deep external pools to list a coin. If a token exists on Priest.trade, you can trade it with leverage immediately.

---

## Why Monad?

Priest.trade runs natively on Monad:

- **1-second block times:** Trades, fills, and stop-loss triggers confirm in about a second.
- **Cheap transactions:** Network gas is paid in MON and costs fractions of a cent per trade.
- **High throughput:** Liquidations and continuous funding calculations execute smoothly without lagging the network.

---

## How it works: two trading rails

Every market on Priest.trade lives on one of two rails:

```
[ New Coin Launch ]
         │
         ▼
 ┌──────────────────────────────────────────────┐
 │          PRIMARY RAIL: Virtual AMM           │
 │  • Instant trading from block zero           │
 │  • Up to 40x leverage (warmup cap at 10x)    │
 │  • Continuous funding and liquidations       │
 └──────────────────────┬───────────────────────┘
                        │
                        │ Clears 5 Gates
                        │ + Admin Execution
                        ▼
 ┌──────────────────────────────────────────────┐
 │     GRADUATION: Uniswap v4 Spot Pool         │
 │  • Seeds real token/USDC pool on Uniswap v4  │
 │  • LP position burned permanently to 0x..dEaD│
 │  • Remaining unminted token supply burned    │
 └──────────────────────┬───────────────────────┘
                        │
                        ▼
 ┌──────────────────────────────────────────────┐
 │         SECONDARY RAIL: Oracle Engine        │
 │  • Prices off Uniswap v4 pool on-chain       │
 │  • Worst-of fill protection + skew premium   │
 │  • Backed by Counterflow LP Vault (cfUSDC)   │
 └──────────────────────────────────────────────┘
```

### 1. The Primary Rail (Virtual AMM)
When a coin is created on Priest.trade, it starts with a virtual AMM. Liquidity is virtual, which means people can trade immediately without anyone having to supply seed liquidity. To keep early trading orderly, leverage is capped at **10x for the first 24 hours** before expanding to **40x**.

### 2. The Secondary Rail (Uniswap v4 & Oracles)
Once a coin builds real traction and clears 5 graduation gates, it graduates. The protocol seeds a real spot pool on **Uniswap v4**, burns the LP tokens to `0x...dEaD` forever, and transitions the perp to an on-chain oracle. Graduated markets are backed by the **Counterflow Vault (`cfUSDC`)**.

### 3. Listing Existing Tokens
You don't have to launch a new coin to trade it here. Anyone can permissionlessly list an existing Monad coin that already has an eligible Uniswap v3 or v4 pool. Listed markets trade directly on the secondary oracle rail, and the lister earns creator fees.

---

## What you can do on Priest.trade

| You want to… | Where to go |
|---|---|
| Trade long or short with leverage | [Trading Terminal](../trading/trading-terminal.md) |
| Launch a new coin with instant perps | [Launching a Token](../launching-tokens/launching-a-token.md) |
| List an existing Monad token | [Permissionless Listings](../launching-tokens/listing-tokens.md) |
| Deposit USDC and earn passive vault yield | [Counterflow Overview](../vaults/counterflow-vault.md) |
| Connect via email, social, or MetaMask/Rabby | [Connecting Your Wallet](connecting-your-wallet.md) |
| Earn rewards and referral cuts | [Rewards Overview](../rewards-and-referrals/rewards-overview.md) |

---

## Solvency and safety guarantees

- **Isolated vaults:** Every market accounts for its own USDC. One coin's losses or profits cannot touch another coin's reserves.
- **Dual-price liquidations:** Positions are only liquidated if they breach maintenance margin at *both* the mark price and the smoothed index price, protecting traders from flash wicks.
- **Permanent liquidity lock:** When a coin graduates, the Uniswap v4 LP position is burned to `0x...dEaD`. Nobody can ever pull the liquidity rug.

---

## Ready to trade?

Check out the **[Quickstart](quickstart.md)** to place your first trade in under 5 minutes.
