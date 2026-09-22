// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {BaseTest} from "./Base.t.sol";
import {OptionsEngine} from "../src/options/OptionsEngine.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";

contract OptionsTest is BaseTest {
    uint64 expiry;

    function setUp() public override {
        super.setUp();
        expiry = uint64(block.timestamp + 7 days);
    }

    function _babaCall() internal returns (uint256) {
        vm.prank(keeper);
        return options.createSeries(babaAsset, true, 110 * ONE, 20 * ONE, expiry, 1 hours, 3 days);
    }

    function _tencentPut() internal returns (uint256) {
        vm.prank(keeper);
        return options.createSeries(tencentAsset, false, 55 * ONE, 55 * ONE, expiry, 30 minutes, 3 days);
    }

    function _buy(address who, uint256 id, uint256 qty, uint256 premium) internal {
        (OptionsEngine.Quote memory q, bytes memory sig) = _quote(id, true, premium, qty);
        vm.prank(who);
        options.buy(qty, premium, q, sig);
    }

    // ------------------------------------------------------------ lifecycle

    function test_buyCallSettleWithChainlinkAndRedeem() public {
        uint256 id = _babaCall();
        uint256 poolBefore = vault.poolAmount();
        _buy(alice, id, 10 * ONE, 3_500_000); // 10 contracts at 3.50

        // 35.00 premium + 0.35 fee (1%)
        assertEq(vault.balances(alice), 100_000 * ONE - 35_350_000);
        assertEq(options.balanceOf(alice, id), 10 * ONE);
        assertEq(vault.reservedAmount(), 200 * ONE); // cap 20 x 10
        assertEq(vault.optionsDeferred(), 35 * ONE); // premium held until settlement
        assertEq(vault.poolAmount(), poolBefore + 35 * ONE + 245_000); // premium + 70% of the fee
        _assertSolvent();

        // BABA closes at 120 before expiry: the call pays 10 per contract
        vm.warp(expiry - 10 minutes);
        uint80 round = _setBaba(120e8);
        vm.warp(expiry + 1 hours);
        _setBaba(121e8); // a later round, after expiry, must not be used
        vm.expectRevert(OracleRouter.BadRound.selector);
        options.settle(id, abi.encode(round + 1));
        options.settle(id, abi.encode(round));

        OptionsEngine.Series memory s = options.getSeries(id);
        assertTrue(s.settled);
        assertEq(s.settlementPrice, 120 * ONE);
        assertEq(s.payoutPerContract, 10 * ONE);
        assertEq(vault.reservedAmount(), 0);
        assertEq(vault.optionsDeferred(), 0);
        assertEq(vault.optionsPayable(), 100 * ONE);

        vm.prank(alice);
        options.redeem(id, 10 * ONE);
        assertEq(vault.balances(alice), 100_000 * ONE - 35_350_000 + 100 * ONE);
        assertEq(vault.optionsPayable(), 0);
        _assertSolvent();
    }

    function test_sellBackBeforeExpiry() public {
        uint256 id = _babaCall();
        _buy(alice, id, 10 * ONE, 3_500_000);

        (OptionsEngine.Quote memory q, bytes memory sig) = _quote(id, false, 4_000_000, 4 * ONE); // bid 4.00
        vm.prank(alice);
        options.sell(4 * ONE, 4_000_000, q, sig);

        // 16.00 proceeds - 0.16 close fee
        assertEq(vault.balances(alice), 100_000 * ONE - 35_350_000 + 15_840_000);
        assertEq(options.balanceOf(alice, id), 6 * ONE);
        assertEq(vault.reservedAmount(), 120 * ONE);
        assertEq(vault.optionsDeferred(), 19 * ONE); // 35 received - 16 paid back
        _assertSolvent();
    }

    function test_signedPutSettlement() public {
        uint256 id = _tencentPut();
        _buy(alice, id, 2 * ONE, 1_200_000);
        vm.warp(expiry + 5 minutes);

        // a price signed by someone else is rejected
        bytes memory forged = _signedPrice(TENCENT_ID, expiry, 50 * ONE, expiry, 0xBAD);
        vm.expectRevert(OracleRouter.BadSignature.selector);
        options.settle(id, forged);

        options.settle(id, _signedPrice(TENCENT_ID, expiry, 50 * ONE, expiry, priceSignerKey));
        assertEq(options.getSeries(id).payoutPerContract, 5 * ONE);
        vm.prank(alice);
        options.redeem(id, 2 * ONE);
        assertEq(vault.balances(alice), 100_000 * ONE - 2_424_000 + 10 * ONE);
        _assertSolvent();
    }

    function test_worthlessOptionReturnsPremiumToPool() public {
        uint256 id = _babaCall();
        uint256 navBefore = vault.nav();
        _buy(alice, id, 10 * ONE, 3_500_000);
        assertEq(vault.nav(), navBefore + 245_000); // premium is not LP value until settlement

        vm.warp(expiry - 1 minutes);
        uint80 round = _setBaba(105e8); // below the strike
        vm.warp(expiry + 1);
        options.settle(id, abi.encode(round));
        assertEq(vault.nav(), navBefore + 245_000 + 35 * ONE);
        _assertSolvent();
    }

    // ------------------------------------------------------------ quotes

    function test_quoteRules() public {
        uint256 id = _babaCall();
        (OptionsEngine.Quote memory q, bytes memory sig) = _quote(id, true, 3_500_000, 5 * ONE);

        vm.startPrank(alice);
        vm.expectRevert(OptionsEngine.SlippageExceeded.selector);
        options.buy(1 * ONE, 3_000_000, q, sig);

        vm.expectRevert(OptionsEngine.BadQuote.selector); // a buy quote cannot be used to sell
        options.sell(1 * ONE, 0, q, sig);

        options.buy(5 * ONE, 3_500_000, q, sig);
        vm.expectRevert(OptionsEngine.QuoteExhausted.selector); // maxQty already filled
        options.buy(1 * ONE, 3_500_000, q, sig);

        (OptionsEngine.Quote memory q2, bytes memory sig2) = _quote(id, true, 3_500_000, 5 * ONE);
        q2.premium = 1; // tampered after signing
        vm.expectRevert(OptionsEngine.BadQuote.selector);
        options.buy(1 * ONE, 3_500_000, q2, sig2);

        vm.warp(block.timestamp + 6 minutes);
        (q2, sig2) = _quote(id, true, 3_500_000, 5 * ONE);
        vm.warp(block.timestamp + 6 minutes);
        vm.expectRevert(OptionsEngine.QuoteExpired.selector);
        options.buy(1 * ONE, 3_500_000, q2, sig2);
        vm.stopPrank();
    }

    function test_tradingStopsBeforeExpiry() public {
        uint256 id = _babaCall();
        vm.warp(expiry - 20 minutes); // inside the 30 minute cutoff
        _setBaba(100e8);
        (OptionsEngine.Quote memory q, bytes memory sig) = _quote(id, true, 3_500_000, 1 * ONE);
        vm.prank(alice);
        vm.expectRevert(OptionsEngine.TradingClosed.selector);
        options.buy(1 * ONE, 3_500_000, q, sig);
    }

    function test_reserveCapPerAsset() public {
        vm.prank(owner);
        risk.setOptionsReserveCap(babaAsset, 100 * ONE);
        uint256 id = _babaCall();
        (OptionsEngine.Quote memory q, bytes memory sig) = _quote(id, true, 3_500_000, 10 * ONE);
        vm.prank(alice);
        vm.expectRevert(OptionsEngine.ReserveCapExceeded.selector); // 6 x 20 cap = 120 > 100
        options.buy(6 * ONE, 3_500_000, q, sig);
    }

    // ------------------------------------------------------------ settlement edge cases

    function test_adminSettleOnlyAfterGrace() public {
        uint256 id = _tencentPut();
        _buy(alice, id, 1 * ONE, 1_000_000);
        vm.warp(expiry + 1 days);
        vm.prank(owner);
        vm.expectRevert(OptionsEngine.GraceNotOver.selector);
        options.adminSettle(id, 50 * ONE);

        vm.warp(expiry + 3 days);
        vm.prank(attacker);
        vm.expectRevert();
        options.adminSettle(id, 1);

        vm.prank(owner);
        options.adminSettle(id, 50 * ONE);
        assertTrue(options.getSeries(id).settledByAdmin);
        _assertSolvent();
    }

    function test_cannotSettleEarlyOrTwice() public {
        uint256 id = _babaCall();
        uint80 round = _setBaba(120e8);
        vm.expectRevert(OptionsEngine.NotExpired.selector);
        options.settle(id, abi.encode(round));

        vm.warp(expiry);
        round = _setBaba(120e8);
        options.settle(id, abi.encode(round));
        vm.expectRevert(OptionsEngine.AlreadySettled.selector);
        options.settle(id, abi.encode(round));
    }

    function test_onlyKeeperCreatesSeries() public {
        vm.prank(attacker);
        vm.expectRevert(OptionsEngine.NotKeeper.selector);
        options.createSeries(babaAsset, true, 110 * ONE, 20 * ONE, expiry, 1 hours, 3 days);

        vm.prank(keeper);
        vm.expectRevert(OptionsEngine.InvalidParams.selector); // a put's cap may not exceed its strike
        options.createSeries(babaAsset, false, 50 * ONE, 60 * ONE, expiry, 1 hours, 3 days);
    }

    function test_pauseStopsTradingAndTransfers() public {
        uint256 id = _babaCall();
        _buy(alice, id, 1 * ONE, 3_500_000);
        vm.prank(owner);
        options.pause();
        vm.prank(alice);
        vm.expectRevert();
        options.safeTransferFrom(alice, bob, id, 1 * ONE, "");
    }
}
