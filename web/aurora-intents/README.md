# Aurora Intents: deposit from any chain

Live on [priest.trade](https://priest.trade): **Deposit → Deposit from Bitcoin, Solana, Tron & more**.

This folder is an excerpt from the Priest.trade web app (Next.js), which isn't part of this repository. A trader on Bitcoin, Solana, Tron, TON or any EVM chain sends funds to a one-off deposit address. [Aurora Intents](https://docs.intents.aurora.dev) (built on NEAR Intents) fills the deposit, and the result lands as **USDC in the trader's own Monad wallet**, the collateral Priest's perps trade on. The trader doesn't connect a wallet on the source chain, and Priest never holds the funds. If a deposit can't be filled, it's refunded to the trader's address on the source chain.

| File | What it does |
|------|--------------|
| `aurora-intents.ts` | Client for the Aurora Intents API. It lists source chains and tokens (`/api/tokens`) and finds Monad USDC (`0x7547…b603`) as the destination asset. It asks for a dry quote to preview, then a live quote that opens a deposit address (`/api/quote`, `EXACT_INPUT`, `recipient` = the trader's Monad wallet, `refundTo` = their source-chain address). It polls `/api/status` and can submit the deposit transaction hash to speed up detection (`/api/deposit/submit`). |
| `any-chain-deposit-modal.tsx` | The sheet. The trader picks a chain, a token, an amount and a refund address. It shows a live quote (USDC out, minimum out, time), then the deposit address with a QR code and any memo, and tracks the deposit through `PENDING_DEPOSIT → PROCESSING → SUCCESS` (or `REFUNDED`). |

For EVM source chains the refund address defaults to the trader's own address. Non-EVM chains ask for one before quoting. The feature only runs on Monad mainnet and is hidden unless `NEXT_PUBLIC_AURORA_INTENTS_APP_KEY` (an Intents Studio app key, public by design) is set. In the app, the remaining imports (`chain-config`, `evm`, `use-wallet-session`, `referral-qr`, `ui/modal`) are the web app's own chain config, wallet session and UI primitives.

Routes checked on 2026-10-14 (dry quotes into Monad USDC): 25 USDC on Arbitrum → 24.94 USDC (~27 s); 25 USDC on Solana → 24.94 USDC (~22 s); 0.0005 BTC → 41.47 USDC (~13 min).
