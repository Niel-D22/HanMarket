// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

/**
 * @title Margin math
 * @notice Pure isolated-margin formulas shared by the perps engine and its views.
 *  size: shares with 18 decimals. Prices, notionals, collateral and PnL: USDC with 6 decimals.
 */
library MarginMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    function notional(uint256 size, uint256 price) internal pure returns (uint256) {
        return (size * price) / WAD;
    }

    /// @notice Unrealised PnL of `size` shares opened for `entryNotional`, at `price`.
    function pnl(bool isLong, uint256 size, uint256 entryNotional, uint256 price) internal pure returns (int256) {
        int256 value = int256(notional(size, price));
        return isLong ? value - int256(entryNotional) : int256(entryNotional) - value;
    }

    /// @notice Price at which equity equals the maintenance margin. Zero when a long can never be liquidated.
    function liquidationPrice(
        bool isLong,
        uint256 size,
        uint256 entryNotional,
        uint256 collateral,
        uint256 fundingOwed,
        uint256 maintenanceMarginBps
    ) internal pure returns (uint256) {
        if (size == 0) return 0;
        if (isLong) {
            // collateral + size*p - entry - funding = mm * size*p
            uint256 debt = entryNotional + fundingOwed;
            if (debt <= collateral) return 0;
            return ((debt - collateral) * WAD * BPS) / (size * (BPS - maintenanceMarginBps));
        }
        // collateral + entry - size*p - funding = mm * size*p
        uint256 assets = collateral + entryNotional;
        if (assets <= fundingOwed) return type(uint256).max;
        return ((assets - fundingOwed) * WAD * BPS) / (size * (BPS + maintenanceMarginBps));
    }
}
