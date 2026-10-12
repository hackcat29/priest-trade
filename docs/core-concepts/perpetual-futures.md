# Perpetual Futures Primer

A perpetual future (or "perp") lets you trade the price of a coin with leverage without actually holding the underlying asset and without an expiration date.

---

## Spot vs Perps

| Feature | Spot Trading | Perpetual Futures |
|---|---|---|
| **What you hold** | The actual coin in your wallet | A contract tracking the coin's price |
| **Leverage** | 1x (no leverage) | Up to 40x on Priest.trade |
| **Shorting** | Hard; requires borrowing | Native; click Short and profit if price drops |
| **Expiration** | None | None |
| **Collateral** | 100% of the token cost | USDC margin (e.g. $25 opens a $1,000 position at 40x) |

---

## Going Long vs Going Short

- **Going Long (Green):** You expect the price to go up. You profit if it rises, and lose if it drops.
- **Going Short (Red):** You expect the price to go down. You profit if it falls, and lose if it rises.

---

## Key numbers on your trade

1. **Collateral (Margin):** The real USDC you deposit to back your trade.
2. **Leverage:** The multiplier you select (e.g. 5x, 10x, 40x).
3. **Position Size (Notional):** Your collateral multiplied by your leverage. ($50 margin at 10x = $500 position size).
4. **Entry Price:** The average price where your trade was filled.
5. **Mark Price:** The current live trading price of the contract.
6. **Unrealized PnL:** Your open profit or loss right now if you closed at the mark price.
7. **Liquidation Price:** The price level where your losses wipe out your margin. If the market reaches this price, your trade gets liquidated.

---

## Why perps track the real price

Because perps don't expire, they use **funding rates** to stay tethered to spot. If perps trade higher than spot, longs pay shorts to nudge the price down. If perps trade lower than spot, shorts pay longs to nudge the price up.

---

## See also

- [Funding Rates](funding-rates.md) — how funding payments work.
- [Leverage & Margin](leverage-and-margin.md) — margin math and liquidation thresholds.
- [Placing Orders](../trading/placing-orders.md) — opening your first position.
