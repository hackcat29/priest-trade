# Faucet & Testnet

Priest.trade maintains a fully functional testnet deployment on **Monad Testnet** (Chain ID: `10143`). This environment mirrors the mainnet perpetuals engine, virtual AMM, graduation mechanisms, and Counterflow vault, allowing traders and developers to test strategies without real capital.

---

## Testnet Configuration

| Property | Value |
|---|---|
| **Network Name** | Monad Testnet |
| **Chain ID** | `10143` |
| **RPC Endpoint** | `https://testnet-rpc.monad.xyz` |
| **Block Explorer** | `https://testnet.monadexplorer.com` |
| **Currency** | MON (18 decimals) |
| **Engine Contract** | `0x041f3b8A1874E8ceBa41C29782Baba20B38F9c35` |
| **MockUSDC Contract** | `0x534EEE2DC77854015A398B9DD6872eF1498B6764` |
| **Counterflow Vault** | `0x0cDa05B16734793AeF452C983bE5773c720Da471` |

---

## 1. Getting Testnet MON

You need testnet MON to pay gas for transactions on Monad Testnet.

1. Navigate to the official Monad Testnet Faucet.
2. Complete the anti-bot verification.
3. Paste your EVM wallet address (`0x...`).
4. Submit the request. Funds will be deposited within seconds.

---

## 2. Using the Priest.trade MockUSDC Faucet

On testnet, trading collateral uses `MockUSDC`. You can claim 1,000 MockUSDC at any time:

### Method A: In-App Faucet
1. Visit the Priest.trade testnet web interface.
2. Connect your wallet to **Monad Testnet**.
3. Click the **Faucet** badge in the upper right navigation.
4. Confirm the transaction to receive your 1,000 MockUSDC.

### Method B: Block Explorer On-Chain Call
1. Open the [Monad Testnet Explorer](https://testnet.monadexplorer.com/address/0x534EEE2DC77854015A398B9DD6872eF1498B6764).
2. Go to the **Contract** tab and select **Write Contract**.
3. Connect your Web3 wallet.
4. Locate the `faucet()` function (or `mint(address to, uint256 amount)`).
5. Click **Write** and confirm the transaction.

---

## Testing Scenarios

We encourage users to test all major platform workflows on testnet:

1. **Leveraged Trading:** Open Long and Short positions across multiple tokens, test leverage sliders up to 40x, and review margin requirements.
2. **On-Chain TP/SL:** Configure Take Profit and Stop Loss levels and verify that triggers execute automatically when mark and index prices breach your thresholds.
3. **Resting Limit Orders:** Place Limit, Stop-Market, and Stop-Limit orders and inspect order escrow accounting.
4. **Token Creation:** Launch your own test meme token with instant perps using the launchpad interface.
5. **Counterflow LP Vault:** Deposit MockUSDC to receive `cfUSDC` shares, track accrued yield, and initiate redemption requests.

---

## Differences Between Testnet and Mainnet

| Feature | Testnet (10143) | Mainnet (143) |
|---|---|---|
| **USDC Contract** | `MockUSDC` with public mint | Official Native Circle USDC |
| **Gas Asset** | Testnet MON (no real value) | Real MON |
| **Uniswap v4** | Self-deployed testnet PoolManager | Uniswap canonical Monad mainnet deployment |
| **Market Indexing** | Fast indexer syncing test blocks | Production indexed cluster (`api.priest.trade`) |
| **Keepers** | Automated testnet liquidator bot | Multi-redundant production keeper network |
