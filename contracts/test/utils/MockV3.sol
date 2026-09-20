// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Minimal Uniswap v3 pool / factory stand-ins for listing and oracle tests:
/// settable spot (sqrt price + liquidity) and a settable TWAP tick, with an
/// option to behave like a pool without enough history (observe reverts).
contract MockV3Pool {
    address public token0;
    address public token1;
    uint24 public fee;
    uint160 public sqrtPriceX96;
    uint128 public liquidity;
    int24 public twapTick;
    bool public noHistory;

    constructor(address a, address b, uint24 fee_) {
        (token0, token1) = a < b ? (a, b) : (b, a);
        fee = fee_;
    }

    function setSpot(uint160 sqrtPrice, uint128 liquidity_) external {
        sqrtPriceX96 = sqrtPrice;
        liquidity = liquidity_;
    }

    function setTwapTick(int24 tick) external {
        twapTick = tick;
    }

    function setNoHistory(bool v) external {
        noHistory = v;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, 0, 0, 1, 1, 0, true);
    }

    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory c, uint160[] memory l) {
        require(!noHistory, "OLD");
        c = new int56[](secondsAgos.length);
        l = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; i++) {
            c[i] = int56(twapTick) * int56(int256(block.timestamp - secondsAgos[i]));
        }
    }
}

contract MockV3Factory {
    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;

    function register(MockV3Pool pool) external {
        getPool[pool.token0()][pool.token1()][pool.fee()] = address(pool);
        getPool[pool.token1()][pool.token0()][pool.fee()] = address(pool);
    }
}
