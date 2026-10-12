# Graduation into Uniswap v4

Graduation is the moment a market transitions from a virtual AMM into a real, permanent spot pool on **Uniswap v4**, with the perpetual market switching to an on-chain secondary oracle.

---

## The graduation rule: five gates, not one

Graduation isn't just about reaching a volume number. A market must clear **five independent gates** before it becomes a candidate for graduation:

| Gate | Requirement | Purpose |
|---|---|---|
| **1. Volume** | Cumulative volume reaches **$2,000,000 USDC** | Confirms sustained trading interest. |
| **2. Trader Diversity** | At least **50 unique traders**, no single wallet over **15%** of volume, and healthy two-sided skew on 3 of the last 7 days | Proves community adoption rather than a single whale trading alone. |
| **3. Funding Stability** | Average funding rate over the trailing 72 hours stays under **8 bps / hour** | Ensures the perp price isn't violently deviating from fair value. |
| **4. Resilience** | Market is at least **7 days old**, has at least **$4,000** in its insurance reserve, and has cleared liquidations without bad debt | Proves the market can handle real volatility. |
| **5. Integrity** | Token supply is verified and mint authority is locked | Protects community buyers from mint abuse. |

Progress across all five gates is visible on the trading terminal and Creator Dashboard.

---

## What happens during graduation

Clearing the five gates makes a market eligible. From there:

1. **Protocol Approval:** A protocol admin reviews the market and calls `approveGraduation()`. This snapshots the secondary market parameters.
2. **Uniswap v4 Pool Seeding:** The protocol executes `graduate()` on `PerpesEngine`. The engine seeds a full-range `token/USDC` pool on Uniswap v4 at the current index price.
3. **LP Position Burn:** The Uniswap v4 position NFT is minted directly to `0x000000000000000000000000000000000000dEaD`. This locks the liquidity permanently — nobody can ever withdraw or rug it.
4. **Supply Burn:** Any remaining unminted token supply inside the engine is sent to `0x...dEaD`. The Uniswap v4 pool now holds the only tradeable circulating tokens.
5. **Secondary Engine Activation:** The perp market reopens on the secondary engine, pricing off the on-chain Uniswap v4 oracle with worst-of fills and skew premiums.
6. **Counterflow Backing:** The market is automatically backed by the **Counterflow Vault (`cfUSDC`)**.

---

## What changes after graduation

| | Before (Primary, vAMM) | After (Secondary, Uniswap v4) |
|---|---|---|
| **Spot Pool** | None (pure virtual curve) | Real **Uniswap v4 pool** with burned LP |
| **Spot Trading** | Perps only | Spot tradeable on Uniswap |
| **Pricing** | Internal curve | On-chain **Uniswap v4 oracle** with worst-of fills |
| **Max Leverage** | Up to 40x | Starts at 15x, unlocks +5x/day up to 40x |
| **Funding Cadence** | Every 15 minutes | Hourly |
| **Liquidity Backstop** | Market-isolated vault | Backed by **Counterflow Vault (`cfUSDC`)** |

---

## What does NOT change

- **Open positions stay open:** Your entry price, size, collateral, and PnL survive the graduation transition completely intact.
- **Token contract stays the same:** The ERC-20 token address and existing wallet balances do not change.
- **Liquidations continue:** The liquidation engine protects the market as usual.

---

## For creators

- Announce when your market is approaching graduation gates to build excitement with your community.
- Don't try to spoof volume with wash trading: wash trading earns zero reward points and fails Gate 2.
- Gate 2 rewards genuine community distribution — a coin dominated by one wallet will stall even with high volume.

---

## See also

- [The Secondary Market Engine](../core-concepts/secondary-market-engine.md) — how secondary pricing works.
- [Counterflow Overview](../vaults/counterflow-vault.md) — how the backing vault works.
- [Creator Dashboard](creator-dashboard.md) — tracking your market's progress.
