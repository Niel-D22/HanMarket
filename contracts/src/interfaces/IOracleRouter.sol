// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Price access for every engine. Prices are USD with 6 decimals.
interface IOracleRouter {
    /// @notice Live index price, rejected when stale, paused or not positive.
    function getPrice(bytes32 oracleId) external view returns (uint256 price, uint256 timestamp);

    /// @notice Whether the asset has a live onchain price (Chainlink) rather than a settlement-only signed price.
    function hasLivePrice(bytes32 oracleId) external view returns (bool);

    /// @notice Validated price at `expiry`. `data` is the Chainlink round id, or a signed price for signed assets.
    function settlementPrice(bytes32 oracleId, uint64 expiry, uint32 window, bytes calldata data)
        external
        view
        returns (uint256 price);
}
