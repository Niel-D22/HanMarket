// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {HanPerpOptions} from "../src/HanPerpOptions.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

contract HanPerpOptionsTest is Test {
    uint256 constant ONE = 1e6;

    HanPerpOptions options;
    MockUSDC usdc;
    MockAggregator babaFeed;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address writer = makeAddr("writer");
    address writer2 = makeAddr("writer2");
    address buyer = makeAddr("buyer");
    address attacker = makeAddr("attacker");
    uint256 signerKey = 0xA11CE;
    address signer;

    uint32 babaId;
    uint32 tencentId;
    uint64 expiry;

    function setUp() public {
        vm.warp(1_790_000_000);
        signer = vm.addr(signerKey);
        usdc = new MockUSDC();
        babaFeed = new MockAggregator(8);
        options = new HanPerpOptions(IERC20(address(usdc)), owner, treasury, signer, 30);

        vm.startPrank(owner);
        babaId = options.addAsset("BABA", HanPerpOptions.OracleKind.Chainlink, address(babaFeed));
        tencentId = options.addAsset("0700.HK", HanPerpOptions.OracleKind.Signed, address(0));
        vm.stopPrank();

        expiry = uint64(block.timestamp + 7 days);
        for (uint256 i; i < 3; i++) {
            address a = [writer, writer2, buyer][i];
            usdc.mint(a, 1_000_000 * ONE);
            vm.prank(a);
            usdc.approve(address(options), type(uint256).max);
        }
    }

    // ------------------------------------------------------------ helpers

    function _babaCall() internal returns (uint256) {
        vm.prank(owner);
        return options.createMarket(babaId, true, 110 * ONE, 20 * ONE, expiry, 1 hours, 3 days);
    }

    function _tencentPut() internal returns (uint256) {
        vm.prank(owner);
        return options.createMarket(tencentId, false, 55 * ONE, 55 * ONE, expiry, 30 minutes, 3 days);
    }

    function _sign(uint256 key, uint256 marketId, uint32 assetId, uint256 price, uint64 publishTime)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = options.settlementDigest(marketId, assetId, price, publishTime);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------ admin

    function test_onlyOwnerAdmin() public {
        vm.startPrank(attacker);
        vm.expectRevert();
        options.addAsset("PDD", HanPerpOptions.OracleKind.Signed, address(0));
        vm.expectRevert();
        options.createMarket(babaId, true, 110 * ONE, 20 * ONE, expiry, 1 hours, 3 days);
        vm.expectRevert();
        options.setConfig(attacker, attacker, 0);
        vm.stopPrank();
    }

    function test_createMarketValidation() public {
        vm.startPrank(owner);
        vm.expectRevert(HanPerpOptions.InvalidParams.selector); // put cap above strike
        options.createMarket(tencentId, false, 50 * ONE, 60 * ONE, expiry, 1 hours, 1 days);
        vm.expectRevert(HanPerpOptions.InvalidParams.selector); // expiry in the past
        options.createMarket(babaId, true, 110 * ONE, 20 * ONE, uint64(block.timestamp), 1 hours, 1 days);
        options.createMarket(babaId, true, 110 * ONE, 20 * ONE, expiry, 1 hours, 1 days);
        vm.expectRevert(HanPerpOptions.MarketAlreadyExists.selector);
        options.createMarket(babaId, true, 110 * ONE, 20 * ONE, expiry, 1 hours, 1 days);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ full lifecycle, Chainlink

    function test_callLifecycleChainlink() public {
        uint256 id = _babaCall();

        vm.prank(writer);
        options.write(id, 10 * ONE, 2 * ONE); // lock 10 x $20 = $200, ask $2
        assertEq(usdc.balanceOf(address(options)), 200 * ONE);

        uint256 writerBefore = usdc.balanceOf(writer);
        vm.prank(buyer);
        options.buy(id, writer, 4 * ONE, 2 * ONE); // pays $8, fee 0.30%
        assertEq(options.balanceOf(buyer, id), 4 * ONE);
        assertEq(usdc.balanceOf(treasury), 24_000); // $0.024
        assertEq(usdc.balanceOf(writer) - writerBefore, 8 * ONE - 24_000);

        babaFeed.push(118e8, expiry - 30 minutes); // last price before expiry: $118
        babaFeed.push(125e8, expiry + 10 minutes); // after expiry, must be ignored
        vm.warp(expiry + 1 hours);

        vm.expectRevert(HanPerpOptions.BadRound.selector); // the post-expiry round
        options.settleWithChainlink(id, 2);
        options.settleWithChainlink(id, 1);

        HanPerpOptions.Market memory m = options.getMarket(id);
        assertEq(m.settlementPrice, 118 * ONE);
        assertEq(m.payoutPerContract, 8 * ONE); // min(118 - 110, 20)

        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.prank(buyer);
        options.redeem(id, 4 * ONE);
        assertEq(usdc.balanceOf(buyer) - buyerBefore, 32 * ONE);

        uint256 wBefore = usdc.balanceOf(writer);
        vm.prank(writer);
        options.claim(id);
        assertEq(usdc.balanceOf(writer) - wBefore, 168 * ONE); // 200 - 4 x 8
        assertEq(usdc.balanceOf(address(options)), 0);
    }

    function test_chainlinkRejectsSkippedRound() public {
        uint256 id = _babaCall();
        babaFeed.push(100e8, expiry - 50 minutes);
        babaFeed.push(130e8, expiry - 5 minutes); // the real last price before expiry
        vm.warp(expiry + 1);
        vm.expectRevert(HanPerpOptions.BadRound.selector); // round 1 is not the last one before expiry
        options.settleWithChainlink(id, 1);
        options.settleWithChainlink(id, 2);
        assertEq(options.getMarket(id).settlementPrice, 130 * ONE);
    }

    function test_chainlinkRejectsStaleAndEarly() public {
        uint256 id = _babaCall();
        babaFeed.push(100e8, expiry - 2 hours); // older than the 1 hour window
        vm.expectRevert(HanPerpOptions.NotExpired.selector);
        options.settleWithChainlink(id, 1);
        vm.warp(expiry + 1);
        vm.expectRevert(HanPerpOptions.StalePrice.selector);
        options.settleWithChainlink(id, 1);
    }

    function test_chainlinkCannotSettleSignedMarket() public {
        uint256 id = _tencentPut();
        babaFeed.push(100e8, expiry - 1);
        vm.warp(expiry + 1);
        vm.expectRevert(HanPerpOptions.WrongOracle.selector);
        options.settleWithChainlink(id, 1);
    }

    // ------------------------------------------------------------ full lifecycle, signed

    function test_putLifecycleSigned() public {
        uint256 id = _tencentPut();
        vm.prank(writer);
        options.write(id, 2 * ONE, 3 * ONE); // lock 2 x $55
        vm.prank(buyer);
        options.buy(id, writer, 2 * ONE, 3 * ONE);

        vm.warp(expiry + 5 minutes);
        uint64 publishTime = expiry + 60;
        bytes memory sig = _sign(signerKey, id, tencentId, 50 * ONE, publishTime);
        options.settleWithSignature(id, 50 * ONE, publishTime, sig);
        assertEq(options.getMarket(id).payoutPerContract, 5 * ONE);

        vm.prank(buyer);
        options.redeem(id, 2 * ONE);
        vm.prank(writer);
        options.claim(id);
        assertEq(usdc.balanceOf(address(options)), 0);
    }

    function test_signedRejectsForgedAndReplayed() public {
        uint256 id = _tencentPut();
        uint256 other = _babaCall();
        vm.warp(expiry + 5 minutes);
        uint64 t = expiry;
        uint64 old = expiry - 2 hours;

        // signatures are prepared first: expectRevert applies to the very next external call
        bytes memory wrongKey = _sign(0xBAD, id, tencentId, 50 * ONE, t);
        bytes memory good = _sign(signerKey, id, tencentId, 50 * ONE, t);
        bytes memory forChainlinkMarket = _sign(signerKey, other, babaId, 50 * ONE, t);
        bytes memory stale = _sign(signerKey, id, tencentId, 50 * ONE, old);

        vm.expectRevert(HanPerpOptions.BadSignature.selector); // wrong key
        options.settleWithSignature(id, 50 * ONE, t, wrongKey);

        vm.expectRevert(HanPerpOptions.BadSignature.selector); // price changed after signing
        options.settleWithSignature(id, 40 * ONE, t, good);

        vm.expectRevert(HanPerpOptions.WrongOracle.selector); // signature cannot settle a Chainlink market
        options.settleWithSignature(other, 50 * ONE, t, forChainlinkMarket);

        vm.expectRevert(HanPerpOptions.StalePrice.selector); // published long before expiry
        options.settleWithSignature(id, 50 * ONE, old, stale);

        options.settleWithSignature(id, 50 * ONE, t, good);
        vm.expectRevert(HanPerpOptions.AlreadySettled.selector); // replay
        options.settleWithSignature(id, 50 * ONE, t, good);
    }

    function test_writersListedOnce() public {
        uint256 id = _babaCall();
        vm.startPrank(writer);
        options.write(id, 1 * ONE, 2 * ONE);
        options.cancel(id, 1 * ONE);
        options.write(id, 1 * ONE, 2 * ONE);
        vm.stopPrank();
        vm.prank(writer2);
        options.write(id, 1 * ONE, 3 * ONE);
        address[] memory ws = options.getWriters(id);
        assertEq(ws.length, 2);
        assertEq(ws[0], writer);
        assertEq(ws[1], writer2);
    }

    // ------------------------------------------------------------ admin fallback

    function test_adminSettleOnlyAfterGrace() public {
        uint256 id = _babaCall();
        vm.warp(expiry + 1 days);
        vm.prank(owner);
        vm.expectRevert(HanPerpOptions.GraceNotOver.selector);
        options.adminSettle(id, 120 * ONE);

        vm.warp(expiry + 3 days);
        vm.prank(attacker);
        vm.expectRevert();
        options.adminSettle(id, 120 * ONE);

        vm.prank(owner);
        options.adminSettle(id, 120 * ONE);
        HanPerpOptions.Market memory m = options.getMarket(id);
        assertTrue(m.settledByAdmin);
        assertEq(m.payoutPerContract, 10 * ONE);
    }

    // ------------------------------------------------------------ attacks & edge cases

    function test_buyRespectsSlippageAndSupply() public {
        uint256 id = _babaCall();
        vm.prank(writer);
        options.write(id, 1 * ONE, 2 * ONE);

        vm.prank(writer);
        options.updateAsk(id, 5 * ONE); // writer raises the price
        vm.prank(buyer);
        vm.expectRevert(HanPerpOptions.SlippageExceeded.selector);
        options.buy(id, writer, 1 * ONE, 2 * ONE);

        vm.prank(buyer);
        vm.expectRevert(HanPerpOptions.InsufficientOptions.selector);
        options.buy(id, writer, 2 * ONE, 5 * ONE);

        vm.prank(buyer);
        vm.expectRevert(HanPerpOptions.InsufficientOptions.selector); // writer2 offered nothing
        options.buy(id, writer2, 1 * ONE, 5 * ONE);
    }

    function test_buyerMustPay() public {
        uint256 id = _babaCall();
        vm.prank(writer);
        options.write(id, 1 * ONE, 2 * ONE);
        vm.prank(attacker); // no USDC, no approval
        vm.expectRevert();
        options.buy(id, writer, 1 * ONE, 2 * ONE);
        assertEq(options.balanceOf(attacker, id), 0);
    }

    function test_noTradingAfterExpiry() public {
        uint256 id = _babaCall();
        vm.prank(writer);
        options.write(id, 1 * ONE, 2 * ONE);
        vm.warp(expiry);
        vm.prank(writer);
        vm.expectRevert(HanPerpOptions.MarketExpired.selector);
        options.write(id, 1 * ONE, 2 * ONE);
        vm.prank(buyer);
        vm.expectRevert(HanPerpOptions.MarketExpired.selector);
        options.buy(id, writer, 1 * ONE, 2 * ONE);
    }

    function test_cancelOnlyUnsold() public {
        uint256 id = _babaCall();
        vm.prank(writer);
        options.write(id, 3 * ONE, 2 * ONE);
        vm.prank(buyer);
        options.buy(id, writer, 2 * ONE, 2 * ONE);

        vm.prank(writer);
        vm.expectRevert(HanPerpOptions.InsufficientOptions.selector);
        options.cancel(id, 2 * ONE);

        uint256 before = usdc.balanceOf(writer);
        vm.prank(writer);
        options.cancel(id, 1 * ONE);
        assertEq(usdc.balanceOf(writer) - before, 20 * ONE);
    }

    function test_noDoubleClaimOrEarlyRedeem() public {
        uint256 id = _babaCall();
        vm.prank(writer);
        options.write(id, 1 * ONE, 2 * ONE);
        vm.prank(buyer);
        options.buy(id, writer, 1 * ONE, 2 * ONE);

        vm.prank(buyer);
        vm.expectRevert(HanPerpOptions.NotSettled.selector);
        options.redeem(id, 1 * ONE);

        babaFeed.push(200e8, expiry - 1);
        vm.warp(expiry + 1);
        options.settleWithChainlink(id, 1);

        vm.startPrank(writer);
        options.claim(id);
        vm.expectRevert(HanPerpOptions.AlreadyClaimed.selector);
        options.claim(id);
        vm.stopPrank();

        vm.prank(attacker); // holds no options
        vm.expectRevert();
        options.redeem(id, 1 * ONE);
    }

    function test_pauseStopsTradingButNotExits() public {
        uint256 id = _babaCall();
        vm.prank(writer);
        options.write(id, 2 * ONE, 2 * ONE);
        vm.prank(buyer);
        options.buy(id, writer, 1 * ONE, 2 * ONE);

        vm.prank(owner);
        options.pause();
        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        options.buy(id, writer, 1 * ONE, 2 * ONE);
        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        options.safeTransferFrom(buyer, attacker, id, 1 * ONE, "");

        vm.prank(writer); // writers can still pull unsold collateral while paused
        options.cancel(id, 1 * ONE);
    }

    /// Vault stays solvent for any mix of writers, buyers and settlement prices.
    function testFuzz_solvency(uint96 q1, uint96 q2, uint96 sold1, uint96 sold2, uint64 priceRaw, bool isCall) public {
        uint256 cap = 17_333_333; // awkward cap to exercise rounding
        uint256 qty1 = bound(q1, 1, 5_000 * ONE);
        uint256 qty2 = bound(q2, 1, 5_000 * ONE);
        uint256 s1 = bound(sold1, 0, qty1);
        uint256 s2 = bound(sold2, 0, qty2);
        uint256 price = bound(priceRaw, 1, 1_000 * ONE);

        vm.prank(owner);
        uint256 id = options.createMarket(tencentId, isCall, 60 * ONE, cap, expiry, 1 hours, 1 days);

        vm.prank(writer);
        options.write(id, qty1, 1 * ONE);
        vm.prank(writer2);
        options.write(id, qty2, 1 * ONE);
        if (s1 > 0) {
            vm.prank(buyer);
            try options.buy(id, writer, s1, 1 * ONE) {} catch {}
        }
        if (s2 > 0) {
            vm.prank(buyer);
            try options.buy(id, writer2, s2, 1 * ONE) {} catch {}
        }

        vm.warp(expiry + 1);
        uint64 t = expiry;
        options.settleWithSignature(id, price, t, _sign(signerKey, id, tencentId, price, t));

        uint256 held = options.balanceOf(buyer, id);
        if (held > 0) {
            vm.prank(buyer);
            options.redeem(id, held);
        }
        vm.prank(writer);
        options.claim(id);
        vm.prank(writer2);
        options.claim(id);

        // every obligation was paid and the vault never went negative (a transfer would have reverted)
        assertLt(usdc.balanceOf(address(options)), 3); // at most rounding dust stays behind
    }
}
