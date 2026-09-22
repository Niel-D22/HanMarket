// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IOracleRouter} from "../interfaces/IOracleRouter.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/**
 * @title Oracle router
 * @notice Every price an engine uses comes through here, normalised to 6 decimals.
 *
 *  - Chainlink feeds give a live index price (for perps and pool valuation) and the settlement price at expiry,
 *    both trustless. Stale, non-positive or paused prices revert.
 *  - Signed feeds have no onchain price source (most Hong Kong listings). They can only settle options, with an
 *    EIP-712 price signed by `priceSigner`, which users must trust. They never drive perps or liquidations.
 */
contract OracleRouter is IOracleRouter, Ownable2Step, EIP712 {
    enum Source {
        None,
        Chainlink,
        Signed
    }

    struct Feed {
        Source source;
        address aggregator;
        uint8 decimals;
        uint32 maxAge;
        bool paused;
    }

    uint32 public constant MAX_SETTLE_WINDOW = 3 days;
    bytes32 public constant PRICE_TYPEHASH =
        keccak256("SettlementPrice(bytes32 oracleId,uint64 expiry,uint256 price,uint64 publishTime)");

    mapping(bytes32 oracleId => Feed) internal _feeds;
    address public priceSigner;
    /// may pause a feed in an emergency, but cannot change one
    address public guardian;

    event FeedSet(bytes32 indexed oracleId, Source source, address aggregator, uint32 maxAge);
    event FeedPaused(bytes32 indexed oracleId, bool paused);
    event PriceSignerSet(address signer);
    event GuardianSet(address guardian);

    error InvalidParams();
    error UnknownFeed();
    error OraclePaused();
    error NoLivePrice();
    error StaleOraclePrice();
    error InvalidOraclePrice();
    error BadRound();
    error BadSignature();
    error NotGuardian();

    constructor(address owner_, address priceSigner_) Ownable(owner_) EIP712("HanMarket", "1") {
        priceSigner = priceSigner_;
        emit PriceSignerSet(priceSigner_);
    }

    // ---------------------------------------------------------------- admin

    function setChainlinkFeed(bytes32 oracleId, address aggregator, uint32 maxAge) external onlyOwner {
        if (oracleId == bytes32(0) || aggregator == address(0) || maxAge == 0) revert InvalidParams();
        uint8 dec = AggregatorV3Interface(aggregator).decimals();
        if (dec > 18) revert InvalidParams();
        _feeds[oracleId] = Feed(Source.Chainlink, aggregator, dec, maxAge, _feeds[oracleId].paused);
        emit FeedSet(oracleId, Source.Chainlink, aggregator, maxAge);
    }

    function setSignedFeed(bytes32 oracleId) external onlyOwner {
        if (oracleId == bytes32(0)) revert InvalidParams();
        _feeds[oracleId] = Feed(Source.Signed, address(0), 6, 0, _feeds[oracleId].paused);
        emit FeedSet(oracleId, Source.Signed, address(0), 0);
    }

    function setPriceSigner(address signer) external onlyOwner {
        priceSigner = signer;
        emit PriceSignerSet(signer);
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @notice Stops every read of a feed: its perp market halts and its options cannot settle until unpaused.
    function setFeedPaused(bytes32 oracleId, bool paused) external {
        if (msg.sender != owner() && (msg.sender != guardian || !paused)) revert NotGuardian();
        if (_feeds[oracleId].source == Source.None) revert UnknownFeed();
        _feeds[oracleId].paused = paused;
        emit FeedPaused(oracleId, paused);
    }

    // ---------------------------------------------------------------- prices

    function getPrice(bytes32 oracleId) external view returns (uint256 price, uint256 timestamp) {
        Feed memory f = _feed(oracleId);
        if (f.source != Source.Chainlink) revert NoLivePrice();
        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(f.aggregator).latestRoundData();
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) revert InvalidOraclePrice();
        if (block.timestamp - updatedAt > f.maxAge) revert StaleOraclePrice();
        return (_scale(uint256(answer), f.decimals), updatedAt);
    }

    function hasLivePrice(bytes32 oracleId) external view returns (bool) {
        return _feeds[oracleId].source == Source.Chainlink;
    }

    /**
     * @notice The price an option series settles at.
     *  Chainlink: `data` = abi.encode(uint80 roundId), the round that was current at expiry: published inside
     *             [expiry - window, expiry], with the next round (if any) published after expiry.
     *  Signed:    `data` = abi.encode(uint256 price, uint64 publishTime, bytes signature), published inside
     *             [expiry - window, expiry + window] and signed by `priceSigner`.
     */
    function settlementPrice(bytes32 oracleId, uint64 expiry, uint32 window, bytes calldata data)
        external
        view
        returns (uint256)
    {
        Feed memory f = _feed(oracleId);
        if (window == 0 || window > MAX_SETTLE_WINDOW) revert InvalidParams();
        if (f.source == Source.Chainlink) return _chainlinkAt(f, expiry, window, abi.decode(data, (uint80)));
        return _signedAt(oracleId, expiry, window, data);
    }

    function settlementDigest(bytes32 oracleId, uint64 expiry, uint256 price, uint64 publishTime)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(PRICE_TYPEHASH, oracleId, expiry, price, publishTime)));
    }

    function getFeed(bytes32 oracleId) external view returns (Feed memory) {
        return _feeds[oracleId];
    }

    // ---------------------------------------------------------------- internal

    function _feed(bytes32 oracleId) internal view returns (Feed memory f) {
        f = _feeds[oracleId];
        if (f.source == Source.None) revert UnknownFeed();
        if (f.paused) revert OraclePaused();
    }

    function _chainlinkAt(Feed memory f, uint64 expiry, uint32 window, uint80 roundId) internal view returns (uint256) {
        AggregatorV3Interface feed = AggregatorV3Interface(f.aggregator);
        (, int256 answer,, uint256 updatedAt,) = feed.getRoundData(roundId);
        if (updatedAt == 0 || updatedAt > expiry) revert BadRound();
        if (updatedAt + window < expiry) revert StaleOraclePrice();
        if (answer <= 0) revert InvalidOraclePrice();

        // the round must be the last one before expiry: the next round is after expiry, or doesn't exist yet
        (uint80 latestRound,,,,) = feed.latestRoundData();
        if (roundId != latestRound) {
            try feed.getRoundData(roundId + 1) returns (uint80, int256, uint256, uint256 nextUpdatedAt, uint80) {
                if (nextUpdatedAt == 0 || nextUpdatedAt <= expiry) revert BadRound();
            } catch {
                // the next id belongs to another aggregator phase; ordering can't be proven, so use the admin fallback
                revert BadRound();
            }
        }
        return _scale(uint256(answer), f.decimals);
    }

    function _signedAt(bytes32 oracleId, uint64 expiry, uint32 window, bytes calldata data)
        internal
        view
        returns (uint256)
    {
        (uint256 price, uint64 publishTime, bytes memory signature) = abi.decode(data, (uint256, uint64, bytes));
        if (price == 0) revert InvalidOraclePrice();
        if (publishTime > block.timestamp) revert BadRound();
        if (uint256(publishTime) + window < expiry || publishTime > uint256(expiry) + window) revert StaleOraclePrice();
        address signer = ECDSA.recover(settlementDigest(oracleId, expiry, price, publishTime), signature);
        if (signer == address(0) || signer != priceSigner) revert BadSignature();
        return price;
    }

    function _scale(uint256 value, uint8 decimals) internal pure returns (uint256) {
        if (decimals == 6) return value;
        if (decimals > 6) return value / 10 ** (decimals - 6);
        return value * 10 ** (6 - decimals);
    }
}
