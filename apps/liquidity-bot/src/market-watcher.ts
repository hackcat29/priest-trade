import {
  decodeEventLog,
  type Address,
  type PublicClient,
  type WatchContractEventReturnType,
} from 'viem';
import { perpesEngineAbi } from '@perpes/evm';

import { ENGINE_ADDRESS } from './config';
import type { MarketInfo } from './types';

export type NewLaunchCallback = (market: MarketInfo) => void;

export class MarketWatcher {
  private knownMarkets = new Map<Address, MarketInfo>();
  private unwatchEvent?: WatchContractEventReturnType | undefined;
  private newLaunchCallbacks: NewLaunchCallback[] = [];
  private pollInterval?: NodeJS.Timeout | undefined;

  constructor(private readonly publicClient: PublicClient) {}

  public onNewLaunch(callback: NewLaunchCallback): void {
    this.newLaunchCallbacks.push(callback);
  }

  public async start(): Promise<void> {
    console.log('📡 [MarketWatcher] Starting market discovery and event listener...');

    // 1. Initial market discovery
    await this.scanAllMarkets();

    // 2. Event listener for real-time TokenLaunched events
    try {
      this.unwatchEvent = this.publicClient.watchContractEvent({
        address: ENGINE_ADDRESS,
        abi: perpesEngineAbi,
        eventName: 'TokenLaunched',
        onLogs: (logs: any) => {
          for (const log of logs) {
            this.handleLaunchLog(log);
          }
        },
        onError: (error: Error) => {
          console.warn('⚠️ [MarketWatcher] Event watch error, polling will catch new tokens:', error.message);
        },
      });
      console.log('👂 [MarketWatcher] Actively listening for TokenLaunched events on Monad...');
    } catch (err) {
      console.warn('⚠️ [MarketWatcher] Failed to set up event watch, relying on polling:', (err as Error).message);
    }

    // 3. Fallback polling loop every 12 seconds
    this.pollInterval = setInterval(() => {
      this.scanAllMarkets().catch((err) => {
        console.warn('⚠️ [MarketWatcher] Polling error:', (err as Error).message);
      });
    }, 12_000);
  }

  public stop(): void {
    if (this.unwatchEvent) {
      this.unwatchEvent();
      this.unwatchEvent = undefined;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }

  public getAllMarkets(): MarketInfo[] {
    return Array.from(this.knownMarkets.values());
  }

  public getMarket(token: Address): MarketInfo | undefined {
    return this.knownMarkets.get(token.toLowerCase() as Address);
  }

  private handleLaunchLog(log: any): void {
    try {
      const decoded = decodeEventLog({
        abi: perpesEngineAbi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === 'TokenLaunched') {
        const args = decoded.args as {
          creator: Address;
          token: Address;
          params: { name: string; symbol: string };
          timestamp: bigint;
        };

        const tokenLower = args.token.toLowerCase() as Address;
        if (!this.knownMarkets.has(tokenLower)) {
          const info: MarketInfo = {
            token: args.token,
            creator: args.creator,
            symbol: args.params.symbol || 'TOKEN',
            name: args.params.name || 'Launched Token',
            launchedAt: Number(args.timestamp) * 1000,
            markPriceE6: 1_000_000n, // standard initialPriceE6
            status: 1, // Warmup
            maxLeverageX: 10,
            vammQuoteReserve: 10_000_000_000n,
            vammBaseReserve: 10_000_000_000n,
          };

          this.knownMarkets.set(tokenLower, info);
          console.log(
            `🚀 [MarketWatcher] NEW COIN LAUNCHED ON MONAD! ${info.symbol} (${info.token}) by ${info.creator}`,
          );

          for (const cb of this.newLaunchCallbacks) {
            try {
              cb(info);
            } catch (err) {
              console.error('❌ Callback error on new launch:', err);
            }
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ Error decoding launch log:', (err as Error).message);
    }
  }

  private async scanAllMarkets(): Promise<void> {
    try {
      const count = (await this.publicClient.readContract({
        address: ENGINE_ADDRESS,
        abi: perpesEngineAbi,
        functionName: 'marketCount',
      })) as bigint;

      const numMarkets = Number(count);
      if (numMarkets === 0) return;

      for (let i = 0; i < numMarkets; i++) {
        const tokenAddr = (await this.publicClient.readContract({
          address: ENGINE_ADDRESS,
          abi: perpesEngineAbi,
          functionName: 'allMarkets',
          args: [BigInt(i)],
        })) as Address;

        const tokenLower = tokenAddr.toLowerCase() as Address;
        if (!this.knownMarkets.has(tokenLower)) {
          // Fetch full market struct
          const m = (await this.publicClient.readContract({
            address: ENGINE_ADDRESS,
            abi: perpesEngineAbi,
            functionName: 'getMarket',
            args: [tokenAddr],
          })) as {
            creator: Address;
            status: number;
            maxLeverageX: number;
            markPriceE6: bigint;
            vammQuoteReserve: bigint;
            vammBaseReserve: bigint;
            createdAt: bigint;
          };

          const info: MarketInfo = {
            token: tokenAddr,
            creator: m.creator,
            symbol: `TOKEN-${i + 1}`,
            name: `Token ${i + 1}`,
            launchedAt: Number(m.createdAt) * 1000,
            markPriceE6: m.markPriceE6,
            status: m.status,
            maxLeverageX: m.maxLeverageX,
            vammQuoteReserve: m.vammQuoteReserve,
            vammBaseReserve: m.vammBaseReserve,
          };

          this.knownMarkets.set(tokenLower, info);

          // If this market was created in the last 2 hours, trigger launch callbacks!
          const ageHours = (Date.now() - info.launchedAt) / (1000 * 3600);
          if (ageHours < 2) {
            console.log(
              `✨ [MarketWatcher] Discovered recently launched token: ${info.symbol} (${info.token})`,
            );
            for (const cb of this.newLaunchCallbacks) {
              try {
                cb(info);
              } catch (err) {
                console.error('Callback error:', err);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ Could not scan markets:', (err as Error).message);
    }
  }
}
