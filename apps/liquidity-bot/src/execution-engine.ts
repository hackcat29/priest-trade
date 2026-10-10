import {
  decodeEventLog,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { perpesEngineAbi } from '@perpes/evm';

import { ENGINE_ADDRESS } from './config';
import type { MarketInfo, TradeResult } from './types';

export class ExecutionEngine {
  constructor(private readonly publicClient: PublicClient) {}

  /**
   * Pre-simulates and executes an `openPosition` on PerpesEngine.
   */
  public async executeOpenPosition(
    wallet: WalletClient,
    accountAddress: Address,
    token: Address,
    side: 0 | 1,
    collateralUsdc: bigint,
    notionalUsdc: bigint,
    maxSlippageBps: number,
  ): Promise<TradeResult> {
    const timestamp = Date.now();
    try {
      // 1. Pre-simulate via eth_call
      const { request } = await this.publicClient.simulateContract({
        account: accountAddress,
        address: ENGINE_ADDRESS,
        abi: perpesEngineAbi,
        functionName: 'openPosition',
        args: [token, side, collateralUsdc, notionalUsdc, maxSlippageBps],
      });

      // 2. Broadcast transaction
      const txHash = await (wallet.writeContract as any)(request);

      // 3. Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      // 4. Parse PositionOpened log
      let executionPriceE6: bigint | undefined;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === ENGINE_ADDRESS.toLowerCase()) {
          try {
            const decoded = decodeEventLog({
              abi: perpesEngineAbi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === 'PositionOpened') {
              const args = decoded.args as { executionPriceE6: bigint };
              executionPriceE6 = args.executionPriceE6;
              break;
            }
          } catch {
            // Not a matching event, ignore
          }
        }
      }

      return {
        success: receipt.status === 'success',
        actionType: 'openPosition',
        token,
        trader: accountAddress,
        txHash,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        executionPriceE6,
        timestamp,
      };
    } catch (err) {
      return {
        success: false,
        actionType: 'openPosition',
        token,
        trader: accountAddress,
        error: (err as Error).message,
        timestamp,
      };
    }
  }

  /**
   * Pre-simulates and executes a `closePosition` on PerpesEngine.
   */
  public async executeClosePosition(
    wallet: WalletClient,
    accountAddress: Address,
    token: Address,
    closeNotionalUsdc: bigint,
    maxSlippageBps: number,
  ): Promise<TradeResult & { realizedPnlUsdc?: bigint | undefined; payoutUsdc?: bigint | undefined }> {
    const timestamp = Date.now();
    try {
      // 1. Pre-simulate
      const { request } = await this.publicClient.simulateContract({
        account: accountAddress,
        address: ENGINE_ADDRESS,
        abi: perpesEngineAbi,
        functionName: 'closePosition',
        args: [token, closeNotionalUsdc, maxSlippageBps],
      });

      // 2. Broadcast
      const txHash = await (wallet.writeContract as any)(request);

      // 3. Receipt
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      // 4. Parse PositionClosed log
      let executionPriceE6: bigint | undefined;
      let realizedPnlUsdc: bigint | undefined;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === ENGINE_ADDRESS.toLowerCase()) {
          try {
            const decoded = decodeEventLog({
              abi: perpesEngineAbi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === 'PositionClosed') {
              const args = decoded.args as {
                executionPriceE6: bigint;
                realizedPnlUsdc: bigint;
              };
              executionPriceE6 = args.executionPriceE6;
              realizedPnlUsdc = args.realizedPnlUsdc;
              break;
            }
          } catch {
            // Ignore
          }
        }
      }

      return {
        success: receipt.status === 'success',
        actionType: 'closePosition',
        token,
        trader: accountAddress,
        txHash,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        executionPriceE6,
        realizedPnlUsdc,
        timestamp,
      };
    } catch (err) {
      return {
        success: false,
        actionType: 'closePosition',
        token,
        trader: accountAddress,
        error: (err as Error).message,
        timestamp,
      };
    }
  }

  /**
   * Places a limit order on PerpesEngine.
   */
  public async executePlaceLimitOrder(
    wallet: WalletClient,
    accountAddress: Address,
    token: Address,
    side: 0 | 1,
    collateralUsdc: bigint,
    leverage: number,
    limitPriceE6: bigint,
    postOnly = true,
    expiresAt = 0n,
  ): Promise<TradeResult & { orderId?: bigint }> {
    const timestamp = Date.now();
    try {
      const { request, result } = await this.publicClient.simulateContract({
        account: accountAddress,
        address: ENGINE_ADDRESS,
        abi: perpesEngineAbi,
        functionName: 'placeLimitOrder',
        args: [
          token,
          side,
          0, // OrderType.Limit
          collateralUsdc,
          leverage,
          limitPriceE6,
          0n, // stopPriceE6
          postOnly,
          expiresAt,
        ],
      });

      const txHash = await (wallet.writeContract as any)(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      return {
        success: receipt.status === 'success',
        actionType: 'placeLimitOrder',
        token,
        trader: accountAddress,
        txHash,
        orderId: result as bigint,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        timestamp,
      };
    } catch (err) {
      return {
        success: false,
        actionType: 'placeLimitOrder',
        token,
        trader: accountAddress,
        error: (err as Error).message,
        timestamp,
      };
    }
  }

  /**
   * Cancels a limit order on PerpesEngine.
   */
  public async executeCancelLimitOrder(
    wallet: WalletClient,
    accountAddress: Address,
    orderId: bigint,
  ): Promise<TradeResult> {
    const timestamp = Date.now();
    try {
      const { request } = await this.publicClient.simulateContract({
        account: accountAddress,
        address: ENGINE_ADDRESS,
        abi: perpesEngineAbi,
        functionName: 'cancelLimitOrder',
        args: [orderId],
      });

      const txHash = await (wallet.writeContract as any)(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      return {
        success: receipt.status === 'success',
        actionType: 'cancelLimitOrder',
        token: '0x0000000000000000000000000000000000000000',
        trader: accountAddress,
        txHash,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        timestamp,
      };
    } catch (err) {
      return {
        success: false,
        actionType: 'cancelLimitOrder',
        token: '0x0000000000000000000000000000000000000000',
        trader: accountAddress,
        error: (err as Error).message,
        timestamp,
      };
    }
  }

  /**
   * Fetches the live accrued market state for a token.
   */
  public async fetchMarketState(token: Address): Promise<MarketInfo | null> {
    try {
      const m = (await this.publicClient.readContract({
        address: ENGINE_ADDRESS,
        abi: perpesEngineAbi,
        functionName: 'getMarket',
        args: [token],
      })) as {
        creator: Address;
        status: number;
        maxLeverageX: number;
        markPriceE6: bigint;
        vammQuoteReserve: bigint;
        vammBaseReserve: bigint;
        createdAt: bigint;
      };

      if (!m || m.status === 0) return null;

      return {
        token,
        creator: m.creator,
        symbol: 'TOKEN',
        name: 'Token',
        launchedAt: Number(m.createdAt) * 1000,
        markPriceE6: m.markPriceE6,
        status: m.status,
        maxLeverageX: m.maxLeverageX,
        vammQuoteReserve: m.vammQuoteReserve,
        vammBaseReserve: m.vammBaseReserve,
      };
    } catch {
      return null;
    }
  }

  /**
   * Reads a wallet's position on `token`.
   */
  public async fetchPosition(
    token: Address,
    trader: Address,
  ): Promise<{ sizeUsdc: bigint; side: number; collateralUsdc: bigint } | null> {
    try {
      const p = (await this.publicClient.readContract({
        address: ENGINE_ADDRESS,
        abi: perpesEngineAbi,
        functionName: 'getPosition',
        args: [token, trader],
      })) as { sizeUsdc: bigint; side: number; collateralUsdc: bigint };

      return {
        sizeUsdc: p.sizeUsdc,
        side: p.side,
        collateralUsdc: p.collateralUsdc,
      };
    } catch {
      return null;
    }
  }
}
