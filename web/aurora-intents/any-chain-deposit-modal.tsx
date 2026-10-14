'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  AURORA_ENABLED,
  fetchIntentChains,
  fetchIntentStatus,
  requestIntentQuote,
  submitIntentDeposit,
  toBaseUnits,
  type IntentChain,
  type IntentProgress,
  type IntentQuote,
} from './aurora-intents';
import { useWalletSession } from '../lib/use-wallet-session';
import { ReferralQr } from './referral-qr';
import { Modal } from './ui/modal';

/** Opens the any-chain deposit sheet from anywhere (deposit sheet, convert sheet). */
export function openAnyChainDeposit() {
  window.dispatchEvent(new Event('perpes:open-any-chain-deposit'));
}

const minutes = (s: number) => (s < 90 ? `~${Math.max(1, Math.round(s))}s` : `~${Math.round(s / 60)} min`);
const STATUS_TEXT: Record<IntentProgress['status'], string> = {
  PENDING_DEPOSIT: 'Waiting for your deposit…',
  KNOWN_DEPOSIT_TX: 'Deposit seen — waiting for confirmations…',
  PROCESSING: 'Deposit received — converting to USDC on Monad…',
  SUCCESS: 'Done',
  INCOMPLETE_DEPOSIT: 'Less than the quoted amount arrived. It will be refunded to your refund address.',
  REFUNDED: 'Refunded to your address on the source chain.',
  FAILED: 'The deposit couldn’t be filled.',
};

/**
 * Deposit from any chain (Bitcoin, Solana, Tron, TON, any EVM chain…) into
 * USDC on Monad via Aurora Intents: send to a one-off address, solvers deliver
 * USDC to the trader's own wallet. Nothing to connect on the source chain.
 */
