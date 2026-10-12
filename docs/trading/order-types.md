# Order Types

Priest.trade supports a comprehensive suite of order types native to `PerpesEngine.sol`:

---

## 1. Market Orders

A **Market Order** executes immediately at the best available current price:
- **Execution:** Filled against the vAMM curve (primary rail) or worst-of spot oracle (secondary rail).
- **Fee:** Taker fee (0.10%).
- **Slippage Protection:** Controlled via `maxSlippageBps`. If the fill breaches your slippage limit, it reverts.

---

## 2. Resting Limit Orders (`OrderType.Limit`)

A **Limit Order** lets you specify the exact maximum price you are willing to pay (for a Long) or the minimum price you are willing to accept (for a Short):
- **Escrow Accounting:** When placed, your collateral is locked in contract escrow (`Market.orderEscrowUsdc`).
- **Maker Execution:** When filled by a keeper or matching counterparty, limit orders pay the discounted **Maker Fee of 0.02%** (2 bps).
- **Cancellation:** Can be cancelled permissionlessly at any time while unfilled, instantly refunding 100% of your escrowed USDC.

---

## 3. Stop-Market Orders (`OrderType.StopMarket`)

A conditional order that activates a market order once a predetermined trigger price is breached:
- **Use Case:** Momentum breakout trading or emergency stop losses.
- **Execution:** Remains dormant in the contract order book until the market mark price crosses the trigger level, upon which it executes as a market order.

---

## 4. Stop-Limit Orders (`OrderType.StopLimit`)

A conditional order with two prices: a **Stop Price** and a **Limit Price**:
- When the market reaches the Stop Price, a resting Limit Order is automatically posted at your specified Limit Price.
- Prevents slippage beyond your limit price, but carries the risk of not filling if the market gaps through your limit.

---

## 5. Immediate or Cancel (IOC) & Fill or Kill (FOK)

Advanced execution parameters for algorithmic traders:
- **Immediate or Cancel (IOC):** Fills as much of the order as possible immediately at the specified price or better, and cancels any remaining unfilled balance (refunding unspent escrow).
- **Fill or Kill (FOK):** Requires the entire order size to be filled immediately; otherwise, the entire order is cancelled with zero fill.

---

## 6. On-Chain Take Profit & Stop Loss (Triggers)

Priest.trade supports position-level **Take Profit (TP)** and **Stop Loss (SL)** triggers:
- Stored directly in the position state (`Position.takeProfitPriceE6`, `Position.stopLossPriceE6`).
- Does not lock up additional escrow.
- When mark and index prices breach your target, the protocol keeper executes `executeTrigger()` to close your position automatically.
- See [Take Profit & Stop Loss](tp-sl-orders.md) for full details.
