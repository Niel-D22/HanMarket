// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

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

interface IOwnable2Step {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
}

/**
 * Reads a deployment back and checks every setting against what it was meant to be. Read-only: it sends nothing.
 * Prints one line per check and fails (non-zero exit) if any is wrong.
 *
 *   DEPLOYMENT_FILE   the JSON Deploy.s.sol printed (deployments/mainnet-4663.json)
 *   OWNER_STAGE       "pending" right after the deploy (the Safe has not accepted yet), "accepted" once it has
 *   plus the same OWNER, TREASURY, KEEPER, PRICE_SIGNER, QUOTE_SIGNER, USDC_ADDRESS, BABA_FEED, PERP_* and cap
 *   variables the deploy used, so this checks the chain against the intended configuration, not against itself.
 *
 *   forge script script/VerifyDeployment.s.sol --rpc-url <rpc>
 */
contract VerifyDeployment is Script {
    uint256 constant ONE = 1e6;
    uint256 failures;

    function run() external {
        string memory json = vm.readFile(vm.envString("DEPLOYMENT_FILE"));
        MarketRegistry registry = MarketRegistry(vm.parseJsonAddress(json, ".marketRegistry"));
        OracleRouter oracle = OracleRouter(vm.parseJsonAddress(json, ".oracleRouter"));
        FeeManager fees = FeeManager(vm.parseJsonAddress(json, ".feeManager"));
        RiskManager risk = RiskManager(vm.parseJsonAddress(json, ".riskManager"));
        Vault vault = Vault(vm.parseJsonAddress(json, ".vault"));
        OptionsEngine options = OptionsEngine(vm.parseJsonAddress(json, ".optionsEngine"));
        PerpsEngine perps = PerpsEngine(vm.parseJsonAddress(json, ".perpsEngine"));
        address token = vm.parseJsonAddress(json, ".collateralToken");

        address owner = vm.envAddress("OWNER");
        address treasury = vm.envOr("TREASURY", owner);
        bool accepted = keccak256(bytes(vm.envOr("OWNER_STAGE", string("pending")))) == keccak256("accepted");

        console2.log("chain", block.chainid);
        _check(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(4663)), "chain id");

        // ownership: every contract handed to the Safe (Ownable2Step: pending until the Safe calls acceptOwnership)
        address[7] memory owned =
            [address(registry), address(oracle), address(fees), address(risk), address(vault), address(options), address(perps)];
        string[7] memory names = ["MarketRegistry", "OracleRouter", "FeeManager", "RiskManager", "Vault", "OptionsEngine", "PerpsEngine"];
        for (uint256 i; i < 7; i++) {
            _check(owned[i].code.length > 0, string.concat(names[i], " is deployed"));
            IOwnable2Step o = IOwnable2Step(owned[i]);
            if (accepted) _check(o.owner() == owner, string.concat(names[i], " owned by the Safe"));
            else _check(o.pendingOwner() == owner, string.concat(names[i], " pending owner is the Safe"));
        }

        // roles
        _check(token == vm.envAddress("USDC_ADDRESS"), "settlement token is USDC_ADDRESS");
        _check(address(vault.collateralToken()) == token, "vault holds the settlement token");
        _check(risk.keeper() == vm.envAddress("KEEPER"), "risk keeper");
        _check(options.keeper() == vm.envAddress("KEEPER"), "options keeper");
        _check(options.quoteSigner() == vm.envAddress("QUOTE_SIGNER"), "quote signer");
        _check(oracle.priceSigner() == vm.envAddress("PRICE_SIGNER"), "price signer");
        _check(fees.treasury() == treasury, "treasury");

        // wiring between the contracts
        _check(vault.isEngine(address(options)) && vault.isEngine(address(perps)), "vault trusts both engines");
        _check(address(vault.feeManager()) == address(fees), "vault fee manager");
        _check(address(vault.riskManager()) == address(risk), "vault risk manager");
        _check(address(vault.perpsEngine()) == address(perps), "vault perps engine");
        _check(address(options.registry()) == address(registry) && address(options.oracle()) == address(oracle), "options wiring");
        _check(address(perps.registry()) == address(registry) && address(perps.oracle()) == address(oracle), "perps wiring");
        _check(vault.lpLockPeriod() == 1 days, "LP deposits lock for 24 hours");

        // fees, as set in Deploy.s.sol
        IFeeManager.FeeConfig memory f = fees.getFees();
        _check(f.takerFee == 8 && f.optionOpenFee == 100 && f.optionCloseFee == 100 && f.liquidationFee == 50, "fee schedule");
        _check(fees.lpShareBps() == 7_000, "70% of fees to LPs");

        // markets
        _check(registry.assetCount() == 33, "33 assets listed");
        _check(registry.perpMarketCount() == 1, "one perp market");
        IMarketRegistry.PerpMarket memory m = registry.getPerpMarket(0);
        IMarketRegistry.Asset memory baba = registry.getAsset(m.assetId);
        _check(keccak256(bytes(baba.symbol)) == keccak256("BABA") && m.active, "BABA-PERP on BABA");
        OracleRouter.Feed memory feed = oracle.getFeed(baba.oracleId);
        _check(feed.aggregator == vm.envAddress("BABA_FEED") && feed.source == OracleRouter.Source.Chainlink, "BABA priced by Chainlink");
        (uint256 price, uint256 at) = oracle.getPrice(baba.oracleId);
        _check(price > 0 && block.timestamp - at < 3 days, "BABA price is live");
        console2.log("BABA index (6 decimals)", price);

        // risk, as intended
        IRiskManager.PerpRisk memory r = risk.getPerpRisk(0);
        _check(r.maxLeverage == vm.envOr("PERP_MAX_LEVERAGE", uint256(3)), "max leverage");
        _check(r.initialMarginBps == vm.envOr("PERP_INITIAL_MARGIN_BPS", uint256(3_334)), "initial margin");
        _check(r.maintenanceMarginBps == vm.envOr("PERP_MAINTENANCE_MARGIN_BPS", uint256(1_000)), "maintenance margin");
        _check(r.maxPositionNotional == vm.envOr("PERP_MAX_POSITION", uint256(50_000)) * ONE, "max position");
        _check(r.openInterestCap == vm.envOr("PERP_OI_CAP", uint256(500_000)) * ONE, "open interest cap");
        _check(risk.maxUtilizationBps() == vm.envOr("MAX_UTILIZATION_BPS", uint256(8_000)), "max utilization");
        _check(risk.optionsReserveCap(m.assetId) == vm.envOr("OPTIONS_RESERVE_CAP", uint256(100_000)) * ONE, "options reserve cap");

        console2.log("");
        if (failures == 0) console2.log("ALL CHECKS PASSED");
        else console2.log("FAILED CHECKS:", failures);
        require(failures == 0, "deployment does not match the intended configuration");
    }

    function _check(bool ok, string memory what) internal {
        console2.log(ok ? "  [ok]  " : "  [FAIL]", what);
        if (!ok) failures++;
    }
}
