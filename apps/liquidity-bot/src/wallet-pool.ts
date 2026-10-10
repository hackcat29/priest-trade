import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  http,
  keccak256,
  maxUint256,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mockUsdcAbi, perpesEngineAbi } from '@perpes/evm';
import { erc20Abi } from 'viem';

import {
  AUTO_TOP_UP_GAS,
  AUTO_TOP_UP_USDC,
  BOT_MODE,
  CHAIN_DEF,
  ENGINE_ADDRESS,
  IS_MOCK_USDC,
  MASTER_PRIVATE_KEY,
  MIN_SUB_WALLET_MON,
  MIN_SUB_WALLET_USDC,
  NUM_SUB_WALLETS,
  RPC_URL,
  TOP_UP_MON_AMOUNT,
  TOP_UP_USDC_AMOUNT,
  USDC_ADDRESS,
} from './config';
import { formatMon, formatUsdc } from './math-utils';
import type { SubWalletInfo } from './types';

export class WalletPool {
  public readonly publicClient: PublicClient;
  public readonly masterAccount = privateKeyToAccount(MASTER_PRIVATE_KEY);
  public readonly masterWallet: WalletClient;

  public readonly subWallets: Array<{
    info: SubWalletInfo;
    wallet: WalletClient;
    account: ReturnType<typeof privateKeyToAccount>;
  }> = [];

  // Track positions per (walletAddress, token) -> { side: number, sizeUsdc: bigint }
  private activePositions = new Map<
    string,
    { side: number; sizeUsdc: bigint }
  >();

  constructor() {
    const transport = http(RPC_URL, { retryCount: 3, timeout: 20_000 });
    this.publicClient = createPublicClient({ chain: CHAIN_DEF, transport });
    this.masterWallet = createWalletClient({
      chain: CHAIN_DEF,
      transport,
      account: this.masterAccount,
    });

    this.initSubWallets();
  }

  private initSubWallets(): void {
    const transport = http(RPC_URL, { retryCount: 3, timeout: 20_000 });

    for (let i = 0; i < NUM_SUB_WALLETS; i++) {
      // Deterministically derive sub-wallet private keys from master key
      const derivedKey = keccak256(
        encodePacked(
          ['bytes32', 'string', 'uint256'],
          [MASTER_PRIVATE_KEY, 'perpes:liquidity:subwallet', BigInt(i)],
        ),
      ) as Hex;

      const account = privateKeyToAccount(derivedKey);
      const wallet = createWalletClient({
        chain: CHAIN_DEF,
        transport,
        account,
      });

      this.subWallets.push({
        info: {
          index: i,
          address: account.address,
          privateKey: derivedKey,
          monBalance: 0n,
          usdcBalance: 0n,
          hasUsdcAllowance: false,
          nonce: 0,
          activePositionsCount: 0,
        },
        wallet,
        account,
      });
    }
  }

  public async initialize(): Promise<void> {
    console.log(
      `🔑 [WalletPool] Initializing pool with ${this.subWallets.length} sub-wallets...`,
    );
    console.log(
      `👑 [WalletPool] Master wallet: ${this.masterAccount.address}`,
    );

    await this.refreshAllBalances();
    await this.ensureAllowances();

    if (AUTO_TOP_UP_GAS || AUTO_TOP_UP_USDC) {
      await this.rebalancePool();
    }
  }

