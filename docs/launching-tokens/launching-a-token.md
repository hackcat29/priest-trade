# Launching a Token

Launching a token on Priest.trade takes less than 2 minutes and requires zero coding knowledge.

---

## Step-by-Step Launch Guide

### 1. Navigate to the Launchpad
Click the **Launch** button in the top navigation bar at [priest.trade](https://priest.trade).

### 2. Enter Token Metadata
Fill out the token profile details:
- **Token Name:** The human-readable name of your token (e.g. *Monad Cathedral*).
- **Token Symbol (Ticker):** 3 to 6 uppercase characters (e.g. *CATH*).
- **Description & Story:** A concise explanation of your project's vision, meme lore, or community focus.
- **Logo / Banner Image:** Upload a square PNG/SVG logo (at least 512x512) and an optional banner image.
- **Social Links:** Provide links to your official X (Twitter), Telegram, Discord, and website.

### 3. Review Contract Parameters
Under the hood, Priest.trade standardizes all token launches for community safety:
- **Total Supply:** 1,000,000,000 (1 Billion) tokens with 18 decimals.
- **Token Mint Authority:** The entire supply is minted directly to the `PerpesEngine` contract. The creator receives zero team allocation upfront, ensuring an authentic fair launch.
- **Initial Perp Price:** Calibrated by the protocol curve ($0.01 initial reference).
- **CREATE2 Deterministic Address:** The token address is deterministically computed from your creator wallet and salt, preventing front-running and address squatting.

### 4. Deploy On-Chain
1. Click **Create Token & Market**.
2. If a launch fee is configured in protocol parameters, it will be included in the transaction value.
3. Sign the transaction in your wallet.
4. Your token contract is deployed, your virtual AMM perpetual market is instantly live, and your community can begin trading!
