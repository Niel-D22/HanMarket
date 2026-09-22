// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IOracleRouter} from "../interfaces/IOracleRouter.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IFeeManager} from "../interfaces/IFeeManager.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";
import {IPerpsEngine} from "../interfaces/IPerpsEngine.sol";
import {MarginMath} from "../risk/MarginMath.sol";

/**
 * @title Perpetuals engine
 * @notice Isolated-margin long and short positions against the vault, filled at the oracle index price.
 *
 *  - One position per account, market and side. Opening or growing reserves the position's profit cap in the vault.
 *  - Mark price = index price (Chainlink). There is no separate perp order book in this version.
 *  - Funding: every interval, the side with more open interest pays `fundingRatePerInterval x skew` of its entry
 *    notional to the pool. The smaller side pays nothing. Funding accrues on every interaction.
 *  - Liquidation: anyone may liquidate a position whose equity is below its maintenance margin. The liquidator
 *    earns the liquidation fee, the owner keeps whatever equity remains, the pool absorbs any shortfall.
 *  - Trading follows the exchange session (`RiskManager.tradingOpen`); collateral can be added and positions
 *    liquidated at any time.
 */
contract PerpsEngine is IPerpsEngine, Ownable2Step, Pausable, ReentrancyGuard {
    using MarginMath for uint256;

    struct Position {
        uint256 size; // shares, 18 decimals
        uint256 collateral; // USDC locked in the vault
        uint256 entryNotional; // USDC paid for `size` at entry prices
        uint256 reserved; // profit cap reserved in the vault
        uint256 fundingIndex; // side's cumulative funding when last settled
        uint64 lastUpdated;
    }

    struct MarketState {
        uint256 longSize;
        uint256 shortSize;
        uint256 longEntryNotional;
        uint256 shortEntryNotional;
        uint256 longFundingIndex; // cumulative share of notional paid by longs, 1e18 = 100%
        uint256 shortFundingIndex;
        uint64 lastFundingTime;
    }

    /// @notice Everything the terminal shows for a position.
    struct PositionInfo {
        uint256 size;
        uint256 collateral;
        uint256 entryPrice;
        uint256 markPrice;
        uint256 notional;
        int256 pnl;
        uint256 fundingOwed;
        int256 equity;
        uint256 leverageBps; // notional / equity
        uint256 liquidationPrice;
        uint256 maintenanceMargin;
        bool liquidatable;
    }

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    IMarketRegistry public immutable registry;
    IOracleRouter public immutable oracle;
    IVault public immutable vault;
    IFeeManager public immutable feeManager;
    IRiskManager public immutable riskManager;

    mapping(bytes32 key => Position) internal _positions;
    mapping(uint32 marketId => MarketState) internal _state;

    event PerpPositionOpened(
        bytes32 indexed key, address indexed account, uint32 indexed marketId, bool isLong, uint256 sizeUsd, uint256 collateral, uint256 price, uint256 fee
    );
    event PerpPositionUpdated(
        bytes32 indexed key,
        address indexed account,
        uint32 indexed marketId,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 entryNotional,
        uint256 price,
        int256 realizedPnl,
        uint256 fee
    );
    event PerpPositionClosed(
        bytes32 indexed key, address indexed account, uint32 indexed marketId, bool isLong, uint256 price, int256 realizedPnl, uint256 payout, uint256 fee
    );
    event PositionLiquidated(
        bytes32 indexed key, address indexed account, uint32 indexed marketId, bool isLong, uint256 price, int256 equity, address liquidator, uint256 reward, uint256 returned
    );
    event FundingPaid(bytes32 indexed key, address indexed account, uint32 indexed marketId, uint256 amount);
    event FundingUpdated(uint32 indexed marketId, int256 ratePerInterval, uint256 longFundingIndex, uint256 shortFundingIndex);

    error MarketPaused();
    error MarketClosed();
    error InvalidParams();
    error DeadlineExpired();
    error SlippageExceeded();
    error LeverageTooHigh();
    error InsufficientMargin();
    error InsufficientCollateral();
    error PositionLimitExceeded();
    error OpenInterestLimitExceeded();
    error NoPosition();
    error Liquidatable();
    error NotLiquidatable();
    error StaleOraclePrice();

    constructor(
        IMarketRegistry registry_,
        IOracleRouter oracle_,
        IVault vault_,
        IFeeManager feeManager_,
        IRiskManager riskManager_,
        address owner_
    ) Ownable(owner_) {
        registry = registry_;
        oracle = oracle_;
        vault = vault_;
        feeManager = feeManager_;
        riskManager = riskManager_;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------- trading

    /**
     * @notice Open or grow a position, and/or add collateral.
     * @param collateralDelta USDC moved from the vault balance into this position's margin
     * @param sizeDeltaUsd notional to add at the current price (0 = only add collateral)
     * @param acceptablePrice worst fill: the most a long pays, the least a short sells at
     */
    function increasePosition(
        uint32 marketId,
        bool isLong,
        uint256 collateralDelta,
        uint256 sizeDeltaUsd,
        uint256 acceptablePrice,
        uint64 deadline
    ) external nonReentrant whenNotPaused {
        if (collateralDelta == 0 && sizeDeltaUsd == 0) revert InvalidParams();
        IRiskManager.PerpRisk memory r = riskManager.getPerpRisk(marketId);
        uint256 price = _price(marketId, r);
        bytes32 key = positionKey(msg.sender, marketId, isLong);
        Position storage p = _positions[key];
        bool isNew = p.size == 0;
        if (isNew && sizeDeltaUsd == 0) revert NoPosition();
        if (sizeDeltaUsd > 0) _checkOrder(marketId, isLong, true, price, acceptablePrice, deadline);

        _updateFunding(marketId, r);
        if (!isNew) _settleFunding(key, msg.sender, marketId, isLong, p);
        else p.fundingIndex = _index(marketId, isLong);

        if (collateralDelta > 0) {
            vault.lockMargin(msg.sender, collateralDelta);
            p.collateral += collateralDelta;
        }

        uint256 fee;
        if (sizeDeltaUsd > 0) {
            fee = (sizeDeltaUsd * feeManager.getFees().takerFee) / BPS;
            if (fee >= p.collateral) revert InsufficientCollateral();
            p.collateral -= fee;
            vault.settleLocked(msg.sender, fee, 0, fee, 0, address(0));

            uint256 sizeDelta = (sizeDeltaUsd * WAD) / price;
            if (sizeDelta == 0) revert InvalidParams();
            uint256 entryDelta = sizeDelta.notional(price);
            uint256 reserveDelta = (entryDelta * r.maxProfitBps) / BPS;
            p.size += sizeDelta;
            p.entryNotional += entryDelta;
            p.reserved += reserveDelta;
            if (p.entryNotional > r.maxPositionNotional) revert PositionLimitExceeded();
            if (_addOpenInterest(marketId, isLong, sizeDelta, entryDelta) > r.openInterestCap) {
                revert OpenInterestLimitExceeded();
            }
            vault.reserve(reserveDelta);
            _checkInitialMargin(p, isLong, price, r);
        }
        p.lastUpdated = uint64(block.timestamp);

        if (isNew) emit PerpPositionOpened(key, msg.sender, marketId, isLong, sizeDeltaUsd, p.collateral, price, fee);
        else emit PerpPositionUpdated(key, msg.sender, marketId, isLong, p.size, p.collateral, p.entryNotional, price, 0, fee);
    }

    /**
     * @notice Reduce a position by `sizeDeltaUsd` of notional at the current price and withdraw `collateralOut`.
     *         A size at or above the position's notional closes it completely.
     * @param acceptablePrice worst fill: the least a long sells at, the most a short buys back at
     */
    function decreasePosition(
        uint32 marketId,
        bool isLong,
        uint256 sizeDeltaUsd,
        uint256 collateralOut,
        uint256 acceptablePrice,
        uint64 deadline
    ) external nonReentrant whenNotPaused {
        _decrease(marketId, isLong, sizeDeltaUsd, collateralOut, acceptablePrice, deadline);
    }

    function closePosition(uint32 marketId, bool isLong, uint256 acceptablePrice, uint64 deadline)
        external
        nonReentrant
        whenNotPaused
    {
        _decrease(marketId, isLong, type(uint256).max, 0, acceptablePrice, deadline);
    }

    /// @notice Liquidate a position below its maintenance margin. Anyone may call; the caller earns the liquidation fee.
    function liquidate(address account, uint32 marketId, bool isLong) external nonReentrant whenNotPaused {
        IRiskManager.PerpRisk memory r = riskManager.getPerpRisk(marketId);
        uint256 price = _price(marketId, r);
        bytes32 key = positionKey(account, marketId, isLong);
        Position storage p = _positions[key];
        if (p.size == 0) revert NoPosition();
        _updateFunding(marketId, r);

        uint256 owed = _fundingOwed(p, _index(marketId, isLong));
        int256 pnl = _cappedPnl(p, isLong, price);
        uint256 notional = p.size.notional(price);
        int256 equity = int256(p.collateral) + pnl - int256(owed);
        if (equity >= int256((notional * r.maintenanceMarginBps) / BPS)) revert NotLiquidatable();

        uint256 reward = (notional * feeManager.getFees().liquidationFee) / BPS;
        if (reward > p.collateral) reward = p.collateral;
        uint256 returned = equity > int256(reward) ? uint256(equity) - reward : 0;

        uint256 collateral = p.collateral;
        vault.release(p.reserved);
        _removeOpenInterest(marketId, isLong, p.size, p.entryNotional);
        delete _positions[key];
        vault.settleLocked(account, collateral, returned, 0, reward, msg.sender);
        emit PositionLiquidated(key, account, marketId, isLong, price, equity, msg.sender, reward, returned);
    }

    /// @notice Accrue funding for a market. Called on every trade; anyone may also call it.
    function updateFunding(uint32 marketId) external {
        _updateFunding(marketId, riskManager.getPerpRisk(marketId));
    }

    // ---------------------------------------------------------------- views

    function positionKey(address account, uint32 marketId, bool isLong) public pure returns (bytes32) {
        return keccak256(abi.encode(account, marketId, isLong));
    }

    function getPosition(address account, uint32 marketId, bool isLong) external view returns (Position memory) {
        return _positions[positionKey(account, marketId, isLong)];
    }

    function getMarketState(uint32 marketId) external view returns (MarketState memory) {
        return _state[marketId];
    }

    /// @notice Funding rate per interval at the current skew; positive = longs pay, negative = shorts pay.
    function currentFundingRate(uint32 marketId) public view returns (int256) {
        return _fundingRate(_state[marketId], riskManager.getPerpRisk(marketId));
    }

    function nextFundingTime(uint32 marketId) external view returns (uint256) {
        MarketState storage s = _state[marketId];
        uint256 interval = riskManager.getPerpRisk(marketId).fundingInterval;
        if (s.lastFundingTime == 0) return block.timestamp + interval;
        uint256 periods = (block.timestamp - s.lastFundingTime) / interval + 1;
        return s.lastFundingTime + periods * interval;
    }

    function positionInfo(address account, uint32 marketId, bool isLong) external view returns (PositionInfo memory info) {
        Position storage p = _positions[positionKey(account, marketId, isLong)];
        if (p.size == 0) return info;
        IRiskManager.PerpRisk memory r = riskManager.getPerpRisk(marketId);
        (uint256 price,) = oracle.getPrice(_oracleId(marketId));
        (uint256 longIdx, uint256 shortIdx) = _pendingIndices(marketId, r);

        info.size = p.size;
        info.collateral = p.collateral;
        info.entryPrice = (p.entryNotional * WAD) / p.size;
        info.markPrice = price;
        info.notional = p.size.notional(price);
        info.pnl = _cappedPnl(p, isLong, price);
        info.fundingOwed = _fundingOwed(p, isLong ? longIdx : shortIdx);
        info.equity = int256(p.collateral) + info.pnl - int256(info.fundingOwed);
        info.leverageBps = info.equity > 0 ? (info.notional * BPS) / uint256(info.equity) : type(uint256).max;
        info.maintenanceMargin = (info.notional * r.maintenanceMarginBps) / BPS;
        info.liquidationPrice = MarginMath.liquidationPrice(
            isLong, p.size, p.entryNotional, p.collateral, info.fundingOwed, r.maintenanceMarginBps
        );
        info.liquidatable = info.equity < int256(info.maintenanceMargin);
    }

    /// @inheritdoc IPerpsEngine
    function totalTraderPnl() external view returns (int256 total) {
        uint256 n = registry.perpMarketCount();
        for (uint32 i; i < n; i++) {
            MarketState storage s = _state[i];
            if (s.longSize == 0 && s.shortSize == 0) continue;
            (uint256 price,) = oracle.getPrice(_oracleId(i));
            total += int256(s.longSize.notional(price)) - int256(s.longEntryNotional);
            total += int256(s.shortEntryNotional) - int256(s.shortSize.notional(price));
        }
    }

    // ---------------------------------------------------------------- internal: trading

    function _decrease(
        uint32 marketId,
        bool isLong,
        uint256 sizeDeltaUsd,
        uint256 collateralOut,
        uint256 acceptablePrice,
        uint64 deadline
    ) internal {
        IRiskManager.PerpRisk memory r = riskManager.getPerpRisk(marketId);
        uint256 price = _price(marketId, r);
        bytes32 key = positionKey(msg.sender, marketId, isLong);
        Position storage p = _positions[key];
        if (p.size == 0) revert NoPosition();
        _checkOrder(marketId, isLong, false, price, acceptablePrice, deadline);

        _updateFunding(marketId, r);
        _settleFunding(key, msg.sender, marketId, isLong, p);
        if (_isLiquidatable(p, isLong, price, r)) revert Liquidatable();

        bool full = sizeDeltaUsd >= p.size.notional(price);
        uint256 sizeDelta = full ? p.size : (sizeDeltaUsd * WAD) / price;
        if (sizeDelta == 0 && collateralOut == 0) revert InvalidParams();
        uint256 entryDelta = full ? p.entryNotional : (p.entryNotional * sizeDelta) / p.size;
        uint256 reserveDelta = full ? p.reserved : (p.reserved * sizeDelta) / p.size;

        int256 pnl = MarginMath.pnl(isLong, sizeDelta, entryDelta, price);
        if (pnl > int256(reserveDelta)) pnl = int256(reserveDelta); // profit cap
        uint256 fee = (sizeDelta.notional(price) * feeManager.getFees().takerFee) / BPS;

        vault.release(reserveDelta);
        _removeOpenInterest(marketId, isLong, sizeDelta, entryDelta);

        if (full) {
            // everything left in the position goes back to its owner after PnL and fees
            int256 remaining = int256(p.collateral) + pnl;
            uint256 toUser;
            if (remaining <= 0) {
                fee = 0;
            } else {
                if (fee > uint256(remaining)) fee = uint256(remaining);
                toUser = uint256(remaining) - fee;
            }
            uint256 collateral = p.collateral;
            delete _positions[key];
            vault.settleLocked(msg.sender, collateral, toUser, fee, 0, address(0));
            emit PerpPositionClosed(key, msg.sender, marketId, isLong, price, pnl, toUser, fee);
            return;
        }

        // partial: losses and fees come out of the margin, profits and withdrawn collateral go to the free balance
        uint256 loss = pnl < 0 ? uint256(-pnl) : 0;
        uint256 profit = pnl > 0 ? uint256(pnl) : 0;
        uint256 used = loss + fee + collateralOut;
        if (used > p.collateral) revert InsufficientCollateral();
        p.collateral -= used;
        p.size -= sizeDelta;
        p.entryNotional -= entryDelta;
        p.reserved -= reserveDelta;
        p.lastUpdated = uint64(block.timestamp);
        // taking margin out needs the initial margin; only shrinking needs the position to stay above maintenance
        if (collateralOut > 0) _checkInitialMargin(p, isLong, price, r);
        else if (_isLiquidatable(p, isLong, price, r)) revert InsufficientMargin();

        vault.settleLocked(msg.sender, used, collateralOut + profit, fee, 0, address(0));
        emit PerpPositionUpdated(key, msg.sender, marketId, isLong, p.size, p.collateral, p.entryNotional, price, pnl, fee);
    }

    function _checkOrder(
        uint32 marketId,
        bool isLong,
        bool increase,
        uint256 price,
        uint256 acceptablePrice,
        uint64 deadline
    ) internal view {
        if (!riskManager.tradingOpen(marketId)) revert MarketClosed();
        if (block.timestamp > deadline) revert DeadlineExpired();
        // buying (long open, short close) must not pay more than acceptable; selling must not receive less
        bool buying = isLong == increase;
        if (buying ? price > acceptablePrice : price < acceptablePrice) revert SlippageExceeded();
    }

    function _checkInitialMargin(Position storage p, bool isLong, uint256 price, IRiskManager.PerpRisk memory r)
        internal
        view
    {
        if (p.size == 0) return;
        uint256 notional = p.size.notional(price);
        if (notional > p.collateral * r.maxLeverage) revert LeverageTooHigh();
        int256 equity = int256(p.collateral) + _cappedPnl(p, isLong, price);
        if (equity < int256((notional * r.initialMarginBps) / BPS)) revert InsufficientMargin();
    }

    function _isLiquidatable(Position storage p, bool isLong, uint256 price, IRiskManager.PerpRisk memory r)
        internal
        view
        returns (bool)
    {
        int256 equity = int256(p.collateral) + _cappedPnl(p, isLong, price);
        return equity < int256((p.size.notional(price) * r.maintenanceMarginBps) / BPS);
    }

    function _cappedPnl(Position storage p, bool isLong, uint256 price) internal view returns (int256 pnl) {
        pnl = MarginMath.pnl(isLong, p.size, p.entryNotional, price);
        if (pnl > int256(p.reserved)) pnl = int256(p.reserved);
    }

    // ---------------------------------------------------------------- internal: prices & open interest

    function _oracleId(uint32 marketId) internal view returns (bytes32) {
        return registry.getAsset(registry.getPerpMarket(marketId).assetId).oracleId;
    }

    function _price(uint32 marketId, IRiskManager.PerpRisk memory r) internal view returns (uint256 price) {
        IMarketRegistry.PerpMarket memory m = registry.getPerpMarket(marketId);
        if (!m.active) revert MarketPaused();
        uint256 updatedAt;
        (price, updatedAt) = oracle.getPrice(registry.getAsset(m.assetId).oracleId);
        if (block.timestamp - updatedAt > r.maxPriceAge) revert StaleOraclePrice();
    }

    function _addOpenInterest(uint32 marketId, bool isLong, uint256 size, uint256 entry) internal returns (uint256) {
        MarketState storage s = _state[marketId];
        if (isLong) {
            s.longSize += size;
            return s.longEntryNotional += entry;
        }
        s.shortSize += size;
        return s.shortEntryNotional += entry;
    }

    function _removeOpenInterest(uint32 marketId, bool isLong, uint256 size, uint256 entry) internal {
        MarketState storage s = _state[marketId];
        if (isLong) {
            s.longSize -= size;
            s.longEntryNotional -= entry;
        } else {
            s.shortSize -= size;
            s.shortEntryNotional -= entry;
        }
    }

    // ---------------------------------------------------------------- internal: funding

    function _fundingRate(MarketState storage s, IRiskManager.PerpRisk memory r) internal view returns (int256) {
        uint256 total = s.longEntryNotional + s.shortEntryNotional;
        if (total == 0) return 0;
        int256 skew = ((int256(s.longEntryNotional) - int256(s.shortEntryNotional)) * int256(WAD)) / int256(total);
        return (skew * int256(uint256(r.fundingRatePerInterval))) / int256(WAD);
    }

    function _updateFunding(uint32 marketId, IRiskManager.PerpRisk memory r) internal {
        MarketState storage s = _state[marketId];
        if (s.lastFundingTime == 0) {
            s.lastFundingTime = uint64(block.timestamp);
            return;
        }
        uint256 periods = (block.timestamp - s.lastFundingTime) / r.fundingInterval;
        if (periods == 0) return;
        int256 rate = _fundingRate(s, r);
        if (rate > 0) s.longFundingIndex += uint256(rate) * periods;
        else if (rate < 0) s.shortFundingIndex += uint256(-rate) * periods;
        s.lastFundingTime += uint64(periods * r.fundingInterval);
        emit FundingUpdated(marketId, rate, s.longFundingIndex, s.shortFundingIndex);
    }

    function _pendingIndices(uint32 marketId, IRiskManager.PerpRisk memory r)
        internal
        view
        returns (uint256 longIdx, uint256 shortIdx)
    {
        MarketState storage s = _state[marketId];
        longIdx = s.longFundingIndex;
        shortIdx = s.shortFundingIndex;
        if (s.lastFundingTime == 0) return (longIdx, shortIdx);
        uint256 periods = (block.timestamp - s.lastFundingTime) / r.fundingInterval;
        int256 rate = _fundingRate(s, r);
        if (rate > 0) longIdx += uint256(rate) * periods;
        else if (rate < 0) shortIdx += uint256(-rate) * periods;
    }

    function _index(uint32 marketId, bool isLong) internal view returns (uint256) {
        MarketState storage s = _state[marketId];
        return isLong ? s.longFundingIndex : s.shortFundingIndex;
    }

    function _fundingOwed(Position storage p, uint256 index) internal view returns (uint256) {
        return (p.entryNotional * (index - p.fundingIndex)) / WAD;
    }

    /// Pays accrued funding out of the position's margin into the pool. More owed than margin means liquidation.
    function _settleFunding(bytes32 key, address account, uint32 marketId, bool isLong, Position storage p) internal {
        uint256 index = _index(marketId, isLong);
        uint256 owed = _fundingOwed(p, index);
        p.fundingIndex = index;
        if (owed == 0) return;
        if (owed >= p.collateral) revert Liquidatable();
        p.collateral -= owed;
        vault.settleLocked(account, owed, 0, 0, 0, address(0));
        emit FundingPaid(key, account, marketId, owed);
    }
}
