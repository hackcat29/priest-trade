# Take Profit & Stop Loss

Priest.trade features native on-chain **Take Profit (TP)** and **Stop Loss (SL)** triggers, allowing you to lock in gains and protect downside risk without leaving your computer on.

---

## 1. How Triggers Work

Unlike off-chain bot triggers that rely on centralized servers, TP and SL on Priest.trade are stored directly in the `PerpesEngine` smart contract storage for your position:

- **Take Profit (`takeProfitPriceE6`):** The target price at which you wish to close your position in profit.
  - *Longs:* Must be strictly above your entry price.
  - *Shorts:* Must be strictly below your entry price.
- **Stop Loss (`stopLossPriceE6`):** The threshold at which you wish to cut losses before liquidation.
  - *Longs:* Must be strictly below your entry price.
  - *Shorts:* Must be strictly above your entry price.

---

## 2. Setting TP / SL in the UI

1. Open a position or locate an existing open trade in the **Positions** table.
2. Click the **TP/SL** button on your position row.
3. In the modal:
   - Enter your target **Take Profit Price** (or click `+10%`, `+25%`, `+50%`, `+100%` ROI).
   - Enter your target **Stop Loss Price** (or click `-5%`, `-10%`, `-20%` ROI).
4. Review the estimated profit and loss figures in USDC.
5. Click **Confirm Triggers** and sign the transaction in your wallet.

---

## 3. Execution Mechanics

Once stored on-chain:
1. Automated protocol keepers monitor positions on every block tick.
2. When the market price breaches your TP or SL level at *both* the mark and index price:
   - The keeper calls `executeTrigger(token, owner)`.
   - Your position is automatically closed at the prevailing market price.
   - Payout proceeds (collateral $\pm$ net PnL) are sent directly to your wallet.
   - You pay only the standard taker fee (0.10%).

---

## 4. Automatic Trigger Adjustment on Averaging (Security L-1 Fix)

What happens if you have an active TP or SL and then add to your position at a different price?

- Averaging in shifts your volume-weighted entry price.
- If adding to a long position pushes your average entry price *above* an existing Take Profit level, that TP would otherwise fire immediately as a loss.
- **Priest.trade Protection:** When you increase an existing position, `PerpesEngine` automatically recalculates your new entry price. Any pre-existing trigger that falls on the wrong side of the new entry price is automatically cancelled and reset to protect you from unintended loss fills.
