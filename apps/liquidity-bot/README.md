# Perpes.fun Monad Liquidity & Bootstrap Bot

A production-grade, highly sophisticated programmatic liquidity and bootstrap market making engine for **Perpes.fun** on **Monad Testnet** (Chain ID: 10143) and **Monad Mainnet** (Chain ID: 143).

---

## 🌟 Key Capabilities

### 1. Dual Operational Modes
* **Monad Testnet (`--mode testnet`)**:
  * **No Risk Guard**: Unconstrained, aggressive liquidity boost.
  * Rapid trade cadence (2–7s Poisson intervals).
  * High leverage (up to 10x warmup limit) and larger notional sizes ($25–$150 USDC).
  * Automated `MockUSDC.faucet()` calling to ensure the bot fleet never runs out of capital.
* **Monad Mainnet (`--mode mainnet`)**:
  * **Break-Even Targeting**: Generates vibrant liquidity and volume across all created tokens while strictly preserving capital.
  * **Delta-Neutral Micro-Roundtrips**: Paired long/short positioning and timed micro-unwinds restore vAMM reserves with negligible directional exposure.
  * **Spread Harvesting via Maker Limit Orders**: Dual-sided limit orders (`placeLimitOrder`) placed within the spread capture retail flow, generating maker spread profit that offsets taker fees (10 bps).
  * **Zero Liquidation Risk**: Strictly capped at 2x leverage to ensure collateral safety.
  * **Automated Risk Guard**: Per-token capital caps, portfolio exposure limits, global drawdown circuit breaker, gas price ceiling, and anti-toxic flow / front-running cooldowns.

### 2. Autonomous Launch Detection & Bootstrap Protocol
Whenever any user launches a coin on Perpes (`TokenLaunched` event):
1. **Instant Detection**: Monitored in real-time via `watchContractEvent` and block polling on `PerpesEngine`.
2. **Phase 1: Launch Spark Momentum (0–15 mins)**:
   * Rapid Poisson trades (3–9s).
   * 65–75% Buy bias to generate green candle excitement and positive chart momentum.
   * Dual-sided resting limit orders seeded on the order book.
3. **Phase 2: Two-Way Price Discovery & Consolidation (15–45 mins)**:
   * 50/50 buy/sell cadence with profit taking.
   * Recycles USDC collateral back to wallets while maintaining steady volume and natural wick formation.
4. **Phase 3: Steady-State Hand-off (45–60 mins+)**:
   * Transitions seamlessly into the background maintenance pool alongside all existing platform tokens.

### 3. Multi-Wallet Fleet (Sybil / Organic Appearance)
* Deterministically derives $N$ sub-wallets from the master private key.
* Distributes gas (MON) and USDC across the wallet fleet automatically.
* Enforces `PerpesEngine` position constraints (prevents `PositionSideMismatch` by rotating wallets).
* When platform users watch the recent trades tape or token page, they see multiple distinct wallet addresses actively trading rather than a single bot account.

---

## 📋 Environment Configuration

| Variable | Description | Default |
|---|---|---|
| `BOT_MODE` | Operating mode: `testnet` or `mainnet` | `testnet` |
| `EVM_CHAIN` | Chain key: `monad-testnet` or `monad` | Auto-selected by mode |
| `EVM_BOT_PRIVATE_KEY` | Master funding private key (0x...) | — |
| `NUM_SUB_WALLETS` | Number of sub-wallets in the fleet | `6` |
| `EVM_RPC_URL` | Monad RPC Endpoint | `https://testnet-rpc.monad.xyz` or `https://rpc.monad.xyz` |
| `BOOTSTRAP_DURATION_MINUTES` | Total bootstrap period per new coin | `60` |
| `MAINNET_MAX_CAPITAL_PER_TOKEN_USDC` | Max USDC collateral tied up per token | `50` |
| `MAINNET_MAX_DRAWDOWN_USDC` | Global drawdown stop-loss in USDC | `75` |
| `BOT_METRICS_PORT` | HTTP status and health server port | `3025` |

---

## 🚀 Running the Bot

### Testnet Mode (Unconstrained Liquidity)
```bash
# Using pnpm
pnpm --filter @perpes/evm-liquidity-bot dev:testnet

# Or directly with flags
dotenv -e ./.env -- tsx apps/evm-liquidity-bot/src/index.ts --mode testnet
```

### Mainnet Mode (Break-Even Liquidity Provision)
```bash
# Using pnpm
pnpm --filter @perpes/evm-liquidity-bot dev:mainnet

# Or directly with flags
dotenv -e ./.env -- tsx apps/evm-liquidity-bot/src/index.ts --mode mainnet
```

---

## 📊 Live Monitoring & Health Endpoints

The bot exposes an HTTP server on port `3025`:

* `GET http://localhost:3025/health` — Liveness & circuit breaker status
* `GET http://localhost:3025/status` or `/metrics` — Full JSON stats (volume generated, realized PnL, gas spent, active bootstraps, wallet balances)

It also renders a live ASCII console dashboard every 10 seconds:
```text
════════════════════════════════════════════════════════════════════════
🤖 PERPES LIQUIDITY BOT |  MONAD MAINNET (Break-Even Mode)  | Uptime: 420s
────────────────────────────────────────────────────────────────────────
📈 Volume Generated:  $14,280.50  │  PnL Realized:  +$1.40
⛽ Total Gas Spent:   0.0084 MON   │  Locked Collateral: $42.10
🌐 Markets Tracked:   14           │  Active Bootstraps: 2
────────────────────────────────────────────────────────────────────────
🔥 Active Token Bootstraps:
   • PEPE2    [SPARK]     Trades:  48 | Vol: $3,210.00 | 0x82...
   • DOGEX    [DISCOVERY] Trades:  19 | Vol: $1,450.20 | 0x14...
────────────────────────────────────────────────────────────────────────
👛 Sub-Wallet Fleet (6 active wallets):
   #0 (0xa7f1...): 0.1980 MON │ $45.20 │ Pos: 1
   #1 (0xb2c9...): 0.1975 MON │ $52.80 │ Pos: 0
   ...
════════════════════════════════════════════════════════════════════════
```
