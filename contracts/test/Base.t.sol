// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

/// Deploys the whole protocol the way script/Deploy.s.sol does, with a mock USDC and a mock BABA feed.
abstract contract BaseTest is Test {
    uint256 constant ONE = 1e6; // one USDC, one contract
    bytes32 constant BABA_ID = keccak256("BABA/USD");
    bytes32 constant TENCENT_ID = keccak256("0700.HK/USD");

    MockUSDC usdc;
    MockAggregator babaFeed;
    MarketRegistry registry;
    OracleRouter oracle;
    FeeManager fees;
    RiskManager risk;
    Vault vault;
    OptionsEngine options;
    PerpsEngine perps;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address keeper = makeAddr("keeper");
    address lp = makeAddr("lp");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address liquidator = makeAddr("liquidator");
    address attacker = makeAddr("attacker");

    uint256 priceSignerKey = 0xA11CE;
    uint256 quoteSignerKey = 0xB0B;

    uint32 babaAsset;
    uint32 tencentAsset;
    uint32 babaPerp;

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        usdc = new MockUSDC();
        babaFeed = new MockAggregator(8);
        babaFeed.push(100e8, block.timestamp);

        registry = new MarketRegistry(owner);
        oracle = new OracleRouter(owner, vm.addr(priceSignerKey));
        fees = new FeeManager(
            owner,
            treasury,
            IFeeManager.FeeConfig({
                makerFee: 0,
                takerFee: 10,
                optionOpenFee: 100,
                optionCloseFee: 100,
                settlementFee: 0,
                liquidationFee: 50
            }),
            7_000
        );
        risk = new RiskManager(owner, keeper, 8_000);
        vault = new Vault(IERC20(address(usdc)), owner);
        options = new OptionsEngine(
            IMarketRegistry(address(registry)),
            IOracleRouter(address(oracle)),
            IVault(address(vault)),
            IFeeManager(address(fees)),
            IRiskManager(address(risk)),
            owner,
            vm.addr(quoteSignerKey),
            keeper
        );
        perps = new PerpsEngine(
            IMarketRegistry(address(registry)),
            IOracleRouter(address(oracle)),
            IVault(address(vault)),
            IFeeManager(address(fees)),
            IRiskManager(address(risk)),
            owner
        );

        vm.startPrank(owner);
        vault.setModules(IFeeManager(address(fees)), IRiskManager(address(risk)), IPerpsEngine(address(perps)));
        vault.setEngine(address(options), true);
        vault.setEngine(address(perps), true);
        vault.setLpLockPeriod(1 days);

        babaAsset = registry.addAsset("BABA", BABA_ID, address(0), true, true);
        tencentAsset = registry.addAsset("0700.HK", TENCENT_ID, address(0), true, false);
        oracle.setChainlinkFeed(BABA_ID, address(babaFeed), 2 days);
        oracle.setSignedFeed(TENCENT_ID);
        risk.setOptionsReserveCap(babaAsset, 500_000 * ONE);
        risk.setOptionsReserveCap(tencentAsset, 500_000 * ONE);

        babaPerp = registry.addPerpMarket("BABA-PERP", babaAsset);
        risk.setPerpRisk(babaPerp, _defaultRisk());
        risk.setTradingOpen(babaPerp, true);
        vm.stopPrank();

        _fund(lp, 2_000_000 * ONE);
        vm.prank(lp);
        vault.addLiquidity(1_000_000 * ONE, 0);
        _deposit(alice, 100_000 * ONE);
        _deposit(bob, 100_000 * ONE);
    }

    function _defaultRisk() internal pure returns (IRiskManager.PerpRisk memory) {
        return IRiskManager.PerpRisk({
            maxLeverage: 3,
            initialMarginBps: 3_334,
            maintenanceMarginBps: 1_000,
            maxProfitBps: 10_000,
            fundingInterval: 1 hours,
            maxPriceAge: 2 days,
            fundingRatePerInterval: 1e14, // 0.01% per hour at a fully one-sided market
            maxPositionNotional: 100_000 * ONE,
            openInterestCap: 1_000_000 * ONE
        });
    }

    // ------------------------------------------------------------ helpers

    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _deposit(address who, uint256 amount) internal {
        _fund(who, amount);
        vm.prank(who);
        vault.deposit(amount);
    }

    function _setBaba(uint256 price8) internal returns (uint80) {
        return babaFeed.push(int256(price8), block.timestamp);
    }

    function _quote(uint256 seriesId, bool isBuy, uint256 premium, uint256 maxQty)
        internal
        view
        returns (OptionsEngine.Quote memory q, bytes memory sig)
    {
        q = OptionsEngine.Quote(seriesId, isBuy, premium, maxQty, uint64(block.timestamp + 5 minutes));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(quoteSignerKey, options.quoteDigest(q));
        sig = abi.encodePacked(r, s, v);
    }

    function _signedPrice(bytes32 oracleId, uint64 expiry, uint256 price, uint64 publishTime, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, oracle.settlementDigest(oracleId, expiry, price, publishTime));
        return abi.encode(price, publishTime, abi.encodePacked(r, s, v));
    }

    /// every USDC the vault holds is accounted to a user, a position, the pool or a settled payout
    function _assertSolvent() internal view {
        assertEq(vault.accountedAssets(), usdc.balanceOf(address(vault)), "vault accounting");
        assertGe(vault.poolAmount(), vault.reservedAmount(), "pool covers reservations");
    }
}
