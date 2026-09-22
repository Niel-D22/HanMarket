// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/**
 * @title Testnet price feed
 * @notice TESTNET ONLY. A Chainlink-compatible feed that the HanMarket keeper updates with the real market price
 *         (Robinhood's stock token API), because Chainlink publishes its "Robinhood X / USD" equity feeds on
 *         mainnet only. It lets perps run on testnet exactly as they will on mainnet. The deploy script refuses to
 *         use it on mainnet, where the real Chainlink feed is required.
 */
contract TestnetPriceFeed is AggregatorV3Interface {
    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    uint8 public immutable decimals;
    string public description;
    address public updater;
    uint80 public latestRound;
    mapping(uint80 => Round) internal _rounds;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
    event UpdaterSet(address updater);

    error NotUpdater();
    error InvalidAnswer();
    error NoData();

    constructor(uint8 decimals_, string memory description_, address updater_) {
        decimals = decimals_;
        description = description_;
        updater = updater_;
        emit UpdaterSet(updater_);
    }

    function setUpdater(address updater_) external {
        if (msg.sender != updater) revert NotUpdater();
        updater = updater_;
        emit UpdaterSet(updater_);
    }

    function push(int256 answer) external returns (uint80 roundId) {
        if (msg.sender != updater) revert NotUpdater();
        if (answer <= 0) revert InvalidAnswer();
        roundId = ++latestRound;
        _rounds[roundId] = Round(answer, block.timestamp);
        emit AnswerUpdated(answer, roundId, block.timestamp);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[roundId];
        if (r.updatedAt == 0) revert NoData();
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[latestRound];
        return (latestRound, r.answer, r.updatedAt, r.updatedAt, latestRound);
    }
}
