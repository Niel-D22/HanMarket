// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Hooks the trading engines use to move collateral inside the vault. Only registered engines may call them.
interface IVault {
    /// @notice Move `amount` of a user's free balance into locked margin.
    function lockMargin(address user, uint256 amount) external;

    /**
     * @notice Release `lockedAmount` of a user's margin: `toUser` to their free balance, `fee` to the fee split,
     *         `reward` to `rewardTo`. The pool takes the difference, or pays it when the outflow is larger.
     */
    function settleLocked(address user, uint256 lockedAmount, uint256 toUser, uint256 fee, uint256 reward, address rewardTo)
        external;

    /// @notice Take an option premium (to the pool) plus fee from a user's free balance.
    function collectPremium(address user, uint256 premium, uint256 fee) external;

    /// @notice Pay `amount` from the pool; `fee` of it goes to the fee split, the rest to the user.
    function payFromPool(address user, uint256 amount, uint256 fee) external;

    /// @notice Earmark pool funds for settled option payouts.
    function poolToPayable(uint256 amount) external;

    /// @notice Pay a settled option payout; `fee` of it goes to the fee split.
    function payFromPayable(address user, uint256 amount, uint256 fee) external;

    /// @notice Reserve pool funds for the most open positions can ever win. Reverts above max utilisation.
    function reserve(uint256 amount) external;

    function release(uint256 amount) external;

    /// @notice Premiums held for options that have not expired yet (excluded from LP value until settlement).
    function adjustDeferred(int256 delta) external;
}
