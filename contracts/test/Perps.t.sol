// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {BaseTest} from "./Base.t.sol";
import {PerpsEngine} from "../src/perps/PerpsEngine.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";

contract PerpsTest is BaseTest {
    function _open(address who, bool isLong, uint256 collateral, uint256 size) internal {
        vm.prank(who);
        perps.increasePosition(
            babaPerp, isLong, collateral, size, isLong ? type(uint256).max : 0, uint64(block.timestamp)
        );
    }

    function _close(address who, bool isLong) internal {
        vm.prank(who);
        perps.closePosition(babaPerp, isLong, isLong ? 0 : type(uint256).max, uint64(block.timestamp));
    }

    // ------------------------------------------------------------ open & close

    function test_longProfit() public {
        _open(alice, true, 4_000 * ONE, 10_000 * ONE); // 100 shares at 100, fee 10
        PerpsEngine.Position memory p = perps.getPosition(alice, babaPerp, true);
        assertEq(p.size, 100e18);
        assertEq(p.collateral, 3_990 * ONE);
        assertEq(p.entryNotional, 10_000 * ONE);
        assertEq(vault.lockedMargin(alice), 3_990 * ONE);

        _setBaba(110e8);
        _close(alice, true); // +1,000 PnL, fee 11
        assertEq(vault.balances(alice), 100_000 * ONE - 4_000 * ONE + 3_990 * ONE + 1_000 * ONE - 11 * ONE);
        assertEq(vault.lockedMargin(alice), 0);
        assertEq(vault.reservedAmount(), 0);
        assertEq(perps.getPosition(alice, babaPerp, true).size, 0);
        _assertSolvent();
    }

    function test_shortLoss() public {
        _open(bob, false, 3_000 * ONE, 6_000 * ONE); // 60 shares short at 100
        _setBaba(105e8);
        _close(bob, false); // -300 PnL, fee 6.30
        assertEq(vault.balances(bob), 100_000 * ONE - 6 * ONE - 300 * ONE - 6_300_000);
        _assertSolvent();
    }

    function test_partialDecreaseRealisesProportionally() public {
        _open(alice, true, 4_000 * ONE, 10_000 * ONE);
        _setBaba(110e8);
        vm.prank(alice);
        perps.decreasePosition(babaPerp, true, 5_500 * ONE, 0, 0, uint64(block.timestamp)); // half the position

        PerpsEngine.Position memory p = perps.getPosition(alice, babaPerp, true);
        assertEq(p.size, 50e18);
        assertEq(p.entryNotional, 5_000 * ONE);
        assertEq(p.collateral, 3_990 * ONE - 5_500_000); // fee 5.50 from margin
        assertEq(vault.balances(alice), 96_000 * ONE + 500 * ONE); // half the profit to the free balance
        assertEq(vault.reservedAmount(), 5_000 * ONE);
        _assertSolvent();
    }

    function test_increaseAveragesEntry() public {
        _open(alice, true, 4_000 * ONE, 3_000 * ONE); // 30 shares at 100
        _setBaba(120e8);
        _open(alice, true, 0, 3_000 * ONE); // 25 shares at 120
        PerpsEngine.Position memory p = perps.getPosition(alice, babaPerp, true);
        assertEq(p.size, 55e18);
        assertEq(p.entryNotional, 6_000 * ONE);
    }

    // ------------------------------------------------------------ risk limits

    function test_leverageAndSizeLimits() public {
        vm.startPrank(alice);
        vm.expectRevert(PerpsEngine.LeverageTooHigh.selector); // 3x max
        perps.increasePosition(babaPerp, true, 1_000 * ONE, 3_500 * ONE, type(uint256).max, uint64(block.timestamp));

        vm.expectRevert(PerpsEngine.PositionLimitExceeded.selector);
        perps.increasePosition(babaPerp, true, 50_000 * ONE, 100_001 * ONE, type(uint256).max, uint64(block.timestamp));

        vm.expectRevert(PerpsEngine.SlippageExceeded.selector); // long filled at 100 but will pay at most 99
        perps.increasePosition(babaPerp, true, 1_000 * ONE, 1_000 * ONE, 99 * ONE, uint64(block.timestamp));

        vm.expectRevert(PerpsEngine.DeadlineExpired.selector);
        perps.increasePosition(babaPerp, true, 1_000 * ONE, 1_000 * ONE, type(uint256).max, uint64(block.timestamp - 1));
        vm.stopPrank();
    }

    function test_openInterestCap() public {
        IRiskManager.PerpRisk memory r = _defaultRisk();
        r.openInterestCap = 150_000 * ONE;
        vm.prank(owner);
        risk.setPerpRisk(babaPerp, r);

        _open(alice, true, 40_000 * ONE, 100_000 * ONE);
        vm.prank(bob);
        vm.expectRevert(PerpsEngine.OpenInterestLimitExceeded.selector);
        perps.increasePosition(babaPerp, true, 30_000 * ONE, 60_000 * ONE, type(uint256).max, uint64(block.timestamp));
        _open(bob, false, 30_000 * ONE, 60_000 * ONE); // the other side has its own cap
    }

    function test_profitIsCapped() public {
        IRiskManager.PerpRisk memory r = _defaultRisk();
        r.maxProfitBps = 5_000; // profit capped at 50% of entry notional
        vm.prank(owner);
        risk.setPerpRisk(babaPerp, r);

        _open(alice, true, 4_000 * ONE, 10_000 * ONE);
        assertEq(vault.reservedAmount(), 5_000 * ONE);
        _setBaba(200e8); // +10,000 uncapped
        _close(alice, true);
        assertEq(vault.balances(alice), 96_000 * ONE + 3_990 * ONE + 5_000 * ONE - 20 * ONE);
        _assertSolvent();
    }

    // ------------------------------------------------------------ sessions & oracle

    function test_marketClosedBlocksTradingButNotCollateralOrLiquidation() public {
        _open(alice, true, 4_000 * ONE, 10_000 * ONE);
        vm.prank(keeper);
        risk.setTradingOpen(babaPerp, false);

        vm.startPrank(alice);
        vm.expectRevert(PerpsEngine.MarketClosed.selector);
        perps.closePosition(babaPerp, true, 0, uint64(block.timestamp));
        perps.increasePosition(babaPerp, true, 500 * ONE, 0, 0, 0); // adding margin stays open
        vm.stopPrank();
        assertEq(perps.getPosition(alice, babaPerp, true).collateral, 4_490 * ONE);

        _setBaba(60e8);
        vm.prank(liquidator);
        perps.liquidate(alice, babaPerp, true);
    }

    function test_staleOrPausedOracleHaltsMarket() public {
        _open(alice, true, 4_000 * ONE, 10_000 * ONE);
        vm.warp(block.timestamp + 2 days + 1);
        vm.prank(alice);
        vm.expectRevert(OracleRouter.StaleOraclePrice.selector);
        perps.closePosition(babaPerp, true, 0, uint64(block.timestamp));

        _setBaba(100e8);
        vm.prank(owner);
        oracle.setFeedPaused(BABA_ID, true);
        vm.prank(alice);
        vm.expectRevert(OracleRouter.OraclePaused.selector);
        perps.closePosition(babaPerp, true, 0, uint64(block.timestamp));
    }

    // ------------------------------------------------------------ liquidation

    function test_liquidation() public {
        _open(alice, true, 4_000 * ONE, 10_000 * ONE); // collateral 3,990, liquidation below ~66.78

        PerpsEngine.PositionInfo memory info = perps.positionInfo(alice, babaPerp, true);
        assertApproxEqAbs(info.liquidationPrice, 66_777_777, 1);

        _setBaba(67e8);
        vm.prank(liquidator);
        vm.expectRevert(PerpsEngine.NotLiquidatable.selector);
        perps.liquidate(alice, babaPerp, true);

        _setBaba(66e8); // equity 590 < maintenance 660
        vm.prank(alice);
        vm.expectRevert(PerpsEngine.Liquidatable.selector); // the owner cannot close it at this point either
        perps.closePosition(babaPerp, true, 0, uint64(block.timestamp));

        vm.prank(liquidator);
        perps.liquidate(alice, babaPerp, true);
        assertEq(vault.balances(liquidator), 33 * ONE); // 0.5% of 6,600
        assertEq(vault.balances(alice), 96_000 * ONE + 557 * ONE); // remaining equity after the fee
        assertEq(perps.getPosition(alice, babaPerp, true).size, 0);
        assertEq(vault.reservedAmount(), 0);
        _assertSolvent();
    }

    function test_badDebtIsAbsorbedByPool() public {
        _open(alice, true, 4_000 * ONE, 10_000 * ONE);
        _setBaba(30e8); // gapped far through the liquidation price: equity -3,010
        uint256 poolBefore = vault.poolAmount();
        vm.prank(liquidator);
        perps.liquidate(alice, babaPerp, true);
        assertEq(vault.balances(liquidator), 15 * ONE); // 0.5% of 3,000
        assertEq(vault.balances(alice), 96_000 * ONE);
        assertEq(vault.poolAmount(), poolBefore + 3_990 * ONE - 15 * ONE);
        _assertSolvent();
    }

    // ------------------------------------------------------------ funding

    function test_fundingPaidByTheCrowdedSide() public {
        _open(alice, true, 4_000 * ONE, 10_000 * ONE); // only longs: skew 100%, 0.01% per hour
        assertEq(perps.currentFundingRate(babaPerp), 1e14);

        vm.warp(block.timestamp + 10 hours);
        _setBaba(100e8);
        uint256 poolBefore = vault.poolAmount();
        vm.prank(alice);
        perps.increasePosition(babaPerp, true, 1 * ONE, 0, 0, 0); // any touch settles funding

        // 10 hours x 0.01% x 10,000 = 10 USDC
        assertEq(perps.getPosition(alice, babaPerp, true).collateral, 3_990 * ONE + 1 * ONE - 10 * ONE);
        assertEq(vault.poolAmount(), poolBefore + 10 * ONE);
        _assertSolvent();
    }

    function test_balancedMarketPaysNoFunding() public {
        _open(alice, true, 4_000 * ONE, 10_000 * ONE);
        _open(bob, false, 4_000 * ONE, 10_000 * ONE);
        assertEq(perps.currentFundingRate(babaPerp), 0);
        vm.warp(block.timestamp + 10 hours);
        _setBaba(100e8);
        _close(alice, true);
        _close(bob, false);
        assertEq(vault.balances(alice), vault.balances(bob)); // same fees, no funding either way
        _assertSolvent();
    }

    // ------------------------------------------------------------ invariant

    /// Any open / move / close sequence keeps every USDC accounted for and the pool above its reservations.
    function testFuzz_accountingHolds(uint64 openPrice, uint64 closePrice, uint96 collateral, uint8 leverage, bool isLong)
        public
    {
        uint256 p0 = bound(openPrice, 10e8, 500e8);
        uint256 p1 = bound(closePrice, 1e8, 1_000e8);
        uint256 c = bound(collateral, 100 * ONE, 30_000 * ONE);
        uint256 lev = bound(leverage, 1, 3);

        _setBaba(p0);
        _open(alice, isLong, c, (c * lev * 9) / 10);
        _setBaba(p1);

        PerpsEngine.PositionInfo memory info = perps.positionInfo(alice, babaPerp, isLong);
        if (info.liquidatable) {
            vm.prank(liquidator);
            perps.liquidate(alice, babaPerp, isLong);
        } else {
            _close(alice, isLong);
        }

        assertEq(perps.getPosition(alice, babaPerp, isLong).size, 0);
        assertEq(vault.reservedAmount(), 0);
        assertEq(vault.lockedMargin(alice), 0);
        _assertSolvent();
    }
}
