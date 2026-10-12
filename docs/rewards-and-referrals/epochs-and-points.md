# Epochs & Points

The Priest.trade points engine runs on a time-sliced **Epoch system**, ensuring a fair, continuous playing field for all participants.

---

## 1. How Points are Computed

Points are calculated on an ongoing basis by the backend rewards service and updated on the leaderboard:

$$\text{Points} = \text{Trading Points} + \text{LP Points} + \text{Referral Points}$$

### A. Trading Points Formula
$$\text{Trading Points} = \text{Base Volume Points} \times \text{Duration Multiplier} \times \text{Market Multiplier}$$
- **Base Volume:** 1 point per $1.00 USDC in clean notional trading volume.
- **Duration Multiplier:** Positions held for longer durations (e.g. $> 1\text{ hour}$) receive up to a **1.5x multiplier**, rewarding authentic conviction over high-frequency ping-pong bots.
- **Market Multiplier:** Selected markets (such as newly launched Warmup markets) may carry temporary **2x promotional multipliers**.

### B. Liquidity Provider (LP) Points Formula
$$\text{LP Points} = \text{USDC Deposited in Counterflow} \times \text{Days Staked} \times 0.5$$
- Encourages sticky, deep passive liquidity in `cfUSDC`.

---

## 2. Tracking Your Points

- Navigate to the **Rewards** tab on [priest.trade](https://priest.trade).
- The dashboard displays your **Current Epoch Points**, **Lifetime Points**, **Estimated Tier**, and **Global Rank**.
- Points update in real time as your on-chain trades are indexed.
