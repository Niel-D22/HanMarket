// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFeeManager {
    /// @notice All fees in basis points. Perp fees apply to notional, option fees to premium or payout.
    struct FeeConfig {
        uint16 makerFee;
        uint16 takerFee;
        uint16 optionOpenFee;
        uint16 optionCloseFee;
        uint16 settlementFee;
        uint16 liquidationFee;
    }

    function getFees() external view returns (FeeConfig memory);
    function treasury() external view returns (address);
    function buybackReceiver() external view returns (address);

    /// @notice How a collected fee is divided between the LP pool, the buyback module and the treasury.
    function split(uint256 fee) external view returns (uint256 toPool, uint256 toBuyback, uint256 toTreasury);
}
