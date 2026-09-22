// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {console2} from "forge-std/Test.sol";

import {BaseTest} from "./Base.t.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {PerpsEngine} from "../src/perps/PerpsEngine.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

/// Runs the protocol against the real Chainlink "Robinhood BABA / USD" feed on a fork of Robinhood Chain mainnet.
/// Only when ROBINHOOD_MAINNET_RPC is set:  forge test --match-contract Fork -vv
contract ForkTest is BaseTest {
    address constant BABA_FEED = 0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984;
    bool forked;

    function setUp() public override {
        string memory rpc = vm.envOr("ROBINHOOD_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        uint256 forkTime = vm.getBlockTimestamp(); // block.timestamp is cached under via-ir
        super.setUp(); // deploys everything with a mock feed and warps; point BABA at the real feed instead
        vm.warp(forkTime);
        vm.prank(owner);
        oracle.setChainlinkFeed(BABA_ID, BABA_FEED, 4 days);
    }

    function test_realFeedDrivesPerpsAndSettlement() public {
        if (!forked) {
            console2.log("skipped: ROBINHOOD_MAINNET_RPC not set");
            return;
        }
        assertEq(block.chainid, 4663);
        AggregatorV3Interface feed = AggregatorV3Interface(BABA_FEED);
        (uint80 latestId, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        (, int256 prevAnswer,, uint256 prevUpdated,) = feed.getRoundData(latestId - 1);

        // live price, 8 -> 6 decimals
        (uint256 price, uint256 ts) = oracle.getPrice(BABA_ID);
        assertEq(price, uint256(answer) / 100);
        assertEq(ts, updatedAt);
        console2.log("BABA index (6dp)", price, "updated", updatedAt);

        // a 2x long at the real price, closed straight away: the owner gets margin back minus two fees
        vm.prank(alice);
        perps.increasePosition(babaPerp, true, 1_000 * ONE, 2_000 * ONE, type(uint256).max, uint64(block.timestamp));
        PerpsEngine.PositionInfo memory info = perps.positionInfo(alice, babaPerp, true);
        console2.log("liquidation price (6dp)", info.liquidationPrice);
        assertGt(info.liquidationPrice, 0);
        assertLt(info.liquidationPrice, price);
        vm.prank(alice);
        perps.closePosition(babaPerp, true, 0, uint64(block.timestamp));
        assertApproxEqAbs(vault.balances(alice), 100_000 * ONE - 4 * ONE, 2);
        _assertSolvent();

        // settlement picks the round that was current at expiry and rejects the later one
        uint64 expiry = uint64(updatedAt - 1);
        uint32 window = uint32(updatedAt - prevUpdated + 1);
        vm.expectRevert(OracleRouter.BadRound.selector);
        oracle.settlementPrice(BABA_ID, expiry, window, abi.encode(latestId));
        assertEq(oracle.settlementPrice(BABA_ID, expiry, window, abi.encode(latestId - 1)), uint256(prevAnswer) / 100);
    }
}