  public async refreshAllBalances(): Promise<void> {
    const masterMon = await this.publicClient.getBalance({
      address: this.masterAccount.address,
    });
    const masterUsdc = (await this.publicClient.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [this.masterAccount.address],
    })) as bigint;

    console.log(
      `👑 Master balance: ${formatMon(masterMon)} | ${formatUsdc(masterUsdc)} USDC`,
    );

    for (const item of this.subWallets) {
      const [mon, usdc] = await Promise.all([
        this.publicClient.getBalance({ address: item.info.address }),
        this.publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [item.info.address],
        }) as Promise<bigint>,
      ]);

      item.info.monBalance = mon;
      item.info.usdcBalance = usdc;
    }
  }

  public async ensureAllowances(): Promise<void> {
    for (const item of this.subWallets) {
      try {
        const allowance = (await this.publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [item.info.address, ENGINE_ADDRESS],
        })) as bigint;

        if (allowance < 1_000_000_000n) {
          // Less than 1,000 USDC allowance
          console.log(
            `📝 Approving USDC for sub-wallet #${item.info.index} (${item.info.address})...`,
          );
          const hash = await (item.wallet.writeContract as any)({
            address: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: 'approve',
            args: [ENGINE_ADDRESS, maxUint256],
          });
          await this.publicClient.waitForTransactionReceipt({ hash });
          item.info.hasUsdcAllowance = true;
          console.log(`✅ Approved USDC for sub-wallet #${item.info.index}`);
        } else {
          item.info.hasUsdcAllowance = true;
        }
      } catch (err) {
        console.warn(
          `⚠️ Could not approve USDC for wallet #${item.info.index}:`,
          (err as Error).message,
        );
      }
    }
  }

  public async rebalancePool(): Promise<void> {
    for (const item of this.subWallets) {
      // 1. MON Gas Top-up
      if (AUTO_TOP_UP_GAS && item.info.monBalance < MIN_SUB_WALLET_MON) {
        console.log(
          `⛽ Funding sub-wallet #${item.info.index} with MON (${formatMon(TOP_UP_MON_AMOUNT)})...`,
        );
        try {
          const hash = await (this.masterWallet.sendTransaction as any)({
            to: item.info.address,
            value: TOP_UP_MON_AMOUNT,
          });
          await this.publicClient.waitForTransactionReceipt({ hash });
          item.info.monBalance += TOP_UP_MON_AMOUNT;
          console.log(`✅ Sent gas to wallet #${item.info.index}`);
        } catch (err) {
          console.error(
            `❌ Failed to top up gas for wallet #${item.info.index}:`,
            (err as Error).message,
          );
        }
      }

      // 2. USDC Top-up
      if (AUTO_TOP_UP_USDC && item.info.usdcBalance < MIN_SUB_WALLET_USDC) {
        if (BOT_MODE === 'testnet' && IS_MOCK_USDC) {
          // Try testnet faucet first
          try {
            console.log(
              `🚰 Drawing testnet faucet for sub-wallet #${item.info.index}...`,
            );
            const hash = await (item.wallet.writeContract as any)({
              address: USDC_ADDRESS,
              abi: mockUsdcAbi,
              functionName: 'faucet',
            });
            await this.publicClient.waitForTransactionReceipt({ hash });
            item.info.usdcBalance += 10_000_000_000n; // 10k USDC
            console.log(
              `✅ Faucet claimed 10,000 USDC for wallet #${item.info.index}`,
            );
            continue;
          } catch {
            // Faucet might be on cooldown, fall back to master transfer
          }
        }

        // Transfer from master wallet
        try {
          console.log(
            `💵 Transferring ${formatUsdc(TOP_UP_USDC_AMOUNT)} from master to wallet #${item.info.index}...`,
          );
          const hash = await (this.masterWallet.writeContract as any)({
            address: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [item.info.address, TOP_UP_USDC_AMOUNT],
          });
          await this.publicClient.waitForTransactionReceipt({ hash });
          item.info.usdcBalance += TOP_UP_USDC_AMOUNT;
          console.log(`✅ Transferred USDC to wallet #${item.info.index}`);
        } catch (err) {
          console.error(
            `❌ Failed to transfer USDC to wallet #${item.info.index}:`,
            (err as Error).message,
          );
        }
      }
    }
  }

  /**
   * Selects an available sub-wallet to execute a trade on `token`.
   * Enforces PerpesEngine constraint: a wallet cannot have both Long and Short open.
   */
  public getAvailableTrader(
    token: Address,
    preferredSide: 0 | 1,
    minUsdcNeeded: bigint,
  ): { index: number; address: Address; wallet: WalletClient } | null {
    const candidates = this.subWallets.filter(
      (w) => w.info.usdcBalance >= minUsdcNeeded && w.info.monBalance > 1000000000000000n,
    );

    if (candidates.length === 0) return null;

    // Filter wallets that don't have an opposing position
    const compatible = candidates.filter((w) => {
      const pos = this.activePositions.get(`${w.info.address}:${token}`);
      if (!pos || pos.sizeUsdc === 0n) return true;
      return pos.side === preferredSide;
    });

    if (compatible.length === 0) return null;

    // Pick a random compatible candidate for organic distribution
    const choice = compatible[Math.floor(Math.random() * compatible.length)]!;
    return {
      index: choice.info.index,
      address: choice.info.address,
      wallet: choice.wallet,
    };
  }

  /**
   * Finds a wallet that has an open position on `token` that can be closed.
   */
  public getWalletWithPosition(
    token: Address,
  ): { index: number; address: Address; wallet: WalletClient; position: { side: number; sizeUsdc: bigint } } | null {
    for (const item of this.subWallets) {
      const pos = this.activePositions.get(`${item.info.address}:${token}`);
      if (pos && pos.sizeUsdc > 0n) {
        return {
          index: item.info.index,
          address: item.info.address,
          wallet: item.wallet,
          position: pos,
        };
      }
    }
    return null;
  }

  public recordPositionOpen(
    walletAddress: Address,
    token: Address,
    side: 0 | 1,
    sizeUsdc: bigint,
    collateralUsdc: bigint,
  ): void {
    const key = `${walletAddress}:${token}`;
    const existing = this.activePositions.get(key);
    if (existing) {
      existing.sizeUsdc += sizeUsdc;
    } else {
      this.activePositions.set(key, { side, sizeUsdc });
    }

    const sub = this.subWallets.find((s) => s.info.address === walletAddress);
    if (sub && sub.info.usdcBalance >= collateralUsdc) {
      sub.info.usdcBalance -= collateralUsdc;
      sub.info.activePositionsCount += 1;
    }
  }

  public recordPositionClose(
    walletAddress: Address,
    token: Address,
    closedNotionalUsdc: bigint,
    payoutUsdc: bigint,
  ): void {
    const key = `${walletAddress}:${token}`;
    const existing = this.activePositions.get(key);
    if (existing) {
      if (closedNotionalUsdc >= existing.sizeUsdc) {
        this.activePositions.delete(key);
      } else {
        existing.sizeUsdc -= closedNotionalUsdc;
      }
    }

    const sub = this.subWallets.find((s) => s.info.address === walletAddress);
    if (sub) {
      sub.info.usdcBalance += payoutUsdc;
      if (sub.info.activePositionsCount > 0) {
        sub.info.activePositionsCount -= 1;
      }
    }
  }

  public getWalletByIndex(index: number) {
    return this.subWallets[index];
  }

  public getAllWallets() {
    return this.subWallets.map((s) => s.info);
  }
}
