import type { Address } from 'viem';
import type { BootstrapPhase, TradeAction, TradeResult } from '../types';

export interface StrategyContext {
  token: Address;
  symbol: string;
  isBootstrap: boolean;
  bootstrapPhase?: BootstrapPhase;
  elapsedBootstrapMs?: number;
  currentMarkPriceE6: bigint;
  vammQuoteReserve: bigint;
  vammBaseReserve: bigint;
}

export interface IStrategy {
  readonly name: string;
  generateTrade(context: StrategyContext): Promise<TradeAction | null>;
  generateLimitOrders(context: StrategyContext): Promise<TradeAction[]>;
  handleTradeResult(result: TradeResult): Promise<void>;
}
