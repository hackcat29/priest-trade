// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title MockUSDC
/// @notice Testnet-only 6-decimal collateral with a rate-limited public faucet —
/// the Monad counterpart of the Solana devnet faucet mint. Never deployed to mainnet.
contract MockUSDC is ERC20, ERC20Permit {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    address public immutable minter;
    mapping(address => uint256) public lastFaucetAt;

    error FaucetCooldown(uint256 availableAt);
    error NotMinter();

    constructor() ERC20("USD Coin (Perpes Testnet)", "USDC") ERC20Permit("USD Coin (Perpes Testnet)") {
        minter = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// Anyone can draw FAUCET_AMOUNT once per FAUCET_COOLDOWN.
    function faucet() external {
        uint256 next = lastFaucetAt[msg.sender] + FAUCET_COOLDOWN;
        if (lastFaucetAt[msg.sender] != 0 && block.timestamp < next) revert FaucetCooldown(next);
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// Deployer-only top-up (seeding demo markets, keeper gas-free funding).
    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, amount);
    }
}
