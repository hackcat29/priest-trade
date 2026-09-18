// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PerpesEngine} from "../src/PerpesEngine.sol";

/// Protocol defaults — the same values as programs/perpes/src/constants.rs, so
/// a Monad market behaves like a Solana one out of the box.
library Defaults {
    function config(address protocolFeeWallet, address insuranceFundWallet, address treasury)
        internal
        pure
        returns (PerpesEngine.Config memory c)
    {
        c.protocolFeeWallet = protocolFeeWallet;
        c.insuranceFundWallet = insuranceFundWallet;
        c.treasury = treasury;
        c.launchFeeWei = 0;
        c.launchPaused = false;
        c.takerFeeBps = 10;
        c.fundingVelocityBps = 25;
        c.fundingRateCapBps = 25;
        c.fundingIntervalSeconds = 3_600;
        c.flatMaxLeverageX = 40;
        c.warmupMaxLeverageX = 10;
        c.warmupSeconds = 86_400;
        c.defaultLiquidityDepthUsdc = 10_000e6;
        c.initialPriceE6 = 1_000_000;
        c.creatorFeeBps = 5_000;
        c.creatorFeeBpsUnqualified = 2_500;
        c.creatorFeeVolumeThresholdUsdc = 100_000e6;
        c.creatorFeeWindowSeconds = 30 days;
        c.insuranceFeeBpsStatic = 1_000;
        c.liquidationRewardBps = 50;
        c.liquidationPenaltyBps = 50;
        c.referenceUpdateIntervalSeconds = 300;
        c.maxActiveOrdersPerWallet = 100;
        c.tickSizeE6 = 1_000;
        c.maxOiMultiple = 0;
        c.fundingOiFloorUsdc = 10_000e6;
    }

    /// Graduation + secondary engine — programs/perpes/src/state/secondary.rs
    /// defaults, plus the Uniswap v4 pool shape (1% fee, 200 tick spacing).
    function secondaryConfig() internal pure returns (PerpesEngine.SecondaryConfig memory c) {
        c.minAgeSeconds = 72 hours;
        c.minUniqueTraders = 500;
        c.maxVaultStressBps = 2_500;
        c.minVolumeUsdc = 2_000_000e6;
        c.minPeakOiUsdc = 100_000e6;
        c.transitionSeconds = 6 hours;
        c.velocityWindowSeconds = 300;
        c.maxPriceStalenessSeconds = 60;
        c.maxLiquidityStalenessSeconds = 120;
        c.maxOracleSpotDeviationBps = 2_500;
        c.velocityCircuitBps = 2_500;
        c.virtualLiqMultiplier = 1;
        c.maxOiMultiplier = 1;
        c.minVirtualLiquidityUsdc = 10_000e6;
        c.initialMaxLeverageX = 15;
        c.maxLeverageCapX = 40;
        c.leverageStepPer24h = 5;
        c.maxExecutionImpactBps = 500;
        c.maxMarkDeviationBps = 100;
        c.minSpreadBps = 10;
        c.maxPositionShareBps = 2_500;
        c.fundingVelocityBps = 10;
        c.fundingRateCapBps = 20;
        c.fundingIntervalSeconds = 3_600;
        c.poolFee = 10_000;
        c.tickSpacing = 200;
    }

    /// On-chain oracle: 5-minute v3 TWAP; v4 EMA with a 5-minute time constant,
    /// at most 30s counted per sample and samples clamped to ±50% of the EMA
    /// (so one manipulated sample moves it ≤ 30/330 × 50% ≈ 4.5%).
    function oracleConfig(address v3Factory, address wmon, address monUsdPool)
        internal
        pure
        returns (PerpesEngine.OracleConfig memory o)
    {
        o.v3Factory = v3Factory;
        o.wmon = wmon;
        o.monUsdPool = monUsdPool;
        o.twapWindowSeconds = 300;
        o.emaTauSeconds = 300;
        o.maxSampleGapSeconds = 30;
        o.maxSampleDeviationBps = 5_000;
    }

    /// Listing existing tokens: on, up to 10x, 10-minute warmup, $25k minimum pool depth.
    function listingConfig() internal pure returns (PerpesEngine.ListingConfig memory l) {
        l.enabled = true;
        l.maxLeverageX = 10;
        l.warmupSeconds = 600;
        l.listingFeeWei = 0;
        l.minDepthUsdc = 25_000e6;
    }

    /// Counterflow (per-market vaults): oracle-market fees split 70% LPs / 20%
    /// creator / 10% protocol; a vault adds 2× its cash to its market's OI cap
    /// and skew scale, up to 3× pool depth in all; 10% collateral buffer before
    /// sweeps; 3-day withdrawal cooldown; at most half the vault's cash may go to
    /// winners' profit at any moment (beyond that, profit is paid pro rata).
    function lpConfig(address vaultBeacon) internal pure returns (PerpesEngine.LpConfig memory c) {
        c.vaultBeacon = vaultBeacon;
        c.lpFeeBps = 7_000;
        c.creatorFeeBps = 2_000;
        c.protocolFeeBps = 1_000;
        c.backedDepthMultiplier = 3;
        c.lpOiMultiplier = 2;
        c.surplusBufferBps = 1_000;
        c.redeemCooldownSeconds = 3 days;
        c.depositsPaused = false;
        c.lpProfitBudgetBps = 5_000;
    }
}