export function AnyChainDepositModal() {
  const session = useWalletSession();
  const wallet = session.evmSigner?.address ?? null;
  const [open, setOpen] = useState(false);
  const [chains, setChains] = useState<IntentChain[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chainId, setChainId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [refundTo, setRefundTo] = useState('');
  const [preview, setPreview] = useState<IntentQuote | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [deposit, setDeposit] = useState<IntentQuote | null>(null);
  const [progress, setProgress] = useState<IntentProgress | null>(null);
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const refreshProfile = useRef(session.refreshProfile);
  refreshProfile.current = session.refreshProfile;

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('perpes:open-any-chain-deposit', onOpen);
    return () => window.removeEventListener('perpes:open-any-chain-deposit', onOpen);
  }, []);

  useEffect(() => {
    if (!open || chains) return;
    void fetchIntentChains()
      .then((c) => {
        setChains(c);
        setChainId((id) => id || c[0]?.id || '');
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Couldn’t load supported chains'));
  }, [open, chains]);

  const chain = chains?.find((c) => c.id === chainId) ?? null;
  const token = chain?.tokens.find((t) => t.assetId === assetId) ?? chain?.tokens[0] ?? null;
  const amount = token ? toBaseUnits(amountText, token.decimals) : 0n;
  // An EVM source chain refunds to the trader's own address by default.
  const refund = refundTo.trim() || (chain?.evm && wallet ? wallet : '');

  // Price it (no address yet) as the inputs settle. The refund address must
  // suit the source chain, so a non-EVM chain needs it before a quote.
  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!token || !wallet || amount === 0n || deposit || !refund) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      setPreviewing(true);
      void requestIntentQuote(token, amount, wallet, refund, true)
        .then((q) => !cancelled && setPreview(q))
        .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'No route for this amount'))
        .finally(() => !cancelled && setPreviewing(false));
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [token, amount, wallet, deposit, refund]);

  // Track an opened deposit until it settles.
  useEffect(() => {
    if (!deposit) return;
    let cancelled = false;
    const tick = async () => {
      const p = await fetchIntentStatus(deposit).catch(() => null);
      if (cancelled) return;
      if (p) setProgress(p);
      if (p?.status === 'SUCCESS') {
        void refreshProfile.current();
        window.dispatchEvent(new Event('perpes:balances-changed'));
        return;
      }
      if (p && (p.status === 'REFUNDED' || p.status === 'FAILED')) return;
      window.setTimeout(() => void tick(), 5_000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [deposit]);

  const canOpen = useMemo(() => !!preview && !!refund && refund.length >= 20 && !opening, [preview, refund, opening]);

  if (!AURORA_ENABLED) return null;

  const close = () => {
    setOpen(false);
    if (progress?.status === 'SUCCESS' || progress?.status === 'REFUNDED' || progress?.status === 'FAILED') reset();
  };
  const reset = () => {
    setDeposit(null);
    setProgress(null);
    setPreview(null);
    setAmountText('');
    setTxHash('');
  };
  const copy = (label: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2_000);
    });
  };

  const openAddress = async () => {
    if (!token || !wallet || !refund) return;
    setOpening(true);
    setError(null);
    try {
      setDeposit(await requestIntentQuote(token, amount, wallet, refund, false));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t open a deposit address');
    } finally {
      setOpening(false);
    }
  };

  const field = 'h-10 w-full rounded-lg border border-[var(--bdr2)] bg-[var(--bg0)] px-3 text-[13px] text-[var(--txt1)] outline-none';

  return (
    <Modal
      open={open}
      onClose={close}
      title="Deposit from any chain"
      subtitle="Send crypto from Bitcoin, Solana, Tron, TON or any EVM chain. It arrives as USDC on Monad, in your own wallet."
      width={480}
    >
      {!wallet ? (
        <p className="text-[12px] text-[var(--txt3)]">Sign in first: USDC is delivered to your Monad wallet.</p>
      ) : deposit ? (
        <div className="space-y-4">
          <section className="flex gap-4">
            <ReferralQr url={deposit.depositAddress} size={112} alt="Deposit address QR code" />
            <div className="min-w-0 flex-1">
              <div className="fl">
                Send exactly {deposit.amountInFormatted} {deposit.token.symbol} on {chain?.name ?? deposit.token.blockchain} to
              </div>
              <p className="break-all font-mono text-[12px] text-[var(--txt1)]">{deposit.depositAddress}</p>
              <button type="button" className="tb-btn mt-2" onClick={() => copy('address', deposit.depositAddress)}>
                {copied === 'address' ? 'Copied' : 'Copy address'}
              </button>
            </div>
          </section>
          {deposit.depositMemo && (
            <p className="rounded-[var(--radius-sm)] border border-[rgba(231,196,108,0.35)] bg-[rgba(231,196,108,0.06)] px-3 py-2 text-[11px] leading-5 text-[var(--txt2)]">
              Include this memo or the deposit can&apos;t be matched:{' '}
              <button type="button" className="font-mono font-bold text-[var(--txt1)] underline" onClick={() => copy('memo', deposit.depositMemo!)}>
                {deposit.depositMemo}
              </button>
              {copied === 'memo' && ' (copied)'}
            </p>
          )}
          <dl className="space-y-1.5 rounded-[var(--radius-md)] border border-[var(--bdr)] p-3 text-[12px]">
            <div className="flex justify-between"><dt className="text-[var(--txt3)]">You receive</dt><dd className="font-mono font-bold text-[var(--txt1)]">≈ {deposit.amountOutFormatted} USDC</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--txt3)]">At least</dt><dd className="font-mono text-[var(--txt2)]">{deposit.minAmountOutFormatted} USDC</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--txt3)]">Time</dt><dd className="text-[var(--txt2)]">{minutes(deposit.timeEstimateSeconds)} after it confirms</dd></div>
            {deposit.deadline && (
              <div className="flex justify-between"><dt className="text-[var(--txt3)]">Send before</dt><dd className="text-[var(--txt2)]">{new Date(deposit.deadline).toLocaleTimeString()}</dd></div>
            )}
          </dl>
          <div className="rounded-[var(--radius-md)] border border-[var(--bdr)] p-3 text-[12px]">
            <p className={progress?.status === 'SUCCESS' ? 'font-bold text-[var(--g1)]' : progress?.status === 'REFUNDED' || progress?.status === 'FAILED' || progress?.status === 'INCOMPLETE_DEPOSIT' ? 'text-[var(--r1)]' : 'text-[var(--txt2)]'}>
              {progress?.status === 'SUCCESS'
                ? `${progress.amountOutFormatted ?? deposit.amountOutFormatted} USDC arrived on Monad.`
                : STATUS_TEXT[progress?.status ?? 'PENDING_DEPOSIT']}
              {progress?.refundReason ? ` ${progress.refundReason}` : ''}
            </p>
            {progress?.destinationTxUrl && (
              <a href={progress.destinationTxUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[11px] text-[var(--brand)] hover:underline">
                View on Monad ↗
              </a>
            )}
            {(!progress || progress.status === 'PENDING_DEPOSIT') && (
              <div className="mt-2 flex gap-2">
                <input
                  placeholder="Sent it? Paste the transaction hash (optional)"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value.trim())}
                  className={`${field} h-9 flex-1 font-mono text-[11px]`}
                />
                <button
                  type="button"
                  className="tb-btn h-9 px-3"
                  disabled={txHash.length < 16}
                  onClick={() => void submitIntentDeposit(deposit, txHash).then(() => setTxHash(''), () => undefined)}
                >
                  Submit
                </button>
              </div>
            )}
          </div>
          {progress?.status === 'SUCCESS' || progress?.status === 'REFUNDED' || progress?.status === 'FAILED' ? (
            <button type="button" onClick={progress.status === 'SUCCESS' ? close : reset} className="tb-btn green w-full" style={{ height: 40 }}>
              {progress.status === 'SUCCESS' ? 'Start trading' : 'New deposit'}
            </button>
          ) : (
            <p className="text-[10px] leading-4 text-[var(--txt3)]">
              This address is for this deposit only. You can close this window; the deposit still goes through. Anything that
              can&apos;t be filled is refunded to {refund.slice(0, 10)}… on {chain?.name ?? 'the source chain'}.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {loadError && <p className="text-[12px] text-[var(--r1)]">{loadError}</p>}
          {!chains && !loadError && <p className="py-6 text-center text-[12px] text-[var(--txt3)]">Loading supported chains…</p>}
          {chains && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="fl">From chain</span>
                  <select
                    value={chainId}
                    onChange={(e) => {
                      setChainId(e.target.value);
                      setAssetId('');
                      setRefundTo('');
                    }}
                    className={field}
                  >
                    {chains.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="fl">Token</span>
                  <select value={token?.assetId ?? ''} onChange={(e) => setAssetId(e.target.value)} className={field}>
                    {chain?.tokens.map((t) => (
                      <option key={t.assetId} value={t.assetId}>{t.symbol}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="fl">Amount{token ? ` (${token.symbol})` : ''}</span>
                <input
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="0.0"
                  className={`${field} font-mono`}
                />
                {token && Number(amountText) > 0 && (
                  <span className="mt-1 block font-mono text-[11px] text-[var(--txt3)]">≈ ${(Number(amountText) * token.priceUsd).toFixed(2)}</span>
                )}
              </label>
              <label className="block">
                <span className="fl">Refund address on {chain?.name ?? 'the source chain'}</span>
                <input
                  value={refundTo}
                  onChange={(e) => setRefundTo(e.target.value.trim())}
                  placeholder={chain?.evm && wallet ? `${wallet} (this wallet)` : `Your ${chain?.name ?? ''} address`}
                  className={`${field} font-mono text-[11px]`}
                />
              </label>
              <div className="rounded-[var(--radius-md)] border border-[var(--bdr)] p-3 text-[12px]">
                {previewing && <p className="text-[var(--txt3)]">Getting a quote…</p>}
                {!previewing && error && <p className="text-[var(--r1)]">{error}</p>}
                {!previewing && !error && !preview && (
                  <p className="text-[var(--txt3)]">
                    {refund ? 'Enter an amount to see what arrives.' : `Add your ${chain?.name ?? ''} refund address to see a quote.`}
                  </p>
                )}
                {!previewing && preview && (
                  <dl className="space-y-1.5">
                    <div className="flex justify-between"><dt className="text-[var(--txt3)]">You receive</dt><dd className="font-mono font-bold text-[var(--txt1)]">≈ {preview.amountOutFormatted} USDC</dd></div>
                    <div className="flex justify-between"><dt className="text-[var(--txt3)]">At least</dt><dd className="font-mono text-[var(--txt2)]">{preview.minAmountOutFormatted} USDC</dd></div>
                    <div className="flex justify-between"><dt className="text-[var(--txt3)]">Time</dt><dd className="text-[var(--txt2)]">{minutes(preview.timeEstimateSeconds)} after it confirms</dd></div>
                  </dl>
                )}
              </div>
              <button
                type="button"
                disabled={!canOpen}
                onClick={() => void openAddress()}
                className="tb-btn green w-full disabled:cursor-not-allowed disabled:opacity-40"
                style={{ height: 42 }}
              >
                {opening ? 'Opening…' : !refund ? `Add your ${chain?.name ?? ''} refund address` : 'Get deposit address'}
              </button>
              <p className="text-[10px] leading-4 text-[var(--txt3)]">
                Powered by Aurora Intents on NEAR Intents. Solvers fill your deposit and send USDC to {wallet.slice(0, 6)}…{wallet.slice(-4)} on
                Monad. Priest never holds the funds.
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
