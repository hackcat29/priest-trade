# PerpesEngine security review (internal)

**Scope:** `src/PerpesEngine.sol`, `src/PerpesMath.sol`, `src/PerpesToken.sol`, `src/MockUSDC.sol`, `script/Deploy.s.sol` (graduation: see the second review below)
**Date:** 2026-10-02
**Method:** manual line-by-line review of every fund flow, Slither 0.11.6 static analysis, Foundry unit, scenario and fuzz tests (36 tests; a 5,000-run fuzz that random-walks opens, partial closes, closes and liquidations and asserts the engine's USDC balance always equals the sum of per-market `vaultBalanceUsdc + orderEscrowUsdc`).
**Not a substitute for an external audit.** This is an internal review by the team that wrote the code. Before Monad mainnet holds meaningful TVL, get an independent audit.

## Summary

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| H-1 | High | Funding owed beyond collateral was forgiven at settlement | Fixed |
| M-1 | Medium | `removeCollateral` could reach insurance and unclaimed fees | Fixed |
| M-2 | Medium | A USDC-blacklisted owner could block their own liquidation / TP-SL | Fixed |
| M-3 | Medium | No emergency stop for new risk | Fixed |
| M-4 | Medium | Upgrade and config power sit with one key | Operational — see recommendations |
| L-1 | Low | A TP/SL left on the wrong side of entry after adding to a position fires at a loss | Fixed |
| L-2 | Low | Shorts cannot buy back while longs hold almost all virtual base | Accepted (inherent to the vAMM) |
| L-3 | Low | Underwater positions pay the liquidator nothing | Accepted (protocol-run keeper) |
| L-4 | Low | Free launches allow market spam | Accepted for launch; monitor |
| I-1 | Info | Slither findings | Reviewed |

Two Solana limit-order bugs were also fixed during the port (partial fills now consume all escrow; an IOC remainder is refunded instead of stranded) — both pre-date this review.

## Findings

### H-1 — Funding owed beyond collateral was forgiven
`_settle` (ported from `settle_position_state`) zeroed collateral when the funding debit exceeded it, then advanced the position's funding marker to "fully paid". The unpaid remainder disappeared. A leveraged position in profit could therefore keep its curve gains while never paying funding beyond its collateral, while the counterparties had already been credited — unbacked credits paid out of other traders' money. It also made `positionHealth` (which includes pending funding) disagree with `liquidate`, so the keeper could never act on it.

**Fix:** the unpaid remainder is carried by leaving the funding marker behind (rounded up so it never shrinks). It keeps counting against margin, and `_fundingDebt` deducts it — pro rata for partial closes — from close, TP/SL and liquidation proceeds. No storage-layout change. Tests: `test_fundingOwedBeyondCollateralIsCarriedNotForgiven`, `test_removeCollateralCannotReachReservedFunds`.

The same bug existed in the Solana program (`settle_position_state`). Fixed there the same way (`apply_funding_settlement` + `carried_funding_debt`, deducted in every close path and in liquidation) and deployed to devnet on 2026-10-02.

### M-1 — `removeCollateral` not capped by vault headroom
Payout paths cap transfers at `vault − (insurance + creator fees + protocol fees)`; `removeCollateral` did not. Collateral can be credited by funding from counterparties who could not pay it, so a withdrawal could spend fees owed to the creator/protocol or the insurance tranche. **Fix:** revert with `InsufficientVaultHeadroom` above headroom. Also fixed in the Solana program's `remove_collateral` (deployed to devnet 2026-10-02).

### M-2 — Blacklisted recipient blocks keeper actions
Circle's USDC can blacklist addresses. `liquidate` and `executeTrigger` transferred the owner's share with `safeTransfer`, so a blacklisted owner's position could not be liquidated or stopped out. **Fix:** `_payOrDefer` — after state is stored, the owner transfer is attempted; if the token refuses, the amount is returned to the vault and credited as the owner's claimable `unsettledProfitUsdc`. Tests: `test/Blacklist.t.sol`.

### M-3 — No emergency stop
Only per-market `delistMarket` and `setLaunchPaused` existed. **Fix:** `setTradingPaused` (owner) blocks opens, limit placement and limit fills; closes, collateral, TP/SL, liquidations and claims keep working, so users can always exit. Stored in a new slot appended after the v1 layout.

### M-4 — Single-key admin (operational)
The owner can upgrade the implementation (UUPS), change config for future markets, delist markets and pause. Whoever holds that key controls every market's funds. **Recommendation:** on mainnet the owner must be a multisig (Safe) — ideally behind a timelock for upgrades. Ownership is two-step (`Ownable2Step`), so it can be handed to a Safe after deployment with `transferOwnership` + `acceptOwnership`.

### L-1 — Stale TP/SL after averaging
`setTriggers` validates TP/SL against the entry price, but adding to a position moves the entry. A TP that is now below a long's entry fires immediately and closes at a loss. **Fix:** `_increase` drops a trigger that ends up on the wrong side of the new entry.

### L-2 — Short buy-back limit
`closeShort` requires `baseOut < baseReserve`. If longs hold almost all of the curve's virtual base, shorts (and their liquidation) revert with `PriceImpactTooHigh` until longs reduce. No value can be extracted by causing this, but bad debt can accrue meanwhile. Inherent to a constant-product vAMM; same on Solana.

### L-3 — Zero liquidator reward when underwater
Rewards come out of remaining equity, so an underwater position pays the liquidator nothing. Fine while the keeper is protocol-run (it is); third-party liquidators would need a separate incentive.

### L-4 — Free launches
With `launchFeeWei = 0` anyone can create markets for gas only. Each market adds load to the indexer's periodic sync. Watch for spam; `setConfig` can add a fee and `delistMarket` can hide markets.

### I-1 — Slither
Remaining detections are expected: strict equality and timestamp comparisons (by design), divide-before-multiply in `initialReserves` (the rounded base defines `k`), and a benign reentrancy note on `_payOrDefer`'s fallback writes (callers are `nonReentrant`; USDC has no transfer hooks).

## Properties checked
- **Per-market isolation:** every inflow/outflow updates that market's `vaultBalanceUsdc` / `orderEscrowUsdc`; no path pays one market's traders from another's.
- **Solvency invariant:** engine USDC balance = Σ(vault + escrow) after every action (fuzzed).
- **Reserved funds:** payouts and withdrawals are capped by headroom, so `vault ≥ insurance + unclaimed fees` holds and fee claims always succeed.
- **Manipulation:** accrual runs before every price-moving fill, so a single-block pump/dump cannot move the index; liquidation and stop-losses need both mark and index through the level.
- **Launch:** token supply is minted to the engine only; CREATE2 salt is bound to the caller (no address squatting); launch fee forwarded, excess refunded.
- **Upgradeability:** implementation initializers disabled; `_authorizeUpgrade` owner-only; v2 storage layout = v1 + `tradingPaused` appended (verified with `forge inspect storageLayout`); the testnet proxy was upgraded in place with state intact.
- **Arithmetic:** checked math throughout; bounded casts (timestamps, bps, premium).

---

# Graduation review (internal) — 2026-10-04

**Scope:** graduation and the secondary engine added to `src/PerpesEngine.sol`, plus `src/PerpesSecondaryMath.sol`, `src/PerpesUniswap.sol`, `script/Graduation.s.sol`.
**Method:** manual review of every new fund flow and price path; Slither 0.11.6 (medium/high); Foundry tests — 24 graduation scenarios against real Uniswap v4 contracts built from their own repos, 14 math tests (the Solana `math/secondary.rs` vectors plus a split-order fuzz), an upgrade test that runs the exact pre-graduation engine source, builds state and upgrades in place, and a fork test against Uniswap's Monad mainnet deployment (`MONAD_MAINNET_FORK_RPC=… forge test --match-contract MonadForkTest`). The solvency invariant (engine USDC = Σ vault + escrow) is asserted after graduation, trading, liquidation and full unwinds.
**Same caveat as above:** this is not an external audit, and graduation moves real USDC into a pool. Have it reviewed before graduating mainnet markets.

## How graduation works
1. **Approve (owner).** `approveGraduation(token, adminOverride)` — criteria are measured on-chain (age, volume, unique traders, peak OI, vault stress); `adminOverride` skips them. The current `SecondaryConfig` is snapshotted onto the market.
2. **Execute (operator).** `graduate(token, seedUsdc, minPriceE6, maxPriceE6)` seeds a token/USDC Uniswap v4 pool (no hooks) at the market's index price with full-range liquidity; the PositionManager mints the position NFT straight to `0x…dEaD`, so the liquidity can never be withdrawn. The USDC comes from the market's unclaimed protocol fees first, then the caller. The rest of the token supply is sent to `0x…dEaD`; the pool holds the only tradeable tokens.
3. **Secondary engine.** The market prices off an oracle — the operator-pushed pool TWAP, blended in from the seed price over 6 h — plus a skew premium (path-averaged, so splitting orders saves nothing) and a 10 bps half-spread. Funding switches to the secondary parameters; opening leverage starts at 15× and steps up 5× a day to 40×; OI is capped at the pool's USDC depth, one wallet at 25% of that; profit payouts are throttled by vault utilization (never principal) and the rest deferred.

## Findings

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| G-1 | Medium | The oracle is pushed by a trusted operator | By design (protocol-run, as on Solana); bounded |
| G-2 | Low | Anyone can pre-initialize the v4 pool at a bad price | Mitigated |
| G-3 | Low | Graduation can be blocked on one pool key by parking large USDC bids | Accepted; workaround |
| G-4 | Low | A stalled operator halts graduated markets, exits included | By design (parity with Solana) |
| G-5 | Low | Maintenance margin stays at the primary level after graduation | Accepted (parity); monitor thin pools |
| G-6 | Info | Graduated markets can't be delisted | By design |
| G-7 | Info | Pre-graduation limit orders may exceed the secondary leverage cap | Accepted |
| G-8 | Info | "Unique traders" is sybil-able | Accepted (approval is manual) |
| G-9 | Info | Slither | Reviewed |
| G-10 | Info | Oracle freshness costs gas per push | Operational — tune per market |

### G-1 — Operator-pushed oracle
`updateSecondaryOracle` takes the TWAP from an operator (the keeper samples the pool each tick and averages 5 minutes). v4 has no built-in oracle; an on-chain TWAP would need a hook, and a hooked pool routes worse. Bounds on a bad or compromised operator: every push must sit within `maxOracleSpotDeviationBps` (25%) of the **live** pool price read on-chain; a > 25% move inside the velocity window trips the breaker (opening leverage 5×, OI cap ÷4); liquidity pushes are capped at the pool's on-chain USDC depth. A pool push can only be spoofed by moving the real pool, which costs the attacker against locked full-range liquidity. **Recommendation:** run the operator on its own key, alert on `OracleDeviatesFromSpot` and on oracle age, and keep `maxOracleSpotDeviationBps` tight.

### G-2 — Pre-initialized pool
v4 pool initialization is permissionless, so the pool can exist before graduation at any price. If it's off by more than 50 bps, `graduate` swaps it into line through its own unlock callback before minting. Before graduation the engine holds the entire token supply, so nobody else can provide token-side liquidity: raising the price meets no resistance (1 wei of input), and lowering it sells engine tokens into USDC bids above the target — the attacker overpays and the USDC is credited to the market's insurance. Tests: `test_preInitializedLowPriceIsCorrectedForFree`, `test_preInitializedHighPriceWithBidsCostsTheAttacker`.

### G-3 — Bid wall griefing
Bids larger than half the supply's value can stop the correction short of the target; `graduate` then reverts with `PoolPriceMismatch` (nothing moves). The owner can change `poolFee`/`tickSpacing` (a different pool key) and revoke/re-approve.

### G-4 — Stalled operator
Opens, closes, TP/SL, liquidations and limit fills on a graduated market all require an oracle push in the last 60 s (new risk also a liquidity push in the last 120 s), so a frozen price can never be traded against — but a dead keeper also blocks exits. Same as the Solana program. Run the keeper with alerting.

### G-5 — Maintenance margin
The secondary schedule limits **opening** leverage (15× → 40×); the liquidation threshold stays at the market's steady-state level (1.25% at 40×), as on Solana. On a thin pool a gap move can run past it into insurance/bad debt (handled by the existing shortfall path). Consider a higher maintenance margin for graduated markets if pools are small.

### G-6 — No delisting after graduation
A graduated market's pricing depends on its status, so `delistMarket` reverts for it. To stop new risk use `setTradingPaused`; to halt everything, stop the oracle.

### G-7 — Old limit orders
Orders placed before graduation (up to the primary 40×) can't fill above the secondary cap; traders can cancel, and the keeper only spends simulations retrying.

### G-8 — Sybil-able trader count
`uniqueTraders` counts wallets, as Solana does. Approval stays a manual protocol decision.

### G-9 — Slither
New detections are the expected kinds: strict equality on enums/timestamps, multiply-after-divide where integer steps are intended (leverage days, premium saturation), an ignored tuple member from `getSlot0`, and "reentrancy" in `_seedPool` — the "stale" `usdcStart` is a deliberate snapshot to measure what the price correction moved, the only external party is the PoolManager (no hooks), and `graduate` is `nonReentrant`.

### G-10 — Freshness vs. operating cost
Every push costs gas (Monad charges the full gas limit; ~140k gas per push, ~175k with the depth update, ~0.02 MON at 100 gwei). The keeper pushes only when needed — at 60% of the market's staleness window, or sooner when the TWAP moves 25 bps — so cost scales with `maxPriceStalenessSeconds`: ~45 MON/day per graduated market at the Solana-parity 60 s, roughly a fifth of that at 300 s. A longer window lets trades execute against an older TWAP (the oracle is already a 5-minute average, and the deviation trigger keeps it within 25 bps of the keeper's TWAP). The owner can retune a graduated market with `setMarketSecondaryConfig` (risk parameters only; the pool can't change, and a retune doesn't count as fresh data).

