# Fees

Priest.trade features a low, transparent fee schedule that rewards liquidity makers and provides generous monetization for token creators and listers.

---

## 1. Trade Fee Schedule

| Action | Fee Rate | Notes |
|---|---|---|
| **Taker Order** (Market fills, crossing book) | **0.10%** (10 bps) of notional | Deducted from margin on open, or realized PnL on close. |
| **Maker Order** (Resting Limit fills) | **0.02%** (2 bps) of notional | 80% discount for providing resting limit liquidity. |
| **Deposit / Withdraw Margin** | **0.00%** | Zero platform fee (only standard Monad gas). |
| **Cancel Limit Order** | **0.00%** | 100% escrow refund (only standard Monad gas). |
| **Set TP / SL Triggers** | **0.00%** | Free on-chain trigger registration. |
| **Counterflow Deposit / Redeem** | **0.00%** | No entrance or exit fees on `cfUSDC`. |

*Note on Network Gas:* Every transaction requires a tiny network fee paid in native MON to the Monad validator network (typically less than $0.001).

---

## 2. On-Chain Fee Split Waterfall

Every taker fee collected by `PerpesEngine` is automatically routed on-chain across four stakeholders:

| Beneficiary | Qualified Creator Tier | Unqualified Creator Tier |
|---|---|---|
| **Token Creator / Lister** | **50%** (5 bps) | **25%** (2.5 bps) |
| **Market Insurance Fund** | **10%** (1 bp) | **10%** (1 bp) |
| **Counterflow LP Vault (Backed Markets)** | **30%** (3 bps) | **30%** (3 bps) |
| **Protocol Treasury** | Remainder | Remainder |

### Creator Qualification Gate:
- A token creator permanently unlocks the **50% fee split** if the market achieves at least **$100,000 in volume within its first 30 days**.
- If a market fails to reach this threshold within 30 days, the creator fee remains at the base **25%** share.
- Listers of permissionless existing tokens also earn creator fee shares! See [Creator Earnings](../launching-tokens/creator-earnings.md).

---

## 3. Referral Fee Credits

If you refer friends using your custom referral link:
- **5% of your referee's trading fees** are credited directly to your referral earnings.
- Referral rewards are tracked continuously and distributed in points and claimable USDC.
- See [Referrals](../rewards-and-referrals/referrals.md) for full details.

---

## 4. Net Round-Trip Cost Calculation

To calculate your total breakeven price movement on a round-trip trade:

$$\text{Round-Trip Cost} = \text{Open Fee} + \text{Close Fee} + \text{Slippage} + \text{Funding Cost}$$

For a standard market order with minimal slippage:
- Open Taker Fee = 0.10%
- Close Taker Fee = 0.10%
- Total Base Fee = **0.20%**

A price movement of just **0.20%** in your favor covers all platform fees, after which your position is in net profit.
