// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HanPerpOptions} from "../src/HanPerpOptions.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/**
 * Deploys HanPerpOptions and registers the asset catalogue.
 *
 * Environment:
 *   USDC_ADDRESS   USDC on the target chain. Leave empty on testnet to deploy an open-mint MockUSDC.
 *   BABA_FEED      Chainlink "Robinhood BABA / USD" proxy. Empty = BABA uses the signed oracle (testnet).
 *   OWNER          protocol owner (defaults to the deployer)
 *   TREASURY       fee receiver (defaults to the owner)
 *   PRICE_SIGNER   address whose EIP-712 signatures settle Signed markets
 *   FEE_BPS        protocol fee on premiums, default 30 (0.30%)
 *
 * Run (testnet):
 *   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --account hanperp-deployer --broadcast
 */
contract Deploy is Script {
    // keep in sync with web/src/data/assets.ts
    string[] internal hk = [
        "0700.HK", "9988.HK", "3690.HK", "1810.HK", "1211.HK", "9618.HK", "1024.HK", "0981.HK",
        "9999.HK", "9888.HK", "2015.HK", "2318.HK", "0941.HK", "0388.HK", "0005.HK"
    ];
    string[] internal adr = [
        "PDD", "JD", "BIDU", "NTES", "TCOM", "NIO", "LI", "XPEV", "BILI", "TME", "BEKE", "YUMC", "FUTU", "EDU",
        "FXI", "KWEB", "MCHI"
    ];

    function run() external returns (HanPerpOptions options, address usdc) {
        address deployer = msg.sender;
        address owner = vm.envOr("OWNER", deployer);
        address treasury = vm.envOr("TREASURY", owner);
        address priceSigner = vm.envAddress("PRICE_SIGNER");
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(30)));
        usdc = vm.envOr("USDC_ADDRESS", address(0));
        address babaFeed = vm.envOr("BABA_FEED", address(0));

        vm.startBroadcast();

        if (usdc == address(0)) {
            require(block.chainid != 4663, "set USDC_ADDRESS on mainnet");
            usdc = address(new MockUSDC());
            console2.log("MockUSDC", usdc);
        }

        // the deployer owns the contract while assets are registered, then hands over if OWNER differs
        options = new HanPerpOptions(IERC20(usdc), deployer, treasury, priceSigner, feeBps);

        if (babaFeed != address(0)) {
            options.addAsset("BABA", HanPerpOptions.OracleKind.Chainlink, babaFeed);
        } else {
            require(block.chainid != 4663, "set BABA_FEED on mainnet");
            options.addAsset("BABA", HanPerpOptions.OracleKind.Signed, address(0));
        }
        for (uint256 i; i < hk.length; i++) options.addAsset(hk[i], HanPerpOptions.OracleKind.Signed, address(0));
        for (uint256 i; i < adr.length; i++) options.addAsset(adr[i], HanPerpOptions.OracleKind.Signed, address(0));

        if (owner != deployer) options.transferOwnership(owner); // new owner must call acceptOwnership()

        vm.stopBroadcast();

        console2.log("HanPerpOptions", address(options));
        console2.log("USDC", usdc);
        console2.log("assets", options.assetCount());
    }
}
