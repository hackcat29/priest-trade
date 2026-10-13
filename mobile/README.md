# Priest.trade Mobile (iOS & Android)

The official cross-platform mobile application for **[Priest.trade](https://priest.trade)** — the Monad-native perpetuals exchange and launchpad.

Built with **React Native 0.86**, **Expo SDK 57**, **Expo Router**, and **Reanimated 4**, delivering smooth 60fps gesture trading, live WebSocket orderbooks, and instantaneous execution on the Monad network.

---

## ⚡ Core Mobile Features

1. **Permissionless Perp Listing:**
   - Paste any Monad ERC-20 contract address.
   - Automatically detects Uniswap v3/v4 pool depth and verifies oracle compatibility.
   - Deploy live perpetual markets in a single transaction directly from your phone.
   - Earn the creator share of trading fees.

2. **Mobile Perpetuals Trading Terminal:**
   - Sub-second trade execution optimized for Monad's 1-second block times.
   - Interactive candlestick chart bars with 1m, 5m, 15m, 1h, 1d intervals.
   - Live visual order book depth and recent trade ticker tape.
   - Up to **40x leverage** with haptic feedback slider controls.
   - Native Take-Profit (TP) and Stop-Loss (SL) limit triggers.

3. **Counterflow LP Vault (`cfUSDC`):**
   - Direct mobile staking into isolated ERC-4626 counterparty vaults.
   - Earn 30% protocol fee distribution and market surplus.
   - Live vault utilization, NAV tracking, and withdrawal cooldown timer.

4. **Token Launchpad (Primary & Secondary Stages):**
   - Fair-launch new tokens on a virtual AMM curve ($x \cdot y = k$) with zero pre-mine.
   - Track live graduation progress towards Uniswap v4 pool seeding and permanent LP NFT burn (`0x...dEaD`).

5. **Non-Custodial Wallet Support:**
   - EVM wallets (MetaMask, Rabby, Coinbase Wallet, Rainbow).
   - Seamless social login via Privy (Email, Google, Apple).
   - Monad Testnet Faucet integration to claim testnet MON & MockUSDC.

---

## 🛠️ Getting Started

### Prerequisites
- Node.js >= 20
- `pnpm`
- Expo Go app on your iOS or Android physical device, or Xcode / Android Studio simulator.

### Install & Run
```bash
# Navigate to mobile directory
cd mobile

# Install dependencies
pnpm install

# Start Expo dev server
pnpm start

# Run on iOS simulator
pnpm ios

# Run on Android emulator
pnpm android
```

---

## 📱 App Architecture

```
mobile/
├── assets/                  # Icons, splash screens, visual branding
├── src/
│   ├── app/                 # Expo Router file-based screens
│   │   ├── (tabs)/          # Bottom navigation tabs (Trade, Markets, Portfolio, Live)
│   │   ├── list.tsx         # Permissionless token listing interface
│   │   ├── counterflow.tsx  # Counterflow LP vault staking
│   │   ├── launch.tsx       # Fair-launch token creation
│   │   ├── faucet.tsx       # Monad Testnet faucet
│   │   └── market/[mint].tsx# Dynamic deep-linked trading screen
│   ├── components/          # Reusable UI widgets (OrderBook, CandleChart, TradePanel)
│   ├── constants/           # Monad theme tokens, typography, and colors
│   ├── hooks/               # State management (usePriestState, useTheme)
│   └── lib/                 # Typed API client, Monad deployment loaders, types
```
