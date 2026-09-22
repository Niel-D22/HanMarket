// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HanPerpOptions} from "../src/HanPerpOptions.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Settles against the real Chainlink "Robinhood BABA / USD" feed on a fork of Robinhood Chain mainnet.
/// Runs only when ROBINHOOD_MAINNET_RPC is set:  forge test --match-contract HanPerpFork -vv
contract HanPerpForkTest is Test {
    address constant BABA_FEED = 0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984;
    uint256 constant ONE = 1e6;

    function test_settlesWithRealBabaFeed() public {
        string memory rpc = vm.envOr("ROBINHOOD_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            console2.log("skipped: ROBINHOOD_MAINNET_RPC not set");
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 4663);

        AggregatorV3Interface feed = AggregatorV3Interface(BABA_FEED);
        (uint80 latestId, int256 latestAnswer,, uint256 latestUpdated,) = feed.latestRoundData();
        (, int256 prevAnswer,, uint256 prevUpdated,) = feed.getRoundData(latestId - 1);
        console2.log("BABA latest", uint256(latestAnswer), latestUpdated);
        console2.log("BABA previous", uint256(prevAnswer), prevUpdated);
        assertGt(latestUpdated, prevUpdated);

        MockUSDC usdc = new MockUSDC();
        HanPerpOptions options = new HanPerpOptions(IERC20(address(usdc)), address(this), address(this), address(1), 30);
        uint32 baba = options.addAsset("BABA", HanPerpOptions.OracleKind.Chainlink, BABA_FEED);

        // expiry sits between the previous and latest rounds, so the previous round is the settlement round
        uint64 expiry = uint64(latestUpdated - 1);
        vm.warp(prevUpdated - 1);
        uint256 id = options.createMarket(baba, true, 100 * ONE, 30 * ONE, expiry, 1 days, 3 days);
        vm.warp(latestUpdated + 60);

        vm.expectRevert(HanPerpOptions.BadRound.selector); // latest round was published after expiry
        options.settleWithChainlink(id, latestId);

        options.settleWithChainlink(id, latestId - 1);
        HanPerpOptions.Market memory m = options.getMarket(id);
        assertEq(m.settlementPrice, uint256(prevAnswer) / 100); // 8 -> 6 decimals
        console2.log("settled at (6dp)", m.settlementPrice, "payout", m.payoutPerContract);
    }
}
