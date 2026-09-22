// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRiskManager {
    struct PerpRisk {
        uint16 maxLeverage; // whole number, e.g. 3 = 3x
        uint16 initialMarginBps; // equity needed to open or grow a position, as a share of notional
        uint16 maintenanceMarginBps; // below this the position can be liquidated
        uint32 maxProfitBps; // a position's profit is capped at this share of its entry notional
        uint32 fundingInterval; // seconds
        uint32 maxPriceAge; // seconds; older oracle prices halt the market
        uint64 fundingRatePerInterval; // 1e18 = 100% of notional per interval, at a fully one-sided market
        uint256 maxPositionNotional; // USDC, 6 decimals
        uint256 openInterestCap; // per side, USDC, 6 decimals
    }

    function getPerpRisk(uint32 marketId) external view returns (PerpRisk memory);
    function tradingOpen(uint32 marketId) external view returns (bool);
    function optionsReserveCap(uint32 assetId) external view returns (uint256);
    function maxUtilizationBps() external view returns (uint16);
}
