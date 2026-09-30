// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {MarketRegistry} from "../src/core/MarketRegistry.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {FeeManager} from "../src/core/FeeManager.sol";
import {RiskManager} from "../src/risk/RiskManager.sol";
import {Vault} from "../src/core/Vault.sol";
import {OptionsEngine} from "../src/options/OptionsEngine.sol";
import {PerpsEngine} from "../src/perps/PerpsEngine.sol";
import {IFeeManager} from "../src/interfaces/IFeeManager.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {IMarketRegistry} from "../src/interfaces/IMarketRegistry.sol";
import {IOracleRouter} from "../src/interfaces/IOracleRouter.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {IPerpsEngine} from "../src/interfaces/IPerpsEngine.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";
import {TestnetPriceFeed} from "../src/testnet/TestnetPriceFeed.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

/**
 * Deploys the whole protocol, registers the asset catalogue and opens BABA-PERP.
 *
 * Environment:
 *   USDC_ADDRESS    settlement token. Empty on testnet = deploy an open-mint MockUSDC and seed the pool.
 *   BABA_FEED       Chainlink "Robinhood BABA / USD" (mainnet only). Empty on testnet = deploy a TestnetPriceFeed that
 *                   the keeper updates with the Robinhood price, so BABA-PERP runs on testnet as on mainnet.
 *   BABA_PRICE      testnet only: first price for that feed, 8 decimals (the keeper refreshes it within a minute)
 *   OWNER           protocol owner, ideally a multisig (defaults to the deployer; must call acceptOwnership)
 *   TREASURY        fee receiver (defaults to OWNER)
 *   PRICE_SIGNER    signs settlement prices for assets without a Chainlink feed
 *   QUOTE_SIGNER    signs option quotes (the pricing service)
 *   KEEPER          creates series and opens/closes perp sessions
 *   SEED_LIQUIDITY  testnet only: MockUSDC minted into the pool, default 1,000,000
 *
 * Risk limits, in whole dollars (defaults are the testnet's; size them to the pool's real capital on mainnet):
 *   PERP_MAX_POSITION      largest single BABA-PERP position, notional        (default 50,000)
 *   PERP_OI_CAP            open interest cap per side of BABA-PERP            (default 500,000)
 *   OPTIONS_RESERVE_CAP    most the vault may reserve for one asset's options (default 100,000)
 *   MAX_UTILIZATION_BPS    share of the pool that open positions may reserve  (default 8,000 = 80%)
 *
 * On mainnet (chain 4663) the script refuses to run unless OWNER is a contract (the Safe multisig), the keeper and the
 * signers are separate from it, the settlement token has 6 decimals and BABA_FEED is a live 8-decimal Chainlink feed.
 * Run it through contracts/script/mainnet/deploy-mainnet.sh, which checks all of this before anything is sent.
 *
 *   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --private-key $KEY --broadcast
 */
