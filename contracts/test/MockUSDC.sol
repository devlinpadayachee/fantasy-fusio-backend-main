// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockUSDC is ERC20, Ownable {
    uint8 private _decimals = 18;

    constructor() ERC20("USD Coin", "USDC") {
         _mint(msg.sender, 10000000*10**18);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function setDecimals(uint8 newDecimals) external onlyOwner {
        _decimals = newDecimals;
    }
}
