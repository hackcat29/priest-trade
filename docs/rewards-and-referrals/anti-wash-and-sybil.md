# Anti-Wash & Anti-Sybil

The rewards program is only fair if genuine market participation is rewarded and artificial volume is filtered out. Priest.trade enforces clear, transparent rules for what constitutes wash trading or Sybil behavior, with one simple and strict consequence.

---

## 1. What is Wash Trading?

A "wash trade" is any trade that does not reflect authentic economic risk or intent—typically the same operator (or coordinated wallets) rapidly trading to inflate volume numbers purely to farm points.

Trades are flagged by the rewards engine if they meet **either** of the following conditions:

### A. Position Hold Time Under 60 Seconds
A trade is flagged if a position was opened and closed within **60 seconds**. Sub-minute scalping with leveraged perpetuals incurs round-trip fees and slippage that make rapid flips uneconomic for genuine trading; many such trades are bots spinning volume.

### B. Counterparty Concentration Above 70%
A trader is flagged if **more than 70% of their volume is executed against the same counterparty**. Two wallets consistently trading primarily against one another typically indicate coordinated self-trading.

---

## 2. Sybil Detection

A "Sybil" attack occurs when one operator coordinates multiple separate wallets to appear as distinct users on rewards leaderboards. 

Priest.trade monitors **cross-wallet trade correlation**:
- If two or more wallets exhibit **above 95% correlation** in timing, sizing, direction, and counterparties, the cluster is flagged as a Sybil entity.
- The 95% threshold is intentionally high: friends trading the same chart setups will never trip it; automated script-driven wallet clusters will.

---

## 3. Penalty: Zero Reward Points

The protocol enforces a clear rule regarding flagged wash trading:

> **The penalty for wash trading is zero reward points.**

- **Excluded from Point Calculations:** Any trade or volume flagged by the anti-wash filter earns **0 reward points** ($0\times$ multiplier). It does not count toward volume points, fee points, open-interest holding points, or epoch leaderboard standing.
- **Only Rewards Eligibility is Affected:** The penalty begins and ends with rewards points.

---

## 4. What Does NOT Get Flagged

Legitimate trading activity is never penalized:
- Closing a position quickly because a sudden price spike triggered your stop loss.
- High-frequency trading across diverse market flow and multiple counterparties.
- Providing resting limit orders that fill against organic taker flow.

---

## 5. Token Creators

Creators who wish to participate in rewards epochs must build authentic community volume. Self-wash volume executed by a creator earns **0 points** in the rewards program. Real volume and organic conviction are the only activities that earn reward allocations.
