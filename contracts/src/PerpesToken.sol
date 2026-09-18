// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title PerpesToken
/// @notice The token every Perpes launch creates. The entire fixed supply is
/// minted once, in the constructor, to the protocol (the engine) — there is no
/// owner, no further minting and no freeze, so nobody (creator included) can
/// hold pre-minted inventory. Mirrors the Solana launch, which mints the supply
/// to a protocol vault PDA and then revokes the mint authority.
contract PerpesToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    string public tokenURI;

    constructor(string memory name_, string memory symbol_, string memory uri_, address vault)
        ERC20(name_, symbol_)
    {
        tokenURI = uri_;
        _mint(vault, TOTAL_SUPPLY);
    }
}
