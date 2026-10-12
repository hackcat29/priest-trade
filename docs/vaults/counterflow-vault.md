# Counterflow Overview

The **Counterflow Vault** is Priest.trade's automated liquidity vault. It lets passive liquidity providers deposit USDC to back graduated perpetuals markets on Monad and earn real yield.

---

## What is Counterflow?

On Priest.trade, graduated markets are backed by an ERC-4626 vault (`CounterflowVault.sol`):

- **Deposit USDC, get `cfUSDC`:** When you deposit native Circle USDC, you receive `cfUSDC` shares.
- **Counterparty to graduated markets:** If a backed market runs into a temporary deficit paying out winning traders, Counterflow steps in to cover the difference.
- **Earns platform yield:** In exchange, Counterflow receives:
  1. **30% of all protocol trading fees** from backed markets.
  2. **The market surplus** when traders lose (what traders lose repays past covers first, with the remainder becoming vault profit).
- **Redemption cooldown:** To stop people from front-running losses by withdrawing right after a big market move, withdrawals use a **3-day cooldown**.

---

## Tokenized shares: `cfUSDC`

Counterflow uses the standard ERC-4626 vault design:

- **Underlying asset:** Native Circle USDC on Monad.
- **Share token:** `cfUSDC`.
- **Value appreciation:** As trading fees and market surplus flow into the vault, each `cfUSDC` share becomes worth more USDC over time:
  $$\text{Share Price} = \frac{\text{Total Vault USDC (NAV)}}{\text{Total cfUSDC Shares}}$$
- When you burn your `cfUSDC` shares during withdrawal, you get back your initial deposit plus your share of accrued earnings.

---

## Which markets does it back?

Counterflow doesn't back brand-new coins during their initial vAMM launch. It only backs:
- **Graduated markets:** Once a coin graduates and seeds its locked Uniswap v4 spot pool, it is automatically backed by Counterflow.
- **Selected listed markets:** Coins with deep, verified spot pools where the operator turns on backing.

---

## Contract Addresses

| Network | Contract | Address |
|---|---|---|
| **Monad Mainnet (143)** | `CounterflowVault` (`cfUSDC`) | `0x7AA4Bc202A7FB54766b83D8a01046248D1b250F1` |
| **Monad Testnet (10143)** | `CounterflowVault` (`cfUSDC`) | `0x0cDa05B16734793AeF452C983bE5773c720Da471` |

---

## See also

- [Depositing & Withdrawing cfUSDC](depositing-and-withdrawing.md) — step-by-step deposit and redemption guide.
- [NAV, Yield & Profit Unlocking](nav-and-yield.md) — how yield and NAV are calculated.
- [Risk Controls & Exposure Caps](risk-controls.md) — safety caps protecting LPs.
