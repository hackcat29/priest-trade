# Connecting Your Wallet

Priest.trade is built as an EVM application on the Monad network. You do not need a Solana wallet. You can connect using any standard EVM wallet or through seamless social login with Privy.

---

## Supported Wallets

Priest.trade integrates **Privy**, offering both embedded and external wallet connections:

### 1. Social & Embedded Login (Recommended for Beginners)
- **Log in with:** Google, X (Twitter), Email, or Passkeys.
- **Embedded EVM Wallet:** Privy provisions a secure, self-custodial EVM wallet directly tied to your authenticated login.
- **Key Export:** You can export your private key at any time from your account settings if you wish to import it into Rabby or MetaMask.

### 2. Browser Extensions & Mobile Wallets
- **Rabby Wallet:** Highly recommended for Monad development and trading due to its fast RPC routing and built-in transaction simulation.
- **MetaMask:** The standard Ethereum/EVM wallet.
- **Phantom (EVM):** Supports Monad via its multi-chain EVM provider.
- **Coinbase Wallet:** Supported via injected or WalletConnect connectors.
- **WalletConnect:** Connect with mobile EVM wallets like Rainbow, Trust Wallet, or Zerion by scanning the QR code.

---

## Adding Monad to Your Wallet

If your wallet does not automatically prompt you to add Monad, you can add it manually using the network parameters below:

### Monad Mainnet (Chain ID 143)
| Parameter | Value |
|---|---|
| **Network Name** | Monad |
| **New RPC URL** | `https://rpc.monad.xyz` |
| **Chain ID** | `143` |
| **Currency Symbol** | `MON` |
| **Decimals** | `18` |
| **Block Explorer** | `https://monadvision.com` |

### Monad Testnet (Chain ID 10143)
| Parameter | Value |
|---|---|
| **Network Name** | Monad Testnet |
| **New RPC URL** | `https://testnet-rpc.monad.xyz` |
| **Chain ID** | `10143` |
| **Currency Symbol** | `MON` |
| **Decimals** | `18` |
| **Block Explorer** | `https://testnet.monadexplorer.com` |

---

## Connection Walkthrough

1. Navigate to [priest.trade](https://priest.trade).
2. Click the **Connect Wallet** button located in the top navigation bar.
3. The Privy modal will appear. Select your preferred login method (Social or Wallet).
4. If connecting an external wallet, your extension will ask for permission to connect to `priest.trade`. Approve the connection.
5. If you are on the wrong network (e.g. Ethereum or Arbitrum), click the network indicator in the header to switch to **Monad**.
6. Once connected, your wallet address and your USDC and MON balances will be displayed in the upper-right corner.

---

## Wallet Security & Permissions

When trading on Priest.trade:

- **USDC Token Approval:** To open a position, place an escrowed limit order, or deposit into Counterflow, you will submit an ERC-20 `approve` transaction allowing `PerpesEngine` or `CounterflowVault` to spend your USDC. You can revoke or edit allowances at any time.
- **Never Sign Blind Transactions:** Always verify the contract address you are interacting with. See [Official Deployments](../developers/deployments.md) for the verified engine and vault addresses.
- **Hardware Wallets:** Ledger and Trezor are supported through MetaMask and Rabby.

---

## Troubleshooting

- **Wallet Not Popping Up:** Check if you have multiple wallet extensions enabled that conflict with one another (e.g. MetaMask and Phantom both attempting to handle `window.ethereum`). Select Rabby as your default or disable conflicting extensions.
- **RPC Timeout / Failed Nonce:** In rare cases of network congestion, reset your account's pending nonce in MetaMask (Settings > Advanced > Clear activity tab data) or switch to a backup RPC provider.
- **Mobile Connection Issues:** If using an in-app browser inside MetaMask or Phantom mobile, ensure your app is updated to the latest version supporting Monad chain ID `143`.
