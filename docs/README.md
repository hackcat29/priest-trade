# Welcome to Priest.trade

**Priest.trade is the perpetuals launchpad on Monad.** Conviction, leveraged.

Any coin on Monad can be born with an immediate perpetuals market, grow through a virtual AMM, and graduate into an on-chain secondary market powered by Uniswap v4 and the Counterflow LP vault — all inside one protocol.

This documentation is the complete guide for traders, creators, liquidity providers, and developers on Priest.trade.

---

## What makes Priest.trade different

Most launchpads stop at a spot bonding curve. Most perp DEXes only list a handful of major tokens.

Priest.trade merges both:

- **Launch any coin with live perps:** Anyone can create a token with fair-launch protections, no creator pre-mine, and an immediate perpetuals market with up to **40x leverage**.
- **Fast and cheap on Monad:** Sub-second block times, fast execution, and gas fees that cost fractions of a cent.
- **List existing coins permissionlessly:** If an existing Monad coin has a qualifying Uniswap v3 or v4 pool, anyone can list it as an oracle-priced perp market and earn creator fees.
- **Graduation into Uniswap v4:** Once a market clears 5 volume and resilience gates, the protocol seeds a real Uniswap v4 spot pool and permanently burns the LP position NFT to `0x...dEaD`.
- **Counterflow LP Vault (`cfUSDC`):** Passive LPs deposit USDC into an ERC-4626 vault that backs graduated markets, earning 30% of platform fees plus market surplus when traders lose.
- **Native Circle USDC margin:** All trading and vault accounting is denominated in native Circle USDC on Monad.

---

## Who this guide is for

- **Traders** longing or shorting coins with up to 40x leverage, on-chain TP/SL, and limit orders.
- **Creators & Listers** launching new tokens or listing existing ones to earn up to 50% of trading fees.
- **Liquidity Providers** depositing USDC into Counterflow for passive yield.
- **Developers** integrating with our smart contracts, REST API, or WebSocket streams.

---

## Quick links

| Need to… | Go to |
|---|---|
| Connect your wallet (Privy, Rabby, MetaMask) | [Connecting Your Wallet](getting-started/connecting-your-wallet.md) |
| Fund your account with USDC & MON | [Funding Your Account](getting-started/funding-your-account.md) |
| Get free test tokens on Monad Testnet | [Faucet & Testnet](getting-started/faucet-and-testnet.md) |
| Place your first trade | [Placing Orders](trading/placing-orders.md) |
| Understand how the vAMM works | [vAMM Explained](core-concepts/vamm-explained.md) |
| See how secondary markets trade | [Secondary Market Engine](core-concepts/secondary-market-engine.md) |
| Learn how graduation works | [Graduation into Uniswap v4](launching-tokens/graduation.md) |
| Earn yield in the Counterflow Vault | [Counterflow Overview](vaults/counterflow-vault.md) |
| Review fees and creator cuts | [Fees](trading/fees.md) |
| View verified contract addresses | [Contract Deployments](developers/deployments.md) |

---

## A note on risk

Perpetual futures are leveraged derivatives. A price move of just a few percent against your position at high leverage can result in the complete loss of your deposited margin. Newly launched tokens are inherently volatile. **Never trade with money you cannot afford to lose.** Read the [Risk Disclosure](safety/risk-disclosure.md) before placing your first trade.

---

## Support & Community

- **Web App:** [priest.trade](https://priest.trade)
- **API:** [api.priest.trade](https://api.priest.trade)
- **Community:** Links to official Discord and Telegram channels are available in the app.
- **Bug Reports:** See [Reporting Bugs](support/reporting-bugs.md).
