# Managing Positions

Once you have opened a perpetual futures position on Priest.trade, managing your risk and profits is handled directly from the **Positions** table.

---

## The Positions Table

Your active trades display real-time statistics:

| Column | Description |
|---|---|
| **Market** | Token symbol and contract badge. |
| **Side** | `LONG` (Green) or `SHORT` (Red). |
| **Size (Notional)** | Total dollar exposure of the position. |
| **Entry Price** | Volume-weighted average entry price. |
| **Mark Price** | Current contract execution price. |
| **Liquidation Price** | The price at which maintenance margin is breached. |
| **Margin / Leverage** | Deposited collateral in USDC and current effective leverage. |
| **Unrealized PnL** | Current profit or loss in USD and ROI percentage. |
| **TP / SL** | Configured Take Profit and Stop Loss levels. |
| **Actions** | Close, Add/Remove Margin, and Share PnL Card buttons. |

---

## 1. Closing a Position

You can close a position partially or in full at any time:

### Full Close (Market Close)
1. Click the **Close** button on your position row.
2. Select **100%**.
3. Confirm the transaction.
4. The position base asset is sold back into the curve or secondary engine.
5. Your initial collateral plus realized net profit (or minus realized loss) is immediately transferred back to your wallet in USDC.

### Partial Close
1. Click **Close** and select **25%**, **50%**, or **75%** (or type a specific dollar amount).
2. The specified portion is closed at the market price, realizing proportional PnL and returning proportional collateral to your wallet.
3. The remaining size stays open at the original entry price.

---

## 2. Adjusting Margin (De-risking)

If the market moves against you and approaches your liquidation price, you can adjust your margin without closing the trade:

- **Add Collateral (`+`):** Transfers USDC from your wallet into the position's margin balance. Your margin ratio increases immediately, moving your liquidation price farther away.
- **Remove Collateral (`-`):** If your position has accumulated significant collateral buffer, you can withdraw excess margin back to your wallet. 
  - *Condition:* Your remaining margin must still satisfy the initial margin requirement ($\text{Margin Ratio} \ge \text{Initial Margin}$). Unrealized paper profits cannot be withdrawn while the trade is open.

---

## 3. Claiming Unsettled Profit (`claimUnsettledProfit`)

Under rare circumstances on secondary markets (such as temporary vault liquidity constraints), profit from an exited trade may be deferred rather than paid out immediately:
- Deferred profit is credited to your `Position.unsettledProfitUsdc`.
- The moment vault headroom is replenished or Counterflow completes a liquidity draw, click **Claim Profit** to withdraw 100% of your owed profit to your wallet.
