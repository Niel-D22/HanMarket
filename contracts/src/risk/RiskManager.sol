// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IRiskManager} from "../interfaces/IRiskManager.sol";

/**
 * @title Risk manager
 * @notice Per-market risk parameters: leverage, margins, position and open-interest caps, profit caps, funding and
 *         oracle freshness, plus per-asset caps on option exposure and the pool's maximum utilisation.
 *
 *  `tradingOpen` follows the underlying exchange's session. The keeper opens a market when the exchange opens and
 *  closes it when it closes, so nobody can trade against a price that stopped moving over a weekend or holiday.
 */
contract RiskManager is IRiskManager, Ownable2Step {
    uint16 internal constant BPS = 10_000;
    uint16 public constant MAX_LEVERAGE = 50;

    mapping(uint32 marketId => PerpRisk) internal _perp;
    mapping(uint32 marketId => bool) public perpConfigured;
    mapping(uint32 marketId => bool) public tradingOpen;
    mapping(uint32 assetId => uint256) public optionsReserveCap;
    uint16 public maxUtilizationBps;
    address public keeper;

    event PerpRiskSet(uint32 indexed marketId, PerpRisk risk);
    event TradingOpenSet(uint32 indexed marketId, bool open);
    event OptionsReserveCapSet(uint32 indexed assetId, uint256 cap);
    event MaxUtilizationSet(uint16 bps);
    event KeeperSet(address keeper);

    error InvalidParams();
    error NotConfigured();
    error NotKeeper();

    constructor(address owner_, address keeper_, uint16 maxUtilizationBps_) Ownable(owner_) {
        _setMaxUtilization(maxUtilizationBps_);
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function setPerpRisk(uint32 marketId, PerpRisk calldata r) external onlyOwner {
        if (r.maxLeverage == 0 || r.maxLeverage > MAX_LEVERAGE) revert InvalidParams();
        // the initial margin must allow the advertised leverage, and sit above the maintenance margin
        if (uint256(r.initialMarginBps) * r.maxLeverage < BPS || r.initialMarginBps > BPS) revert InvalidParams();
        if (r.maintenanceMarginBps == 0 || r.maintenanceMarginBps >= r.initialMarginBps) revert InvalidParams();
        if (r.maxProfitBps == 0 || r.maxProfitBps > 100_000) revert InvalidParams(); // at most 10x the entry notional
        if (r.fundingInterval < 1 minutes || r.maxPriceAge == 0) revert InvalidParams();
        if (r.fundingRatePerInterval > 1e16) revert InvalidParams(); // at most 1% per interval
        if (r.maxPositionNotional == 0 || r.maxPositionNotional > r.openInterestCap) revert InvalidParams();
        _perp[marketId] = r;
        perpConfigured[marketId] = true;
        emit PerpRiskSet(marketId, r);
    }

    function getPerpRisk(uint32 marketId) external view returns (PerpRisk memory) {
        if (!perpConfigured[marketId]) revert NotConfigured();
        return _perp[marketId];
    }

    function setTradingOpen(uint32 marketId, bool open) external {
        if (msg.sender != owner() && msg.sender != keeper) revert NotKeeper();
        tradingOpen[marketId] = open;
        emit TradingOpenSet(marketId, open);
    }

    /// @notice Most USDC the pool may reserve for open options on one asset. Zero stops new option sales.
    function setOptionsReserveCap(uint32 assetId, uint256 cap) external onlyOwner {
        optionsReserveCap[assetId] = cap;
        emit OptionsReserveCapSet(assetId, cap);
    }

    function setMaxUtilization(uint16 bps) external onlyOwner {
        _setMaxUtilization(bps);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function _setMaxUtilization(uint16 bps) internal {
        if (bps == 0 || bps > BPS) revert InvalidParams();
        maxUtilizationBps = bps;
        emit MaxUtilizationSet(bps);
    }
}
