# Slippage & Execution

Understanding price impact and execution parameters ensures that your trades execute as expected without unnecessary loss.

---

## 1. What Causes Slippage?

Slippage is the difference between the expected price shown when you submit an order and the actual execution price when the transaction confirms on-chain.

Slippage arises from two distinct sources:
1. **Price Impact:** The mathematical shift along the bonding curve or spot order book caused by the size of your own order relative to available liquidity depth.
2. **Market Movement:** Price changes caused by other traders whose transactions confirmed in the same or preceding block.

---

## 2. Execution on the Primary Rail (vAMM)

On the vAMM, every market fill executes along the constant-product curve ($x \cdot y = k$):
- **Small Orders ($< \$500$):** Negligible price impact ($< 0.05\%$).
- **Large Orders ($> \$10,000$):** Noticeable curve impact. The order panel displays your exact estimated price impact before you submit.
- **Slippage Parameter:** Passed as `maxSlippageBps` to `openPosition()` and `closePosition()`. If rapid external trades move the entry price beyond this threshold, the contract will revert with `SlippageExceeded()`.

---

## 3. Execution on the Secondary Rail (Oracle & Uniswap v4)

On the Secondary Engine, execution differs fundamentally:
- **Worst-Of Price Floor:** Takers fill at the worse of spot and oracle price.
- **Skew Premium:** Fills are subject to an open interest skew premium that scales with net imbalance between longs and shorts.
- **Path Averaging:** The contract integrates the skew curve across your entire trade size. Attempting to split a $10,000 order into ten $1,000 sub-transactions yields the exact same total slippage and cost, protecting the market from MEV fragmentation.

---

## 4. Recommended Slippage Settings

In the trade settings modal:
- **Normal Market Conditions:** `0.5% – 1.0%`
- **High Volatility / Fast Moves:** `1.5% – 2.5%`
- **New Launches (Warmup Phase):** `2.0% – 3.0%`
