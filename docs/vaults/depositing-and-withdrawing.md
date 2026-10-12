# Depositing & Withdrawing cfUSDC

Depositing and redeeming from the Counterflow Vault is managed via the **Vault** page on Priest.trade.

---

## 1. How to Deposit USDC

Depositing is instant and fee-free:

1. Navigate to the **Vault** tab on [priest.trade](https://priest.trade).
2. Review the current statistics:
   - **Vault NAV:** Total USDC backing the vault.
   - **Historical APY:** Rolling annualized yield derived from fees and market surplus.
   - **Share Price:** Current exchange rate ($1\text{ cfUSDC} \approx X\text{ USDC}$).
3. Enter the amount of **USDC** you wish to deposit.
4. If this is your first deposit, click **Approve USDC** to authorize the `CounterflowVault` contract.
5. Click **Deposit**.
6. The contract transfers your USDC into the vault and mints the equivalent amount of `cfUSDC` shares to your wallet. You immediately begin accruing real yield!

---

## 2. The 3-Day Withdrawal Cooldown

To protect long-term liquidity providers from toxic arbitrage, Counterflow implements a **2-step redemption flow with a 3-day cooldown**:

### Why is there a cooldown?
Without a cooldown, predatory actors could monitor mempool liquidations or market wicks and withdraw their liquidity a split-second before a loss occurs, dodging their share of backing risk while taking all past profits.

### Step 1: Request Redemption (`requestRedeem`)
1. On the Vault page, switch to the **Withdraw** tab.
2. Enter the number of `cfUSDC` shares you wish to redeem.
3. Click **Request Redemption**.
4. The contract burns your `cfUSDC` shares from your active balance and locks them in a timestamped `RedeemRequest` on-chain:
   $$\text{Unlock Timestamp} = \text{Current Timestamp} + \text{3 Days } (259,200\text{ seconds})$$
5. A countdown timer will appear on your dashboard showing when your assets become claimable.

> **Cancel Option:** You can cancel a pending redemption request at any time prior to claiming, which returns your `cfUSDC` shares back to your active balance.

### Step 2: Claim Your USDC (`claimRedeem`)
1. Once the 3-day cooldown expires, the claim button becomes active.
2. Click **Claim USDC**.
3. The contract evaluates the current share price at claim time and transfers your principal plus all net accrued yields in native USDC directly to your wallet!

---

## 3. Immediate vs Phased Liquidity

- During the 3-day cooldown, your requested shares no longer earn new income, but they remain subject to overall vault accounting until redeemed.
- This ensures true financial fairness: capital that enjoyed the upside of market fees remains committed through market settlement.
