// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RiskManager} from "../src/risk/RiskManager.sol";
import {Vault} from "../src/core/Vault.sol";
import {OptionsEngine} from "../src/options/OptionsEngine.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {PerpsEngine} from "../src/perps/PerpsEngine.sol";
import {MarketRegistry} from "../src/core/MarketRegistry.sol";

/**
 * The launch rehearsal: every flow a real user and the keeper go through, run against a deployment on a LOCAL FORK of
 * mainnet (anvil), with the real settlement token and the real Chainlink BABA feed. Never point this at mainnet itself:
 * it refuses to run unless the RPC is a local anvil. deploy-mainnet.sh `rehearse` drives it, in three phases with the
 * chain's clock moved forward in between:
 *
 *   REHEARSAL_PHASE=trade    LP adds liquidity; keeper opens the BABA session and lists an option; trader deposits,
 *                            opens and closes a BABA perp at the live Chainlink price, buys an option, sells part back
 *   REHEARSAL_PHASE=settle   (past expiry) the option settles on a signed price, the trader redeems and withdraws
 *   REHEARSAL_PHASE=exit     (past the 24h LP lock) the LP takes half the liquidity back out
 *
 * Keys (anvil's test accounts): LP_KEY, TRADER_KEY, KEEPER_KEY, QUOTE_SIGNER_KEY, PRICE_SIGNER_KEY; DEPLOYMENT_FILE.
 */
