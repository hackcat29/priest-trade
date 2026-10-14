'use client';

import { EVM_CHAIN } from './chain-config';
import { evmDeployment } from './evm';

// Aurora Intents (NEAR Intents): deposit from any chain — Bitcoin, Solana,
// Tron, TON, any EVM chain — straight into USDC on Monad in the trader's own
// wallet. The trader sends to a one-off deposit address; solvers fill the
// intent and deliver USDC. No source-chain wallet connection is needed, and
// unfilled deposits are refunded to the trader's address on the source chain.

const API = 'https://intents-api.aurora.dev/api';
/** App key from Intents Studio (studio.aurora.dev). Public by design: it only attributes swaps and fees. */
const APP_KEY = process.env.NEXT_PUBLIC_AURORA_INTENTS_APP_KEY?.trim() ?? '';

/** Mainnet only: intents settle real USDC on Monad. */
export const AURORA_ENABLED = EVM_CHAIN === 'monad' && APP_KEY.length > 0;

export interface IntentToken {
  assetId: string;
  symbol: string;
  decimals: number;
  blockchain: string;
  priceUsd: number;
  contractAddress: string | null;
}

export interface IntentChain {
  id: string;
  name: string;
  evm: boolean;
  tokens: IntentToken[];
}

export interface IntentQuote {
  depositAddress: string;
  depositMemo: string | null;
  amountIn: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  minAmountOutFormatted: string;
  amountOutUsd: number;
  timeEstimateSeconds: number;
  deadline: string | null;
  token: IntentToken;
}

export type IntentStatus =
  | 'PENDING_DEPOSIT'
  | 'KNOWN_DEPOSIT_TX'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'INCOMPLETE_DEPOSIT'
  | 'REFUNDED'
  | 'FAILED';

export interface IntentProgress {
  status: IntentStatus;
  amountOutFormatted: string | null;
  refundReason: string | null;
  destinationTxUrl: string | null;
}

// 1Click chain codes that are EVM chains (a refund there can go to the trader's own EVM address).
const EVM_CODES = new Set(['eth', 'arb', 'base', 'bsc', 'op', 'pol', 'avax', 'gnosis', 'bera', 'scroll', 'xlayer', 'plasma', 'abs', 'adi', 'hood', 'monad']);
const CHAIN_NAMES: Record<string, string> = {
  btc: 'Bitcoin', sol: 'Solana', eth: 'Ethereum', arb: 'Arbitrum', base: 'Base', bsc: 'BNB Chain', op: 'Optimism',
  pol: 'Polygon', avax: 'Avalanche', tron: 'Tron', ton: 'TON', near: 'NEAR', xrp: 'XRP Ledger', doge: 'Dogecoin',
  ltc: 'Litecoin', bch: 'Bitcoin Cash', zec: 'Zcash', sui: 'Sui', aptos: 'Aptos', cardano: 'Cardano', stellar: 'Stellar',
  starknet: 'Starknet', gnosis: 'Gnosis', bera: 'Berachain', scroll: 'Scroll', xlayer: 'X Layer', plasma: 'Plasma',
  hypercore: 'Hyperliquid', dash: 'Dash', aleo: 'Aleo', abs: 'Abstract', hood: 'Robinhood Chain',
};
// Chains most traders come from, first.
const CHAIN_ORDER = ['btc', 'sol', 'eth', 'arb', 'base', 'bsc', 'tron', 'ton', 'op', 'pol', 'avax', 'near', 'xrp', 'sui'];
const TOKEN_ORDER = ['USDC', 'USDT', 'BTC', 'SOL', 'ETH', 'BNB', 'TRX', 'TON'];

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string | string[] };
  if (!res.ok) {
    const msg = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    throw new Error(msg || `Aurora Intents error (${res.status})`);
  }
  return body;
}

let tokenCache: Promise<IntentToken[]> | null = null;

function fetchTokens(): Promise<IntentToken[]> {
  tokenCache ??= call<{ tokens: { assetId: string; symbol: string; decimals: number; blockchain: string; price: number; contractAddress?: string }[] }>(
    `/tokens/${encodeURIComponent(APP_KEY)}`,
  )
    .then((r) =>
      r.tokens.map((t) => ({
        assetId: t.assetId,
        symbol: t.symbol,
        decimals: t.decimals,
        blockchain: t.blockchain,
        priceUsd: t.price,
        contractAddress: t.contractAddress?.toLowerCase() ?? null,
      })),
    )
    .catch((err: unknown) => {
      tokenCache = null;
      throw err;
    });
  return tokenCache;
}

