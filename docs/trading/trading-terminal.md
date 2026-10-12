# Trading Terminal Tour

The Priest.trade trading terminal is built for fast execution and clear risk management on Monad.

---

## Terminal layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Header: Logo | Markets | Trade | Launch | Vault | Rewards | [Connect Wallet] │
├───────────────────────────────────┬─────────────────────────────────────────┤
│ Market Header:                    │ Order Placement Panel:                  │
│ Ticker | Mark Price | 24h Change  │ Long / Short Toggle                     │
│ 24h Vol | Funding | Status Badge  │ Market / Limit Tabs                     │
├───────────────────────────────────┤ Collateral Input (USDC)                 │
│ Live Candlestick Chart            │ Leverage Slider (1x - 40x)              │
│ (Real-time candles & indicators)  │ Slippage Settings                       │
│                                   │ Est. Entry | Fee | Liq Price            │
│                                   │ [ Buy / Sell Button ]                   │
├───────────────────────────────────┴─────────────────────────────────────────┤
│ Bottom Dock:                                                                │
│ [Open Positions] | [Open Orders] | [Order History] | [Trade History]        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Market Header
The top bar shows key stats for the active coin:
- **Token Symbol & Icon:** The asset currently loaded.
- **Mark Price:** Current execution price.
- **24h Change:** Price move over the last 24 hours (green for up, red for down).
- **24h Volume:** Total trading volume in USDC over the last 24 hours.
- **Funding Rate:** Continuous funding rate (e.g. `+0.015% / hr`).
- **Status Badge:** Shows whether the market is in `Warmup (10x)`, `Active (40x)`, or `Graduated`.

---

## 2. Interactive Chart
Real-time candlestick charts with custom timeframes:
- Choose from **1m, 5m, 15m, 1h, 4h, and 1D** candles.
- Overlays on the chart show your live **Entry Price**, **Take Profit / Stop Loss lines**, and your **Liquidation Price**.

---

## 3. Order Placement Panel
Located on the right side:
- **Long / Short:** Select green for Long, red for Short.
- **Order Types:** Choose **Market** for instant execution or **Limit** to set a target price.
- **Collateral Input:** Enter how much USDC you want to commit as margin.
- **Leverage Slider:** Slide from 1x up to 40x (or 10x if in Warmup).
- **Summary Preview:** Shows estimated entry price, price impact, the 0.10% trading fee, and your liquidation price before you click submit.

---

## 4. Positions & Orders Dock
The bottom section gives you complete control over your open trades:
1. **Open Positions:** Shows live trades, margin, unrealized PnL, liquidation price, collateral adjustments (`+` / `-`), and close buttons.
2. **Open Orders:** Lists resting limit and stop orders with one-click cancel buttons.
3. **Order History:** Past filled and cancelled orders.
4. **Trade History:** Chronological log of all completed fills.

---

## See also

- [Placing Orders](placing-orders.md) — step-by-step order guide.
- [Order Types](order-types.md) — market vs limit vs stops.
- [Managing Positions](managing-positions.md) — adding margin and closing trades.
