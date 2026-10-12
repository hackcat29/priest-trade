# Fair-Launch Protections

Priest.trade enforces programmatic, contract-level protections to ensure all token launches are completely fair, transparent, and immune to common launchpad rug pulls.

---

## 1. Zero Creator Supply Allocation

On many launchpads, creators allocate themselves 10%–20% of the token supply for "free" before the public can buy, only to dump their tokens onto early community buyers.

On Priest.trade:
- When `createTokenAndMarket()` is called, **100% of the 1,000,000,000 token supply is minted directly into the PerpesEngine contract**.
- The creator receives **zero tokens** at launch.
- If the creator wishes to hold the token, they must buy it on the open market like every other participant.

---

## 2. No Minting or Freeze Authority

The underlying ERC-20 contract (`PerpesToken.sol`) is intentionally minimal and immutable:
- There is **no ongoing mint function**. Total supply is capped permanently at deployment.
- There is **no blacklist, freeze, or pause mechanism** on the token contract.
- The creator has zero special privileges or administrative control over the token contract once deployed.

---

## 3. Algorithmic Wash-Trading Detection

During early token trading:
- Artificial wash trading is monitored by rewards filters, and **the only penalty on wash trading is zero reward points**: flagged trades earn 0 points and are stripped from epoch point calculations. The underlying trading, fees, and market execution remain completely unaffected.

---

## 4. CREATE2 Anti-Squatting

Token contracts are deployed via `CREATE2` using a salt bound to the creator's wallet address (`msg.sender`):
- Malicious actors cannot front-run a creator's transaction in the mempool to steal their desired token contract address.
- Addresses are predictable and verifiable prior to deployment.
