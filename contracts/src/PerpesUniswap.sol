// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

/// @title PerpesUniswap
/// @notice Uniswap v4 helpers for graduation: the token/USDC pool key (no
/// hooks), price conversions, the pool's live price and USDC depth, and the
/// full-range liquidity mint whose position NFT goes straight to the burn
/// address. Prices are USDC (6 decimals) per whole token (18 decimals), E6.
library PerpesUniswap {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    /// The position NFT is minted here, so the liquidity can never be removed.
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant Q96 = 1 << 96;
    uint256 internal constant Q192 = 1 << 192;
    uint256 internal constant TOKEN_UNIT = 1e18;

    function poolKey(address token, address usdc, uint24 fee, int24 tickSpacing) internal pure returns (PoolKey memory) {
        (address a, address b) = token < usdc ? (token, usdc) : (usdc, token);
        return PoolKey(Currency.wrap(a), Currency.wrap(b), fee, tickSpacing, IHooks(address(0)));
    }

    function poolId(PoolKey memory key) internal pure returns (bytes32) {
        return PoolId.unwrap(key.toId());
    }

    /// The pool's sqrt price for `priceE6`. v4 prices are currency1 per currency0 in raw units.
    function toSqrtPriceX96(uint256 priceE6, bool tokenIs0) internal pure returns (uint160) {
        uint256 ratioX192 =
            tokenIs0 ? FullMath.mulDiv(priceE6, Q192, TOKEN_UNIT) : FullMath.mulDiv(TOKEN_UNIT, Q192, priceE6);
        uint256 s = Math.sqrt(ratioX192);
        if (s <= TickMath.MIN_SQRT_PRICE) return TickMath.MIN_SQRT_PRICE + 1;
        if (s >= TickMath.MAX_SQRT_PRICE) return TickMath.MAX_SQRT_PRICE - 1;
        return uint160(s);
    }

    function toPriceE6(uint160 sqrtP, bool tokenIs0) internal pure returns (uint256) {
        uint256 priceX96 = FullMath.mulDiv(sqrtP, sqrtP, Q96);
        if (tokenIs0) return FullMath.mulDiv(priceX96, TOKEN_UNIT, Q96);
        return priceX96 == 0 ? type(uint256).max : FullMath.mulDiv(TOKEN_UNIT, Q96, priceX96);
    }

    function sqrtPrice(IPoolManager pm, PoolKey memory key) internal view returns (uint160 sqrtP) {
        (sqrtP,,,) = StateLibrary.getSlot0(pm, key.toId());
    }

    /// Live pool price (0 if the pool isn't initialized).
    function spotPriceE6(IPoolManager pm, PoolKey memory key, bool tokenIs0) internal view returns (uint256) {
        uint160 sqrtP = sqrtPrice(pm, key);
        return sqrtP == 0 ? 0 : toPriceE6(sqrtP, tokenIs0);
    }

    /// USDC side of the pool's in-range liquidity at the current price — the
    /// spot depth the perp's OI cap and skew scale are sized from.
    function usdcDepth(IPoolManager pm, PoolKey memory key, bool tokenIs0) internal view returns (uint256) {
        PoolId id = key.toId();
        (uint160 sqrtP,,,) = StateLibrary.getSlot0(pm, id);
        uint128 liquidity = StateLibrary.getLiquidity(pm, id);
        if (sqrtP == 0 || liquidity == 0) return 0;
        return tokenIs0 ? FullMath.mulDiv(liquidity, sqrtP, Q96) : FullMath.mulDiv(liquidity, Q96, sqrtP);
    }

    /// Mints full-range liquidity from `amount0`/`amount1` at `sqrtP` through
    /// the PositionManager, paying via Permit2, with the NFT owned by DEAD.
    /// Approvals are exact and cleared afterwards.
    function mintFullRangeToDead(
        address positionManager,
        address permit2,
        PoolKey memory key,
        uint160 sqrtP,
        uint256 amount0,
        uint256 amount1
    ) internal returns (uint256 tokenId, uint128 liquidity) {
        int24 lower = TickMath.minUsableTick(key.tickSpacing);
        int24 upper = TickMath.maxUsableTick(key.tickSpacing);
        // Two wei of margin per side: the pool rounds owed amounts up.
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP,
            TickMath.getSqrtPriceAtTick(lower),
            TickMath.getSqrtPriceAtTick(upper),
            amount0 > 2 ? amount0 - 2 : 0,
            amount1 > 2 ? amount1 - 2 : 0
        );
        require(liquidity > 0, "PerpesUniswap: zero liquidity");

        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        _approve(permit2, positionManager, c0, amount0);
        _approve(permit2, positionManager, c1, amount1);

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, uint256(liquidity), uint128(amount0), uint128(amount1), DEAD, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));

        tokenId = IPositionManager(positionManager).nextTokenId();
        IPositionManager(positionManager).modifyLiquidities(abi.encode(actions, params), block.timestamp);

        _approve(permit2, positionManager, c0, 0);
        _approve(permit2, positionManager, c1, 0);
    }

    function _approve(address permit2, address spender, address token, uint256 amount) private {
        IERC20(token).forceApprove(permit2, amount);
        IAllowanceTransfer(permit2).approve(token, spender, uint160(amount), uint48(block.timestamp));
    }
}
