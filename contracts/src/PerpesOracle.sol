// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

interface IUniswapV3PoolLike {
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
    function liquidity() external view returns (uint128);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}

interface IUniswapV3FactoryLike {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

/// @title PerpesOracle
/// @notice On-chain prices for oracle-priced markets, read straight from
/// Uniswap pools — no keeper, no outside feed.
///   - v3 pools: the pool's own TWAP (`observe`), written by the pool at the
///     first touch of each block, so it can't be moved within a transaction.
///   - v4 pools have no history, so the engine keeps an exponential moving
///     average of the pool price instead: one sample per second, each clamped
///     to a band around the average and time-weighted with a capped gap — a
///     manipulator has to hold the pool off-price for minutes, against
///     arbitrage, to move it.
/// Prices are 1e18 fixed point (quote per whole base) internally.
library PerpesOracle {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant Q96 = 1 << 96;
    uint256 internal constant Q128 = 1 << 128;

    /// Whole-unit price of `base` in `quote` (1e18 fixed) from a pool sqrt price.
    /// v3/v4 sqrt prices are currency1 per currency0 in raw units.
    function priceE18(uint160 sqrtP, bool baseIs0, uint8 baseDecimals, uint8 quoteDecimals)
        internal
        pure
        returns (uint256)
    {
        uint256 rawX128 = FullMath.mulDiv(sqrtP, sqrtP, 1 << 64);
        if (rawX128 == 0) return 0;
        uint256 scale = 10 ** (18 + uint256(baseDecimals));
        if (baseIs0) return FullMath.mulDiv(rawX128, scale, Q128 * 10 ** uint256(quoteDecimals));
        return FullMath.mulDiv(Q128, scale, rawX128) / 10 ** uint256(quoteDecimals);
    }

    /// Quote-side reserve of the in-range liquidity at `sqrtP`, raw quote units.
    function quoteDepth(uint128 liquidity, uint160 sqrtP, bool quoteIs0) internal pure returns (uint256) {
        if (sqrtP == 0 || liquidity == 0) return 0;
        return quoteIs0 ? FullMath.mulDiv(liquidity, Q96, sqrtP) : FullMath.mulDiv(liquidity, sqrtP, Q96);
    }

    // ── Uniswap v3 ───────────────────────────────────────────────────────────

    function v3Spot(address pool) internal view returns (uint160 sqrtP, uint128 liquidity) {
        (sqrtP,,,,,,) = IUniswapV3PoolLike(pool).slot0();
        liquidity = IUniswapV3PoolLike(pool).liquidity();
    }

    /// Sqrt price at the arithmetic-mean tick between two `observe` cumulatives
    /// `window` seconds apart (rounded toward negative infinity, as Uniswap's OracleLibrary).
    function meanTickSqrtPrice(int56 cumulativeThen, int56 cumulativeNow, uint32 window)
        internal
        pure
        returns (uint160)
    {
        int56 delta = cumulativeNow - cumulativeThen;
        int56 w = int56(uint56(window));
        int24 tick = int24(delta / w);
        if (delta < 0 && delta % w != 0) tick--;
        return TickMath.getSqrtPriceAtTick(tick);
    }

    // ── Uniswap v4 ───────────────────────────────────────────────────────────

    function v4Spot(IPoolManager pm, PoolKey memory key) internal view returns (uint160 sqrtP, uint128 liquidity) {
        PoolId id = key.toId();
        (sqrtP,,,) = StateLibrary.getSlot0(pm, id);
        liquidity = StateLibrary.getLiquidity(pm, id);
    }

    // ── Smoothing ────────────────────────────────────────────────────────────

    /// One EMA step towards `sample`, clamped to ±`maxDeviationBps` of the
    /// current average and weighted by `dt / (dt + tau)`.
    function emaStep(uint256 ema, uint256 sample, uint256 dt, uint256 tau, uint256 maxDeviationBps)
        internal
        pure
        returns (uint256)
    {
        if (ema == 0) return sample;
        uint256 lo = (ema * (10_000 - maxDeviationBps)) / 10_000;
        uint256 hi = (ema * (10_000 + maxDeviationBps)) / 10_000;
        uint256 s = sample < lo ? lo : (sample > hi ? hi : sample);
        if (s >= ema) return ema + ((s - ema) * dt) / (dt + tau);
        return ema - ((ema - s) * dt) / (dt + tau);
    }

    /// Pool depth follows decreases at once but increases only gradually, so
    /// liquidity added and pulled in one transaction (JIT) can't inflate caps.
    function depthStep(uint256 stored, uint256 live, uint256 dt, uint256 tau) internal pure returns (uint256) {
        if (live <= stored || stored == 0) return live;
        return stored + ((live - stored) * dt) / (dt + tau);
    }
}
