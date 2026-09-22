// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMarketRegistry {
    /// @notice An underlying equity. `token` is the tokenized share when one exists onchain, else zero (synthetic).
    struct Asset {
        string symbol;
        bytes32 oracleId;
        address token;
        bool optionsEnabled;
        bool perpsEnabled;
        bool active;
    }

    struct PerpMarket {
        string symbol; // "BABA-PERP"
        uint32 assetId;
        bool active;
    }

    function assetCount() external view returns (uint256);
    function getAsset(uint32 assetId) external view returns (Asset memory);
    function perpMarketCount() external view returns (uint256);
    function getPerpMarket(uint32 marketId) external view returns (PerpMarket memory);
}