## Properties checked
- **Solvency through graduation:** seed USDC leaves the vault only via the protocol-fee pool or the caller; anything the pool doesn't take (rounding) or that a price correction pays in is credited to the market's insurance. Asserted after every graduation test.
- **LP is locked:** `ownerOf(lpTokenId) == 0x…dEaD` and the engine holds no tokens afterwards (`test_graduateSeedsPoolLocksLpAndBurnsSupply`, and on the Monad mainnet fork).
- **Pricing parity with Solana:** the secondary math reproduces the Solana test vectors; splitting an order costs the same as one order (fuzzed).
- **Upgrade safety:** storage layout = previous layout + appended graduation state (`forge inspect storageLayout`); `initializeGraduation` is a one-shot `reinitializer(2)`; `test_upgradeKeepsStateAndLegacyMarketGraduates` upgrades the exact deployed source with live markets, positions and orders.
- **Access:** approval, global and per-market config owner-only; graduation and oracle/depth pushes operator-or-owner; `unlockCallback` only from the PoolManager during the engine's own correction swap.

---

# Listing, on-chain oracle and Counterflow (internal) — 2026-10-05

**Scope:** `listMarket`, the on-chain oracle (`_readSource`, `_sampleOracle`, worst-of fills), Counterflow integration in `src/PerpesEngine.sol`; `src/PerpesOracle.sol`; `src/CounterflowVault.sol`; `script/Graduation.s.sol:UpgradeEngine`.
**Method:** manual review; 93 Foundry tests (graduation rewritten for the on-chain oracle: flash-move resistance, worst-of fills on idle markets, EMA blend, breaker, JIT-depth smoothing; 7 listing tests incl. a 9-decimal token, v3 TWAP with a history fallback, MON-quoted pricing and every rejection; 8 Counterflow tests; upgrade tests from the exact v1 *and* v2 sources); fork tests on Monad mainnet listing MON on Uniswap's real WMON/USDC v3 pool. Storage layout verified with `forge inspect` (v2 slots 0–36 unchanged; new config at 37/41/44; struct fields appended only).
**Same caveat:** internal review only.

