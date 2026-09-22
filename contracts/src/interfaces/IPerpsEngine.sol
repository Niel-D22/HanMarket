// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPerpsEngine {
    /// @notice Unrealised PnL of all open perp positions at index prices (traders' gain is the pool's loss).
    function totalTraderPnl() external view returns (int256);
}