contract Deploy is Script {
    uint256 constant ONE = 1e6;

    // keep in sync with web/src/data/assets.ts
    string[] internal hk = [
        "0700.HK", "9988.HK", "3690.HK", "1810.HK", "1211.HK", "9618.HK", "1024.HK", "0981.HK",
        "9999.HK", "9888.HK", "2015.HK", "2318.HK", "0941.HK", "0388.HK", "0005.HK"
    ];
    string[] internal adr = [
        "PDD", "JD", "BIDU", "NTES", "TCOM", "NIO", "LI", "XPEV", "BILI", "TME", "BEKE", "YUMC", "FUTU", "EDU",
        "FXI", "KWEB", "MCHI"
    ];

    struct Deployed {
        address usdc;
        MarketRegistry registry;
        OracleRouter oracle;
        FeeManager fees;
        RiskManager risk;
        Vault vault;
        OptionsEngine options;
        PerpsEngine perps;
    }

    function run() external returns (Deployed memory d) {
        address deployer = msg.sender;
        address owner = vm.envOr("OWNER", deployer);
        address treasury = vm.envOr("TREASURY", owner);
        address priceSigner = vm.envAddress("PRICE_SIGNER");
        address quoteSigner = vm.envAddress("QUOTE_SIGNER");
        address keeper = vm.envAddress("KEEPER");
        address babaFeed = vm.envOr("BABA_FEED", address(0));
        d.usdc = vm.envOr("USDC_ADDRESS", address(0));
        bool mainnet = block.chainid == 4663;
        uint256 startBlock = block.number;
        if (mainnet) _mainnetGuards(deployer, owner, treasury, keeper, priceSigner, quoteSigner, d.usdc, babaFeed);

        vm.startBroadcast();

        bool mock = d.usdc == address(0);
        if (mock) {
            require(!mainnet, "set USDC_ADDRESS on mainnet");
            d.usdc = address(new MockUSDC());
        }
        require(!mainnet || babaFeed != address(0), "set BABA_FEED on mainnet");
        if (babaFeed == address(0)) {
            TestnetPriceFeed feed = new TestnetPriceFeed(8, "BABA / USD (testnet, updated by the HanMarket keeper)", deployer);
            feed.push(int256(vm.envOr("BABA_PRICE", uint256(110e8))));
            feed.setUpdater(keeper);
            babaFeed = address(feed);
            console2.log("TestnetPriceFeed BABA", babaFeed);
        }

        // the deployer configures everything, then hands ownership to OWNER
        d.registry = new MarketRegistry(deployer);
        d.oracle = new OracleRouter(deployer, priceSigner);
        d.fees = new FeeManager(
            deployer,
            treasury,
            IFeeManager.FeeConfig({
                makerFee: 0,
                takerFee: 8, // 0.08% of notional
                optionOpenFee: 100, // 1% of premium
                optionCloseFee: 100,
                settlementFee: 0,
                liquidationFee: 50 // 0.5% of notional, to the liquidator
            }),
            7_000 // 70% of fees to LPs
        );
        d.risk = new RiskManager(deployer, keeper, uint16(vm.envOr("MAX_UTILIZATION_BPS", uint256(8_000))));
        d.vault = new Vault(IERC20(d.usdc), deployer);
        d.options = new OptionsEngine(
            IMarketRegistry(address(d.registry)),
            IOracleRouter(address(d.oracle)),
            IVault(address(d.vault)),
            IFeeManager(address(d.fees)),
            IRiskManager(address(d.risk)),
            deployer,
            quoteSigner,
            keeper
        );
        d.perps = new PerpsEngine(
            IMarketRegistry(address(d.registry)),
            IOracleRouter(address(d.oracle)),
            IVault(address(d.vault)),
            IFeeManager(address(d.fees)),
            IRiskManager(address(d.risk)),
            deployer
        );

        d.vault.setModules(IFeeManager(address(d.fees)), IRiskManager(address(d.risk)), IPerpsEngine(address(d.perps)));
        d.vault.setEngine(address(d.options), true);
        d.vault.setEngine(address(d.perps), true);
        d.vault.setLpLockPeriod(1 days);

        // assets: every one gets options; only BABA has an onchain price, so only BABA gets a perp
        uint32 baba = _asset(d, "BABA", babaFeed);
        for (uint256 i; i < hk.length; i++) _asset(d, hk[i], address(0));
        for (uint256 i; i < adr.length; i++) _asset(d, adr[i], address(0));

        {
            // Leverage is a risk setting, not a ceiling in the code. The defaults are the conservative ones: 3x needs 33%
            // initial margin against a 10% maintenance margin, a wide cushion. 10x needs 10% initial margin, so the
            // maintenance margin has to come down with it (5% below) and a gap through it becomes a loss for the pool.
            // A testnet that should show 10x sets PERP_MAX_LEVERAGE=10 PERP_INITIAL_MARGIN_BPS=1000
            // PERP_MAINTENANCE_MARGIN_BPS=500; a mainnet deploy should only move off the defaults on purpose.
            uint256 maxLev = vm.envOr("PERP_MAX_LEVERAGE", uint256(3));
            uint256 initialMargin = vm.envOr("PERP_INITIAL_MARGIN_BPS", uint256(3_334));
            uint256 maintenanceMargin = vm.envOr("PERP_MAINTENANCE_MARGIN_BPS", uint256(1_000));
            require(maxLev <= 50 && initialMargin <= 10_000 && maintenanceMargin < initialMargin, "bad PERP_* margin env");

            uint32 perp = d.registry.addPerpMarket("BABA-PERP", baba);
            d.risk.setPerpRisk(
                perp,
                IRiskManager.PerpRisk({
                    maxLeverage: uint16(maxLev),
                    initialMarginBps: uint16(initialMargin),
                    maintenanceMarginBps: uint16(maintenanceMargin),
                    maxProfitBps: 10_000,
                    fundingInterval: 1 hours,
                    maxPriceAge: 3 days, // the feed updates on a 0.5% move or once a day; weekends are covered by sessions
                    fundingRatePerInterval: 1e14, // 0.01% per hour at a fully one-sided market
                    maxPositionNotional: vm.envOr("PERP_MAX_POSITION", uint256(50_000)) * ONE,
                    openInterestCap: vm.envOr("PERP_OI_CAP", uint256(500_000)) * ONE
                })
            );
            console2.log("BABA-PERP market", perp);
        }

        if (mock) {
            uint256 seed = vm.envOr("SEED_LIQUIDITY", 1_000_000 * ONE);
            MockUSDC(d.usdc).mint(deployer, seed);
            IERC20(d.usdc).approve(address(d.vault), seed);
            d.vault.addLiquidity(seed, 0);
        }

        if (owner != deployer) {
            d.registry.transferOwnership(owner);
            d.oracle.transferOwnership(owner);
            d.fees.transferOwnership(owner);
            d.risk.transferOwnership(owner);
            d.vault.transferOwnership(owner);
            d.options.transferOwnership(owner);
            d.perps.transferOwnership(owner);
        }

        vm.stopBroadcast();

        console2.log("USDC            ", d.usdc);
        console2.log("MarketRegistry  ", address(d.registry));
        console2.log("OracleRouter    ", address(d.oracle));
        console2.log("FeeManager      ", address(d.fees));
        console2.log("RiskManager     ", address(d.risk));
        console2.log("Vault           ", address(d.vault));
        console2.log("OptionsEngine   ", address(d.options));
        console2.log("PerpsEngine     ", address(d.perps));
        console2.log("assets          ", d.registry.assetCount());
        console2.log("");
        console2.log("Paste into VITE_*_DEPLOYMENT (web) and *_DEPLOYMENT (api):");
        console2.log(_json(d, startBlock));
    }

    function _json(Deployed memory d, uint256 startBlock) internal view returns (string memory) {
        return string.concat(
            '{"collateralToken":"', vm.toString(d.usdc),
            '","marketRegistry":"', vm.toString(address(d.registry)),
            '","oracleRouter":"', vm.toString(address(d.oracle)),
            '","feeManager":"', vm.toString(address(d.fees)),
            '","riskManager":"', vm.toString(address(d.risk)),
            '","vault":"', vm.toString(address(d.vault)),
            '","optionsEngine":"', vm.toString(address(d.options)),
            '","perpsEngine":"', vm.toString(address(d.perps)),
            '","startBlock":', vm.toString(startBlock), "}"
        );
    }

    function _asset(Deployed memory d, string memory symbol, address feed) internal returns (uint32 id) {
        bytes32 oracleId = keccak256(abi.encodePacked(symbol, "/USD"));
        bool live = feed != address(0);
        id = d.registry.addAsset(symbol, oracleId, address(0), true, live);
        if (live) d.oracle.setChainlinkFeed(oracleId, feed, 3 days);
        else d.oracle.setSignedFeed(oracleId);
        d.risk.setOptionsReserveCap(id, vm.envOr("OPTIONS_RESERVE_CAP", uint256(100_000)) * ONE);
    }

    /// Mainnet only: stop before the first transaction if any input is the kind of mistake that cannot be undone.
    function _mainnetGuards(
        address deployer,
        address owner,
        address treasury,
        address keeper,
        address priceSigner,
        address quoteSigner,
        address token,
        address babaFeed
    ) internal view {
        require(owner != deployer && owner.code.length > 0, "mainnet: OWNER must be the Safe multisig (a contract)");
        require(treasury != deployer, "mainnet: TREASURY must not be the deployer");
        require(keeper != owner && keeper != deployer, "mainnet: KEEPER must be its own key");
        require(priceSigner != address(0) && quoteSigner != address(0), "mainnet: set PRICE_SIGNER and QUOTE_SIGNER");
        require(priceSigner != owner && quoteSigner != owner, "mainnet: signers must not be the owner");
        require(token != address(0) && token.code.length > 0, "mainnet: USDC_ADDRESS has no contract");
        require(IERC20Metadata(token).decimals() == 6, "mainnet: settlement token must have 6 decimals");
        require(babaFeed.code.length > 0, "mainnet: BABA_FEED has no contract");
        require(AggregatorV3Interface(babaFeed).decimals() == 8, "mainnet: BABA_FEED must have 8 decimals");
        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(babaFeed).latestRoundData();
        require(answer > 0 && block.timestamp - updatedAt < 3 days, "mainnet: BABA_FEED is not live");
    }
}