## Design
- **Oracle (replaces the keeper push).** v3 sources use the pool's own TWAP (`observe`, 5 min). v4 sources (graduation pools, v4 listings) use an engine EMA: one sample per second, the gap counted capped at 30 s, the sample clamped to ±50% of the EMA (one manipulated sample moves it ≤ 30/330 × 50% ≈ 4.5%; a one-second hold ≈ 0.17%). If a v3 pool can't serve the window, that read falls back to the EMA instead of reverting. MON-quoted pools convert through the WMON/USDC v3 TWAP.
- **Worst-of fills.** Takers fill at the worse of oracle and live pool price (buy: max, sell: min) plus skew premium and spread, so neither a lagging oracle nor a moved pool gives a better fill. Collateral withdrawals value the position at the least favourable of mark, index and pool. Liquidation eligibility and fills stay on the oracle (manipulation-resistant).
- **Breaker** trips when the pool is ≥ 25% from its own average (not from the blended oracle, which sits near the seed price during a graduation transition).
- **Depth** for caps is the pool's in-range quote-side liquidity; increases are smoothed like the EMA (JIT liquidity can't inflate caps within a transaction), decreases count at once; for v3 it's also capped at the quote balance the pool actually holds (concentrated "virtual" depth overstated the WMON/USDC pool ~8x).
- **Listing** is permissionless: v3 pool from the configured factory or hookless v4 pool, quote USDC or WMON, ≥ $25k depth, a v3 pool must already serve the TWAP window, 10-minute warmup before new risk, 10× cap, optional fee. The lister earns the creator share. Listed markets are unbacked unless an operator backs them.
- **Counterflow** (ERC-4626 `cfUSDC`, UUPS). Backed markets: no profit throttle; when the market vault can't pay (close, liquidation payout, claim, or a shortfall beyond collateral) the engine draws the difference, crediting only USDC that arrives; draw failures are caught (never block exits/liquidations). `syncCounterflow` (permissionless) sends the fee share (30% of fees, from the protocol cut) and the surplus (vault − reserved − collateral − 10% buffer − deferred − positive open PnL), repaying draws first. Vault NAV = cash − unlocking income; income unlocks over 1 day; covers are losses at once (absorbed by unlocking income first); withdrawals are request → 3-day cooldown → claim at the then share price; exposure capped at 10% of NAV per market, 50% total. Backing raises a market's OI cap and skew scale to 3× pool depth.

