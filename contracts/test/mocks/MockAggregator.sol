// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";

/// @notice Chainlink-style feed with a round history, for tests.
contract MockAggregator is AggregatorV3Interface {
    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    uint8 public immutable override decimals;
    uint80 public latestRound;
    mapping(uint80 => Round) public rounds;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function description() external pure returns (string memory) {
        return "Mock / USD";
    }

    function push(int256 answer, uint256 updatedAt) external returns (uint80 roundId) {
        roundId = ++latestRound;
        rounds[roundId] = Round(answer, updatedAt);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[roundId];
        require(r.updatedAt != 0, "No data present");
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[latestRound];
        return (latestRound, r.answer, r.updatedAt, r.updatedAt, latestRound);
    }
}
