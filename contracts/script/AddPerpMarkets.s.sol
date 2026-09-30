// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {MarketRegistry} from "../src/core/MarketRegistry.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {RiskManager} from "../src/risk/RiskManager.sol";
import {IMarketRegistry} from "../src/interfaces/IMarketRegistry.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {TestnetPriceFeed} from "../src/testnet/TestnetPriceFeed.sol";

/**
 * Opens more perpetual markets on an existing TESTNET deployment, without redeploying anything.
 *
 * A perp needs a live onchain price. On mainnet that means a Chainlink feed, and among China equities only BABA has one,
 * so this script refuses to run anywhere but the testnet (46630). There, each listed asset gets a TestnetPriceFeed that
 * the keeper updates from market data (api/src/keeper.ts pushTestnetFeeds finds it by its updater), exactly as BABA does.
 *
 * For each symbol: deploy the feed and seed it, point the asset's oracle at it, allow perps on the asset, register
 * "<SYMBOL>-PERP", and copy BABA-PERP's risk limits. Symbols that already have a perp are skipped, so it is safe to rerun.
 * Note the asset's options then settle from this feed as well, instead of the signed price.
 *
 *   TESTNET_DEPLOYMENT  the deployment JSON (same as the web app's)
 *   SYMBOLS             comma-separated, e.g. "PDD,JD,BIDU,NIO,0700.HK"
 *   PRICES              the matching USD prices with 8 decimals, e.g. "10250000000,..." (seeds each feed)
 *   KEEPER              updater of the new feeds (defaults to the broadcaster)
 *
 *   forge script script/AddPerpMarkets.s.sol --rpc-url <testnet rpc> --private-key <owner key> --broadcast
 */
contract AddPerpMarkets is Script {
    function run() external {
        require(block.chainid == 46630, "testnet only: mainnet perps need a real Chainlink feed");

        string memory json = vm.envString("TESTNET_DEPLOYMENT");
        MarketRegistry registry = MarketRegistry(vm.parseJsonAddress(json, ".marketRegistry"));
        OracleRouter oracle = OracleRouter(vm.parseJsonAddress(json, ".oracleRouter"));
        RiskManager risk = RiskManager(vm.parseJsonAddress(json, ".riskManager"));

        string[] memory symbols = vm.envString("SYMBOLS", ",");
        uint256[] memory prices = vm.envUint("PRICES", ",");
        require(symbols.length == prices.length, "SYMBOLS and PRICES differ in length");

        IRiskManager.PerpRisk memory template = risk.getPerpRisk(0); // BABA-PERP
        uint32 maxAge = template.maxPriceAge;

        vm.startBroadcast();
        address keeper = vm.envOr("KEEPER", msg.sender);

        for (uint256 i; i < symbols.length; i++) {
            (bool found, uint32 assetId, IMarketRegistry.Asset memory a) = _findAsset(registry, symbols[i]);
            if (!found) {
                console2.log("skip, not listed:", symbols[i]);
                continue;
            }
            if (_hasPerp(registry, assetId)) {
                console2.log("skip, already has a perp:", symbols[i]);
                continue;
            }
            require(prices[i] > 0, "price must be positive");

            TestnetPriceFeed feed =
                new TestnetPriceFeed(8, string.concat(symbols[i], " / USD (testnet, updated by the HanMarket keeper)"), msg.sender);
            feed.push(int256(prices[i]));
            if (keeper != msg.sender) feed.setUpdater(keeper);

            oracle.setChainlinkFeed(a.oracleId, address(feed), maxAge);
            registry.updateAsset(assetId, a.optionsEnabled, true, a.active);
            uint32 marketId = registry.addPerpMarket(string.concat(symbols[i], "-PERP"), assetId);
            risk.setPerpRisk(marketId, template);

            console2.log(string.concat(symbols[i], "-PERP market"), marketId);
            console2.log(string.concat(symbols[i], " feed"), address(feed));
        }
        vm.stopBroadcast();
    }

    function _findAsset(MarketRegistry registry, string memory symbol)
        internal
        view
        returns (bool, uint32, IMarketRegistry.Asset memory a)
    {
        uint256 n = registry.assetCount();
        for (uint32 id; id < n; id++) {
            a = registry.getAsset(id);
            if (keccak256(bytes(a.symbol)) == keccak256(bytes(symbol))) return (true, id, a);
        }
        return (false, 0, a);
    }

    function _hasPerp(MarketRegistry registry, uint32 assetId) internal view returns (bool) {
        uint256 n = registry.perpMarketCount();
        for (uint32 m; m < n; m++) {
            if (registry.getPerpMarket(m).assetId == assetId) return true;
        }
        return false;
    }
}
