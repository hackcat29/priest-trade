# Claiming Rewards

When a reward epoch concludes, eligible participants can claim their rewards through the Priest.trade rewards interface.

---

## 1. The Epoch Finalization Process

1. **Epoch Snapshot:** At the designated epoch end timestamp, point calculations are frozen.
2. **Anti-Sybil Audit:** The rewards engine runs final audits across all high-volume accounts to exclude flagged wash trading clusters.
3. **Merkle Tree Distribution:** A cryptographic Merkle root of the finalized reward distribution is calculated and posted to the rewards distribution contract on Monad.

---

## 2. How to Claim Your Rewards

1. Visit the **Rewards** page at [priest.trade](https://priest.trade).
2. Connect your wallet.
3. If your address is eligible in the finalized distribution, the **Claim Rewards** card will illuminate, detailing your claimable allocation.
4. Click **Claim All Rewards**.
5. Sign the claim transaction in your wallet.
6. The funds (reward tokens or USDC) will be transferred directly to your wallet address.

---

## 3. Unclaimed Rewards

Rewards remain claimable indefinitely; there is no forced clawback of past earned epochs. You can claim after each epoch or accumulate multiple epochs to minimize gas transactions.