## Findings

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| C-1 | Medium | Backing a permissionless listing exposes LP capital to a self-owned pool | Superseded by per-market vaults (P-1): LPs opt into one market's risk |
| C-2 | Medium | v4 listings: concentrated liquidity overstates depth | Accepted; prefer v3 or full-range pools for backing |
| C-3 | Low | Liquidations lag the pool by the averaging window | By design (parity with Solana's 5-min TWAP) |
| C-4 | Low | Surplus estimate uses `collateralPoolUsdc`, which funding settlement doesn't move | Fixed in v4: `_settle` moves the pool with funding |
| C-5 | Low | First depositor / share inflation | Mitigated: 6 decimals of virtual offset |
| C-6 | Info | Listed markets can't be deleted, only made close-only | By design |
| C-7 | Info | Same-second profitable roundtrips revert (a third party moving skew can trigger it) | Accepted; retry next second |

### C-1 — Backing a self-owned pool
Whoever owns most of a pool's liquidity can move its price cheaply (they pay mostly themselves), sustain it through the TWAP/EMA, and profit against the counterparty. On an unbacked market that counterparty is only that market's traders. Counterflow therefore never backs a listing automatically; graduations (whose pool liquidity is the engine's own, locked) are backed automatically. Before backing a listing, check who supplies the pool's liquidity, and keep the per-market exposure cap small.

### C-2 — v4 concentrated liquidity
The PoolManager holds every v4 pool's tokens, so a listed v4 pool's real reserves can't be read per pool; its in-range liquidity is taken at face value. Graduation pools are full-range (virtual = real). Don't back a v4 listing with concentrated liquidity.

# Per-market Counterflow vaults (internal) — 2026-10-13

Scope: the v4 engine (`initializeV4`) and `CounterflowVault` rewritten as one vault per oracle market (beacon proxies). Replaces the shared v3 vault and operator-chosen backing.
**Method:** manual review; 105 Foundry tests (18 Counterflow: vault per market, fee split, creator routing, POL at activation, underwater refusal, depth from vault cash, full payout from the vault, cash-bounded cover, broken-vault resilience, bad debt, marked NAV against late deposits and open profit, redemption pulling equity, a creator deposit re-entering during a redemption; a listing gets its vault; upgrade from the exact deployed v3 source with a backed market on the shared vault); fork tests on Monad mainnet (graduation on Uniswap v4 and MON listed on the real v3 pool both open vaults); the upgrade simulated against the live testnet engine (`UpgradeEngine` dry run, ~28.8M gas) and on a testnet fork: ORBT and LISTD get vaults, engine USDC accounting unchanged, a $50k deposit activates LISTD and adds $100k of depth. Storage layout diffed against the v3 source: v3 slots unchanged, slot 44 (`_counterflowConfig`) retired in place, `_lpConfig` at 45–46, `lpVault` at 47; `Market` renames `counterflowPendingUsdc` → `creatorLpPendingUsdc` in the same slot and appends `creatorLpBps`; `Secondary` appends `lpDepthUsdc`.
**Same caveat:** internal review only.

## Design
- **One vault per oracle market.** Graduation and listing open it (`createLpVault` for any oracle market without one; `initializeV4` opens one for every existing oracle market). Beacon proxy of `CounterflowVault` (ERC-4626, `cf<SYMBOL>`, 12 decimals); the beacon's owner upgrades all vaults at once.
- **Fees on oracle markets:** 70% LPs / 20% creator / 10% protocol (`LpConfig`), no insurance cut; liquidation penalties also stay with LPs. The LP share isn't reserved: it stays in the market as its equity. Primary markets keep the tiered creator / insurance / protocol split. Oracle markets hold no insurance: the fund a market built on the curve becomes its equity at graduation (and at `initializeV4` for existing ones).
- **Equity** = market USDC − insurance − unclaimed fees − collateral − deferred payouts − traders' open PnL (signed). The vault owns it. `syncCounterflow` sweeps `_surplus` (equity with a 10% collateral buffer and only positive open PnL counted, so it never sweeps what traders may still claim), repaying cover first; nothing is swept before the vault's first deposit.
- **NAV** = vault cash + equity, read at the mark and at the live pool. Deposits price at the higher, exits at the lower, so known-but-unrealized trader losses can't be bought cheaply and known-but-unrealized wins can't be dodged. No profit-unlock period is needed (income is counted when earned, not when swept).
- **Activation.** The first deposit (supply 0) calls `lpActivate`: equity built up before anyone backed the market is minted as shares to the protocol fee wallet at the opening price (the first depositor gets only what they paid); negative equity (traders net in profit beyond the market's funds) refuses the deposit.
- **Payouts.** Graduated markets throttle profit by utilization of headroom **plus vault cash**, cover what the market can't pay from the vault (bounded by its cash), and defer the rest. Draw failures are caught.
- **Depth.** OI cap and skew scale = pool depth × multiplier + `min(pool depth × (3 − 1), vault cash × 2)`, re-derived on each oracle sample.
- **Creator routing.** `setCreatorLpShare` routes up to 100% of the creator's 20% into the vault; set-aside fees are reserved and deposited in the creator's name on sync (try/catch: if the vault refuses, they stay set aside); `claimCreatorFees` can always take them as cash.
- **Exits.** request → cooldown (3 days, engine config) → claim at the then price from cash; a claim the cash can't cover first triggers a sync, then pays the covered part and leaves the rest of the request open.

## Findings

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| P-1 | Medium | A listed pool's liquidity owner can manipulate the oracle against that market's LPs | Accepted; disclosed per vault; OI bounded by pool depth |
| P-2 | Medium | A small vault holds a large option on its market's equity | Accepted; competition dilutes it, depth grows only with vault cash; exposure capped (Q-1) |
| P-3 | Low | Graduated markets can start underwater (pre-graduation curve profit) | Superseded by pro-rata payouts (Q-1): equity ≥ 0 with an empty vault |
| P-4 | Low | Pending (unsettled) funding isn't in equity | Accepted; settles on every touch |
| P-5 | Info | Pre-LP equity goes to the protocol as shares | Product decision |
| P-6 | Info | `lpActivate` / creator deposits re-enter the engine from the vault | Reviewed; ordered so stored state is final first |

### P-1 — Pool owner vs. the market's LPs
C-1 still holds, but nobody's capital is put at risk for them: only LPs who choose a market's vault back it. The vault page shows the pool type and, for listings, the warning to check who supplies the pool's liquidity. OI stays bounded by pool depth (≤ 3×), so the profit available from moving the pool is bounded by what moving it costs.

### P-2 — Small vault, large option
Equity (trader losses, fees) accrues to the vault however small it is, while its downside is its cash. Anyone can deposit, so a lucrative market attracts LPs until the return is shared; the depth a vault adds is ≤ 2× its cash, so the extra OI it enables is proportional to it. Entries priced at the higher NAV stop late deposits from buying realized or unrealized losses cheaply.

### P-3 — Underwater at graduation
On the primary curve traders' PnL is zero-sum against the curve; at graduation their paper profit becomes the market's liability. The released insurance fund absorbs some of it; beyond that, equity is negative and `lpActivate` refuses the first deposit — nobody should take over a hole. It clears as those positions close (throttled, as before) or lose. Seen on testnet: ORBT is ~$2 underwater after the simulated upgrade (its insurance was rounding dust).

### P-4 — Unsettled funding
`_settle` now moves `collateralPoolUsdc` with funding (fixes C-4), but funding not yet settled into any position isn't counted. It's small (bounded by rate × time since a position's last touch) and both directions occur.

### P-5 — Protocol-owned shares
The alternative — letting the first depositor take pre-LP equity — would let a $1 deposit capture it. The shares sit with the protocol fee wallet, which can redeem them like any LP.

### P-6 — Re-entry paths
`vault.deposit` (supply 0) → `engine.lpActivate` (no reentrancy guard; vault-only; reads stored state). `engine.syncCounterflow` stores the market before transferring and deposits the creator's stake last, so `lpActivate` sees final state and nothing overwrites it. `vault.claimRedeem` → `engine.syncCounterflow` → `vault.onIncome` (unguarded, engine-only); a creator stake inside that sync hits the vault's guard and is caught, leaving it set aside.

## Pro-rata payouts (2026-10-13, later)

Replaces full-liability payouts on oracle markets. **Rule:** a winner gets their released collateral (net of their own losses, funding and fee) in full; their profit is paid `profit × pool ÷ claims`, the rest forfeited to the market (no IOU). `pool` = the market's free funds (after this close's fees, excluding its principal) + what's left of the vault's budget; the budget is `lpProfitBudgetBps` (50%) of the vault's capital (cash + drawn-and-unrepaid) minus what's drawn. `claims` = max(every winner's open profit at the mark before the fill, the rest's after it + this realized profit). Vault draws are capped by the remaining budget inside `_drawCounterflow`, so liquidations, legacy-IOU claims and shortfalls are bound by it too. Equity (NAV) = free funds + losers' open loss − min(winners' open profit, pool) ≥ −budget. Deposits are credited with what they add at the worse of mark/pool (their cash minus what it lets winners claim); `mint` is disabled for that reason. Primary markets are unchanged.

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| Q-1 | Info | Winners on thin oracle markets are paid part of their profit | By design; live ratio in `payoutRatioBps`, shown on the market and vault pages |
| Q-2 | High (found in dev) | Payouts drew on other traders' collateral before the vault | Fixed: paid from free funds, then the vault, never others' collateral |
| Q-3 | High (found in dev) | A budget of "X% of current cash" refilled as it was spent | Fixed: budget counts drawn capital; draws are pool-neutral |
| Q-4 | Low | A close into the skew can realize more than its mark-valued profit | Handled: claims use the larger of before/after, so the closer never gets a larger share than the rest are left |

**Tests:** 19 Counterflow (new: exposure capped by the budget across payouts, closing first gains nothing, deposits into a haircut market pay for their own effect without diluting holders), graduation's pro-rata on an unbacked market; rehearsed on a fork of live testnet: cfLISTD NAV unchanged by the refresh, ORBT (formerly "underwater") accepts a $10k deposit credited at $9,998.

### Primary markets (2026-10-13, later)
The same pro-rata rule now applies on the curve, replacing the headroom-capped IOU. The pool is free funds (signed — negative once winners were paid from losers' collateral) plus the losers' loss, both measured as each side would realize **unwinding through the curve** (`_openPnl`), capped by the collateral pool. Valuing claims at the mark would haircut primary winners for nothing: the mark is the marginal price, so in a one-sided pump every long looks like a winner at it. Since the curve is zero-sum across a full unwind, the ratio stays 100% unless a loss ran past collateral (bad debt) — then the winner is paid pro rata and the rest is forfeited. IOUs remain only for cash the market can't pay (none expected) and blacklisted recipients. Tests: a winner paid in full against later buyers; a 40x long liquidated past her collateral leaves the short paid pro rata, nothing owed.