contract Rehearsal is Script {
    uint256 constant ONE = 1e6;
    uint32 constant BABA_PERP = 0;
    uint32 constant HK_ASSET = 1; // 0700.HK, the first asset after BABA: priced by the HanMarket signer
    uint256 constant STRIKE = 50 * ONE;
    uint256 constant CAP = 10 * ONE;
    uint256 constant SETTLE_PRICE = 55 * ONE; // in the money by 5 a contract

    IERC20 token;
    MarketRegistry registry;
    RiskManager risk;
    Vault vault;
    OptionsEngine options;
    OracleRouter oracle;
    PerpsEngine perps;

    function run() external {
        require(vm.envOr("ANVIL_FORK", false), "rehearsal runs on a local anvil fork only");
        string memory json = vm.readFile(vm.envString("DEPLOYMENT_FILE"));
        token = IERC20(vm.parseJsonAddress(json, ".collateralToken"));
        registry = MarketRegistry(vm.parseJsonAddress(json, ".marketRegistry"));
        risk = RiskManager(vm.parseJsonAddress(json, ".riskManager"));
        vault = Vault(vm.parseJsonAddress(json, ".vault"));
        options = OptionsEngine(vm.parseJsonAddress(json, ".optionsEngine"));
        oracle = OracleRouter(vm.parseJsonAddress(json, ".oracleRouter"));
        perps = PerpsEngine(vm.parseJsonAddress(json, ".perpsEngine"));

        bytes32 phase = keccak256(bytes(vm.envString("REHEARSAL_PHASE")));
        if (phase == keccak256("trade")) _trade();
        else if (phase == keccak256("settle")) _settle();
        else if (phase == keccak256("exit")) _exit();
        else revert("REHEARSAL_PHASE must be trade, settle or exit");
        _solvent();
    }

    function _trade() internal {
        uint256 lpKey = vm.envUint("LP_KEY");
        uint256 traderKey = vm.envUint("TRADER_KEY");
        uint256 keeperKey = vm.envUint("KEEPER_KEY");
        address trader = vm.addr(traderKey);

        vm.startBroadcast(lpKey);
        token.approve(address(vault), type(uint256).max);
        uint256 shares = vault.addLiquidity(1_000 * ONE, 0);
        vm.stopBroadcast();
        console2.log("LP added 1,000; hmLP shares", shares);

        vm.startBroadcast(keeperKey);
        if (!risk.tradingOpen(BABA_PERP)) risk.setTradingOpen(BABA_PERP, true);
        uint256 seriesId = options.createSeries(HK_ASSET, true, STRIKE, CAP, uint64(block.timestamp + 1 hours), 30 minutes, 1 days);
        vm.stopBroadcast();
        console2.log("keeper opened BABA-PERP and listed series", seriesId);

        vm.startBroadcast(traderKey);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(150 * ONE);
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        // a 2x long, as large as the launch's own PERP_MAX_POSITION allows (up to $200), so the caps are tested too
        uint256 size = vm.envOr("PERP_MAX_POSITION", uint256(200));
        if (size > 200) size = 200;
        perps.increasePosition(BABA_PERP, true, (size / 2) * ONE, size * ONE, type(uint256).max, deadline);
        PerpsEngine.PositionInfo memory info = perps.positionInfo(trader, BABA_PERP, true);
        require(info.liquidationPrice > 0 && info.liquidationPrice < info.markPrice, "liquidation price");
        perps.closePosition(BABA_PERP, true, 0, deadline);
        require(perps.getPosition(trader, BABA_PERP, true).size == 0, "perp closed");
        console2.log("trader opened and closed a 2x BABA long at mark", info.markPrice);

        (OptionsEngine.Quote memory q, bytes memory sig) = _quote(seriesId, true, 2 * ONE, 5 * ONE);
        options.buy(5 * ONE, 2 * ONE, q, sig);
        (q, sig) = _quote(seriesId, false, 1_500_000, 2 * ONE);
        options.sell(2 * ONE, 1_500_000, q, sig);
        require(options.balanceOf(trader, seriesId) == 3 * ONE, "trader holds 3 contracts");
        vm.stopBroadcast();
        console2.log("trader bought 5 calls and sold 2 back");
    }

    function _settle() internal {
        uint256 traderKey = vm.envUint("TRADER_KEY");
        address trader = vm.addr(traderKey);
        uint256 seriesId = options.seriesCount() - 1;
        OptionsEngine.Series memory s = options.getSeries(seriesId);
        require(block.timestamp >= s.expiry, "move the clock past expiry first");

        // the keeper's job: a price signed by PRICE_SIGNER, published at expiry
        bytes32 oracleId = registry.getAsset(s.assetId).oracleId;
        (uint8 v, bytes32 r, bytes32 sg) =
            vm.sign(vm.envUint("PRICE_SIGNER_KEY"), oracle.settlementDigest(oracleId, s.expiry, SETTLE_PRICE, s.expiry));
        bytes memory data = abi.encode(SETTLE_PRICE, s.expiry, abi.encodePacked(r, sg, v));

        vm.startBroadcast(traderKey);
        options.settle(seriesId, data);
        uint256 before = vault.balances(trader);
        options.redeem(seriesId, 3 * ONE);
        uint256 payout = vault.balances(trader) - before;
        require(payout > 0 && payout <= 15 * ONE, "payout of 3 contracts at 5 each, less the fee");
        vault.withdraw(vault.balances(trader));
        vm.stopBroadcast();
        console2.log("series settled at 55; trader redeemed for", payout, "and withdrew everything");
    }

    function _exit() internal {
        uint256 lpKey = vm.envUint("LP_KEY");
        address lp = vm.addr(lpKey);
        uint256 shares = vault.balanceOf(lp);
        vm.startBroadcast(lpKey);
        uint256 out = vault.removeLiquidity(shares / 2, 0);
        vm.stopBroadcast();
        require(out > 0, "LP withdrawal");
        console2.log("LP took half the liquidity back out:", out);
    }

    function _quote(uint256 seriesId, bool isBuy, uint256 premium, uint256 maxQty)
        internal
        view
        returns (OptionsEngine.Quote memory q, bytes memory sig)
    {
        q = OptionsEngine.Quote(seriesId, isBuy, premium, maxQty, uint64(block.timestamp + 5 minutes));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(vm.envUint("QUOTE_SIGNER_KEY"), options.quoteDigest(q));
        sig = abi.encodePacked(r, s, v);
    }

    /// every token the vault holds is accounted for, and the pool covers what it has reserved
    function _solvent() internal view {
        require(vault.accountedAssets() == token.balanceOf(address(vault)), "vault accounting");
        require(vault.poolAmount() >= vault.reservedAmount(), "pool covers reservations");
        console2.log("vault solvent: holds", token.balanceOf(address(vault)));
    }
}
