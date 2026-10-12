# Placing Orders

Placing a trade on Priest.trade is straightforward, non-custodial, and executes directly on Monad.

---

## Step-by-Step Order Placement

### 1. Choose Side: Long or Short
- Click **Long** if you believe the token price will increase.
- Click **Short** if you believe the token price will decrease.

### 2. Enter Collateral Amount
- Specify your margin collateral in **USDC**.
- The collateral is pulled directly from your connected wallet when the order executes.
- Ensure your wallet holds sufficient native MON to pay the sub-cent gas fee.

### 3. Set Leverage
- Drag the leverage slider or type your desired leverage multiplier (e.g. 5x, 10x, 25x, 40x).
- Your **Position Size (Notional)** will automatically populate:
  $$\text{Notional Size} = \text{Collateral} \times \text{Leverage}$$
- *Note:* If a market is within its first 24-hour **Warmup** phase, leverage is capped at **10x**.

### 4. Configure Slippage Tolerance
- Default slippage tolerance is set to **1.0%** (100 bps).
- For large orders or volatile meme tokens, adjust slippage in the settings modal (e.g. 0.5% to 3.0%).
- If the execution price moves beyond your slippage tolerance before your transaction confirms, the transaction will revert safely, protecting your funds.

### 5. Review Execution Details
Before clicking submit, review the summary box:
- **Entry Price:** Estimated average fill price.
- **Price Impact:** The percentage impact your trade will have on the virtual curve or spot pool.
- **Trading Fee:** 0.10% taker fee, deducted from your initial margin.
- **Estimated Liq. Price:** The price at which maintenance margin is breached.

### 6. Submit Transaction
- If this is your first time using USDC on Priest.trade, click **Approve USDC** to grant token allowance to `PerpesEngine`.
- Click **Open Long** or **Open Short**.
- Confirm the transaction in your wallet. Fills typically confirm in ~1 second on Monad!
