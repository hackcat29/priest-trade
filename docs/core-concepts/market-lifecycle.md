# Market Lifecycle

Every market on Priest.trade moves through a clear set of stages, managed directly by the smart contract.

---

## Market stages at a glance

```
[ New Coin Launch ] ──> [ Warmup (24h, 10x max) ] ──> [ Active (40x max) ]
                                                              │
                                                        Clears 5 Gates
                                                              ▼
[ Existing Coin Listing ] ─────────────────────────> [ Graduated (Uniswap v4) ]
                                                              │
                                                        (Rare emergency)
                                                              ▼
                                                        [ Delisted ]
```

---

## The stages explained

### 1. Warmup
- **When:** The first 24 hours after a new coin is created.
- **Rules:** The market is fully tradeable, but maximum leverage is capped at **10x**.
- **Why:** Lets early price discovery happen without instant 40x liquidations.

### 2. Active (Primary Rail)
- **When:** Warmup ends automatically after 24 hours.
- **Rules:** Maximum leverage raises to **40x**. All order types (Market, Limit, TP/SL) are fully active.
- **Progress:** The coin starts tracking progress toward graduation.

### 3. Transition
- **When:** The market clears all 5 graduation gates and graduation is executed.
- **Rules:** Trading pauses briefly while the engine seeds the Uniswap v4 spot pool and burns the LP position NFT to `0x...dEaD`.
- **Positions:** Existing trades remain intact across the transition.

### 4. Graduated (Secondary Rail)
- **When:** The Uniswap v4 pool is live and confirmed.
- **Rules:** 
  - Trades off the on-chain spot oracle with worst-of fills and skew premiums.
  - Opening leverage starts at 15x and increases by 5x a day up to 40x.
  - Automatically backed by the **Counterflow Vault (`cfUSDC`)**.
  - Graduated markets cannot be deleted or ungraduated.

### 5. Delisted (Close-Only)
- **When:** Used only in extreme cases (e.g. underlying token exploit or protocol emergency).
- **Rules:** No new positions can be opened. You can close existing trades and withdraw your collateral at any time.

---

## See also

- [The vAMM Primary Market](vamm-explained.md) — how primary markets trade.
- [The Secondary Market Engine](secondary-market-engine.md) — how graduated markets trade.
- [Graduation into Uniswap v4](../launching-tokens/graduation.md) — what happens when a market graduates.
