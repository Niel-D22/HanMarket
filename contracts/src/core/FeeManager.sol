// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IFeeManager} from "../interfaces/IFeeManager.sol";

/**
 * @title Fee manager
 * @notice Fee rates and where collected fees go: a share to the LP pool (their yield), an optional share to a
 *         buyback receiver, and the rest to the treasury. The vault applies the split; nothing is hardcoded in the UI.
 */
contract FeeManager is IFeeManager, Ownable2Step {
    uint16 public constant MAX_PERP_FEE_BPS = 100; // 1% of notional per trade
    uint16 public constant MAX_OPTION_FEE_BPS = 1_000; // 10% of premium or payout
    uint16 public constant MAX_LIQUIDATION_FEE_BPS = 500;
    uint16 internal constant BPS = 10_000;

    FeeConfig internal _fees;
    uint16 public lpShareBps;
    uint16 public buybackShareBps;
    address public treasury;
    address public buybackReceiver;

    event FeesUpdated(FeeConfig fees);
    event FeeSplitUpdated(uint16 lpShareBps, uint16 buybackShareBps, address treasury, address buybackReceiver);

    error InvalidParams();

    constructor(address owner_, address treasury_, FeeConfig memory fees_, uint16 lpShareBps_) Ownable(owner_) {
        _setFees(fees_);
        _setSplit(lpShareBps_, 0, treasury_, address(0));
    }

    function setFees(FeeConfig calldata fees_) external onlyOwner {
        _setFees(fees_);
    }

    function setSplit(uint16 lpShareBps_, uint16 buybackShareBps_, address treasury_, address buybackReceiver_)
        external
        onlyOwner
    {
        _setSplit(lpShareBps_, buybackShareBps_, treasury_, buybackReceiver_);
    }

    function getFees() external view returns (FeeConfig memory) {
        return _fees;
    }

    function split(uint256 fee) external view returns (uint256 toPool, uint256 toBuyback, uint256 toTreasury) {
        toPool = (fee * lpShareBps) / BPS;
        toBuyback = (fee * buybackShareBps) / BPS;
        toTreasury = fee - toPool - toBuyback;
    }

    function _setFees(FeeConfig memory f) internal {
        if (f.makerFee > MAX_PERP_FEE_BPS || f.takerFee > MAX_PERP_FEE_BPS) revert InvalidParams();
        if (f.optionOpenFee > MAX_OPTION_FEE_BPS || f.optionCloseFee > MAX_OPTION_FEE_BPS) revert InvalidParams();
        if (f.settlementFee > MAX_OPTION_FEE_BPS || f.liquidationFee > MAX_LIQUIDATION_FEE_BPS) revert InvalidParams();
        _fees = f;
        emit FeesUpdated(f);
    }

    function _setSplit(uint16 lp, uint16 buyback, address treasury_, address buybackReceiver_) internal {
        if (treasury_ == address(0) || uint256(lp) + buyback > BPS) revert InvalidParams();
        if (buyback > 0 && buybackReceiver_ == address(0)) revert InvalidParams();
        lpShareBps = lp;
        buybackShareBps = buyback;
        treasury = treasury_;
        buybackReceiver = buybackReceiver_;
        emit FeeSplitUpdated(lp, buyback, treasury_, buybackReceiver_);
    }
}