/** Monad USDC — the trading collateral — as an intents asset. */
async function destinationAsset(): Promise<IntentToken> {
  const usdc = evmDeployment()?.usdc.toLowerCase();
  const t = (await fetchTokens()).find((x) => x.blockchain === 'monad' && x.contractAddress === usdc);
  if (!t) throw new Error('USDC on Monad isn’t routable through Aurora Intents right now.');
  return t;
}

/** Every chain (but Monad itself) with the tokens it can deposit from. */
export async function fetchIntentChains(): Promise<IntentChain[]> {
  const byChain = new Map<string, IntentToken[]>();
  for (const t of await fetchTokens()) {
    if (t.blockchain === 'monad') continue;
    const list = byChain.get(t.blockchain) ?? [];
    list.push(t);
    byChain.set(t.blockchain, list);
  }
  const rank = (id: string) => {
    const i = CHAIN_ORDER.indexOf(id);
    return i === -1 ? CHAIN_ORDER.length : i;
  };
  const tokenRank = (s: string) => {
    const i = TOKEN_ORDER.indexOf(s.toUpperCase());
    return i === -1 ? TOKEN_ORDER.length : i;
  };
  return [...byChain.entries()]
    .map(([id, tokens]) => ({
      id,
      name: CHAIN_NAMES[id] ?? id.toUpperCase(),
      evm: EVM_CODES.has(id),
      tokens: tokens.sort((a, b) => tokenRank(a.symbol) - tokenRank(b.symbol) || a.symbol.localeCompare(b.symbol)),
    }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

/** Raw base units of a decimal amount string. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const [whole = '0', frac = ''] = amount.trim().split('.');
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return 0n;
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/**
 * A live quote with its deposit address: `amount` of `token` sent to it on its
 * chain becomes USDC in `recipient` on Monad; if it can't be filled it goes back
 * to `refundTo` on the source chain. `dry` prices it without opening an address.
 */
export async function requestIntentQuote(
  token: IntentToken,
  amount: bigint,
  recipient: string,
  refundTo: string,
  dry: boolean,
): Promise<IntentQuote> {
  const dest = await destinationAsset();
  const r = await call<{
    quote: {
      depositAddress?: string;
      depositMemo?: string;
      amountIn: string;
      amountInFormatted: string;
      amountOutFormatted: string;
      minAmountOut: string;
      amountOutUsd: string;
      timeEstimate: number;
      deadline?: string;
    };
  }>(`/quote/${encodeURIComponent(APP_KEY)}`, {
    method: 'POST',
    body: JSON.stringify({
      dry,
      swapType: 'EXACT_INPUT',
      depositType: 'ORIGIN_CHAIN',
      amount: amount.toString(),
      originAsset: token.assetId,
      destinationAsset: dest.assetId,
      slippageTolerance: 100,
      refundTo,
      refundType: 'ORIGIN_CHAIN',
      recipient,
      recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  });
  const q = r.quote;
  if (!dry && !q.depositAddress) throw new Error('No deposit address was issued for this quote.');
  return {
    depositAddress: q.depositAddress ?? '',
    depositMemo: q.depositMemo || null,
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    amountOutFormatted: q.amountOutFormatted,
    minAmountOutFormatted: (Number(q.minAmountOut) / 10 ** dest.decimals).toFixed(2),
    amountOutUsd: Number(q.amountOutUsd) || 0,
    timeEstimateSeconds: q.timeEstimate,
    deadline: q.deadline ?? null,
    token,
  };
}

/** Where the deposit is: waiting, seen, being filled, done, or refunded. */
export async function fetchIntentStatus(q: Pick<IntentQuote, 'depositAddress' | 'depositMemo'>): Promise<IntentProgress> {
  const params = new URLSearchParams({ depositAddress: q.depositAddress });
  if (q.depositMemo) params.set('depositMemo', q.depositMemo);
  const r = await call<{
    status: IntentStatus;
    swapDetails?: {
      amountOutFormatted?: string;
      refundReason?: string;
      destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
    };
  }>(`/status/${encodeURIComponent(APP_KEY)}?${params.toString()}`);
  const dest = r.swapDetails?.destinationChainTxHashes?.[0];
  return {
    status: r.status,
    amountOutFormatted: r.swapDetails?.amountOutFormatted ?? null,
    refundReason: r.swapDetails?.refundReason ?? null,
    destinationTxUrl: dest?.explorerUrl || null,
  };
}

/** Optional: tell the solver network about the deposit transaction so it's picked up sooner. */
export async function submitIntentDeposit(q: Pick<IntentQuote, 'depositAddress' | 'depositMemo'>, txHash: string): Promise<void> {
  await call(`/deposit/submit/${encodeURIComponent(APP_KEY)}`, {
    method: 'POST',
    body: JSON.stringify({ txHash, depositAddress: q.depositAddress, ...(q.depositMemo ? { memo: q.depositMemo } : {}) }),
  });
}
