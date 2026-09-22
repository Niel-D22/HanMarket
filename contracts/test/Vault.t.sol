// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {BaseTest} from "./Base.t.sol";
import {Vault} from "../src/core/Vault.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";

contract VaultTest is BaseTest {
    function test_depositAndWithdraw() public {
        assertEq(vault.balances(alice), 100_000 * ONE);
        vm.prank(alice);
        vault.withdraw(40_000 * ONE);
        assertEq(vault.balances(alice), 60_000 * ONE);
        assertEq(usdc.balanceOf(alice), 40_000 * ONE);

        vm.prank(alice);
        vm.expectRevert(Vault.InsufficientCollateral.selector);
        vault.withdraw(60_001 * ONE);
        _assertSolvent();
    }

    function test_withdrawStaysOpenWhilePaused() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(alice);
        vault.withdraw(1 * ONE);
        vm.prank(bob);
        vm.expectRevert();
        vault.deposit(1 * ONE);
    }

    function test_liquidityLockAndShares() public {
        uint256 shares = vault.balanceOf(lp);
        assertEq(shares, 1_000_000 * ONE * 1e12); // first deposit: 1 USDC = 1e12 share units (18 decimals)

        vm.startPrank(lp);
        vm.expectRevert(Vault.LiquidityLocked.selector);
        vault.removeLiquidity(shares / 2, 0);
        vm.expectRevert(Vault.LiquidityLocked.selector); // locked shares cannot move to another wallet either
        vault.transfer(bob, shares / 2);

        vm.warp(block.timestamp + 1 days);
        uint256 out = vault.removeLiquidity(shares / 2, 0);
        vm.stopPrank();
        assertApproxEqAbs(out, 500_000 * ONE, 1);
        _assertSolvent();
    }

    function test_lpCannotWithdrawReservedFunds() public {
        // alice opens a perp that reserves 90k of profit cap
        vm.prank(alice);
        perps.increasePosition(babaPerp, true, 40_000 * ONE, 90_000 * ONE, 101 * ONE, uint64(block.timestamp));

        vm.warp(block.timestamp + 1 days);
        _setBaba(100e8);
        uint256 shares = vault.balanceOf(lp);
        vm.prank(lp);
        vm.expectRevert(Vault.InsufficientPool.selector);
        vault.removeLiquidity(shares, 0);
        assertEq(vault.reservedAmount(), 90_000 * ONE);
        _assertSolvent();
    }

    function test_engineHooksAreRestricted() public {
        vm.startPrank(attacker);
        vm.expectRevert(Vault.NotEngine.selector);
        vault.reserve(1);
        vm.expectRevert(Vault.NotEngine.selector);
        vault.payFromPool(attacker, 1_000 * ONE, 0);
        vm.expectRevert(Vault.NotEngine.selector);
        vault.settleLocked(alice, 0, 1_000 * ONE, 0, 0, address(0));
        vm.expectRevert();
        vault.setEngine(attacker, true);
        vm.stopPrank();
    }

    function test_utilizationCap() public {
        // 80% max utilisation of a 1M pool: a position reserving more than 800k cannot open
        vm.startPrank(owner);
        risk.setPerpRisk(babaPerp, _bigRisk());
        vm.stopPrank();
        _deposit(alice, 1_000_000 * ONE);
        vm.prank(alice);
        vm.expectRevert(Vault.UtilizationExceeded.selector);
        perps.increasePosition(babaPerp, true, 400_000 * ONE, 810_000 * ONE, 101 * ONE, uint64(block.timestamp));
    }

    function test_navFollowsTraderPnl() public {
        uint256 navBefore = vault.nav();
        vm.prank(alice);
        perps.increasePosition(babaPerp, true, 5_000 * ONE, 10_000 * ONE, 101 * ONE, uint64(block.timestamp));
        _setBaba(110e8); // alice is up 1,000
        assertApproxEqAbs(vault.nav(), navBefore + 7 * ONE - 1_000 * ONE, 1); // + 70% of the 10 USDC fee
    }

    function test_guardianCanOnlyPause() public {
        vm.prank(owner);
        oracle.setGuardian(bob);
        vm.prank(bob);
        oracle.setFeedPaused(BABA_ID, true);
        vm.prank(bob);
        vm.expectRevert(OracleRouter.NotGuardian.selector);
        oracle.setFeedPaused(BABA_ID, false);

        vm.expectRevert(OracleRouter.OraclePaused.selector);
        oracle.getPrice(BABA_ID);
        vm.prank(owner);
        oracle.setFeedPaused(BABA_ID, false);
        (uint256 price,) = oracle.getPrice(BABA_ID);
        assertEq(price, 100 * ONE);
    }

    function _bigRisk() internal pure returns (IRiskManager.PerpRisk memory r) {
        r = _defaultRisk();
        r.maxPositionNotional = 2_000_000 * ONE;
        r.openInterestCap = 2_000_000 * ONE;
    }
}
