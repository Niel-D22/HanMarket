// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/**
 * @title HanMarket options
 * @notice Cash-settled, fully collateralised calls and puts on China equities, paid in USDC.
 *
 * - A writer locks `cap` USDC per contract (the most a contract can ever pay) and sets an ask.
 * - A buyer pays the writer's ask (minus a protocol fee) and receives ERC-1155 option tokens,
 *   where the token id is the market id.
 * - After expiry the market is settled once:
 *     Chainlink assets (e.g. Robinhood BABA / USD) with the feed round that was live at expiry, trustlessly;
 *     Signed assets with an EIP-712 price signed by the HanMarket price signer, which users must trust.
 *   If neither arrives within the market's grace period, the owner can settle manually (flagged on-chain).
 * - Holders redeem `payoutPerContract` per option; writers claim what is not owed to holders.
 *
 * Units: USDC, strikes, caps, premiums and prices all use 6 decimals. Option amounts use 6 decimals too,
 * so an amount of 1e6 is one contract on one share.
 */
contract HanPerpOptions is ERC1155, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- types

    enum OracleKind {
        Chainlink,
        Signed
    }

    struct Asset {
        string symbol; // "BABA", "0700.HK"
        OracleKind kind;
        address feed; // Chainlink aggregator proxy, zero for Signed assets
        uint8 feedDecimals;
        bool active; // new markets can only be created on active assets
    }

    struct Market {
        uint32 assetId;
        bool isCall;
        bool settled;
        bool settledByAdmin;
        uint64 expiry;
        uint32 settleWindow; // accepted oracle publish time: [expiry - window, expiry] (Chainlink) or ± window (Signed)
        uint32 oracleGrace; // seconds after expiry before the owner may settle manually
        uint256 strike; // USD, 6 decimals
        uint256 cap; // max payout per contract = collateral per contract, 6 decimals
        uint256 settlementPrice;
        uint256 payoutPerContract;
        uint256 offered; // contracts writers have collateralised (sold + unsold)
        uint256 sold;
    }

    struct WriterPosition {
        uint256 offered;
        uint256 sold;
        uint256 collateral; // USDC held for this writer in this market
        uint256 premium; // ask per contract
        bool claimed;
    }

    // ---------------------------------------------------------------- constants & state

    uint256 public constant ONE = 1e6;
    uint16 public constant MAX_FEE_BPS = 500;
    uint32 public constant MAX_SETTLE_WINDOW = 3 days;
    uint32 public constant MAX_ORACLE_GRACE = 14 days;

    bytes32 public constant PRICE_TYPEHASH =
        keccak256("SettlementPrice(uint256 marketId,uint32 assetId,uint256 price,uint64 publishTime)");

    IERC20 public immutable usdc;

    address public treasury;
    address public priceSigner;
    uint16 public feeBps;

    Asset[] internal _assets;
    Market[] internal _markets;
    mapping(uint256 marketId => mapping(address writer => WriterPosition)) internal _positions;
    /// every address that has written in a market, so a front end can list offers without an indexer
    mapping(uint256 marketId => address[]) internal _writers;
    mapping(uint256 marketId => mapping(address writer => bool)) internal _isWriter;
    mapping(bytes32 key => bool) public marketExists;

    // ---------------------------------------------------------------- events

    event AssetAdded(uint32 indexed assetId, string symbol, OracleKind kind, address feed);
    event AssetActiveSet(uint32 indexed assetId, bool active);
    event ConfigUpdated(address treasury, address priceSigner, uint16 feeBps);
    event MarketCreated(
        uint256 indexed marketId, uint32 indexed assetId, bool isCall, uint256 strike, uint256 cap, uint64 expiry
    );
    event OptionWritten(uint256 indexed marketId, address indexed writer, uint256 qty, uint256 collateral, uint256 premium);
    event AskUpdated(uint256 indexed marketId, address indexed writer, uint256 premium);
    event OptionCancelled(uint256 indexed marketId, address indexed writer, uint256 qty, uint256 refund);
    event OptionBought(
        uint256 indexed marketId,
        address indexed writer,
        address indexed buyer,
        uint256 qty,
        uint256 premium,
        uint256 totalPaid,
        uint256 fee
    );
    event MarketSettled(uint256 indexed marketId, uint256 price, uint256 payoutPerContract, bool byAdmin);
    event OptionRedeemed(uint256 indexed marketId, address indexed holder, uint256 qty, uint256 payout);
    event CollateralClaimed(uint256 indexed marketId, address indexed writer, uint256 amount);

    // ---------------------------------------------------------------- errors

    error InvalidParams();
    error UnknownMarket();
    error UnknownAsset();
    error AssetInactive();
    error MarketAlreadyExists();
    error MarketExpired();
    error NotExpired();
    error AlreadySettled();
    error NotSettled();
    error ZeroAmount();
    error InsufficientOptions();
    error SlippageExceeded();
    error DustOrder();
    error AlreadyClaimed();
    error WrongOracle();
    error BadRound();
    error StalePrice();
    error NonPositivePrice();
    error BadSignature();
    error GraceNotOver();

    // ---------------------------------------------------------------- setup

    constructor(IERC20 usdc_, address owner_, address treasury_, address priceSigner_, uint16 feeBps_)
        ERC1155("")
        Ownable(owner_)
        EIP712("HanMarket", "1")
    {
        if (address(usdc_) == address(0) || treasury_ == address(0) || feeBps_ > MAX_FEE_BPS) revert InvalidParams();
        if (IERC20Metadata(address(usdc_)).decimals() != 6) revert InvalidParams();
        usdc = usdc_;
        treasury = treasury_;
        priceSigner = priceSigner_;
        feeBps = feeBps_;
        emit ConfigUpdated(treasury_, priceSigner_, feeBps_);
    }

    function name() external pure returns (string memory) {
        return "HanMarket Options";
    }

    function symbol() external pure returns (string memory) {
        return "HPOPT";
    }

    // ---------------------------------------------------------------- admin

    function addAsset(string calldata symbol_, OracleKind kind, address feed) external onlyOwner returns (uint32 id) {
        if (bytes(symbol_).length == 0 || bytes(symbol_).length > 16) revert InvalidParams();
        uint8 dec;
        if (kind == OracleKind.Chainlink) {
            if (feed == address(0)) revert InvalidParams();
            dec = AggregatorV3Interface(feed).decimals();
            if (dec > 18) revert InvalidParams();
        } else if (feed != address(0)) {
            revert InvalidParams();
        }
        id = uint32(_assets.length);
        _assets.push(Asset({symbol: symbol_, kind: kind, feed: feed, feedDecimals: dec, active: true}));
        emit AssetAdded(id, symbol_, kind, feed);
    }

    function setAssetActive(uint32 assetId, bool active) external onlyOwner {
        if (assetId >= _assets.length) revert UnknownAsset();
        _assets[assetId].active = active;
        emit AssetActiveSet(assetId, active);
    }

    function setConfig(address treasury_, address priceSigner_, uint16 feeBps_) external onlyOwner {
        if (treasury_ == address(0) || feeBps_ > MAX_FEE_BPS) revert InvalidParams();
        treasury = treasury_;
        priceSigner = priceSigner_;
        feeBps = feeBps_;
        emit ConfigUpdated(treasury_, priceSigner_, feeBps_);
    }

    function setURI(string calldata uri_) external onlyOwner {
        _setURI(uri_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function createMarket(
        uint32 assetId,
        bool isCall,
        uint256 strike,
        uint256 cap,
        uint64 expiry,
        uint32 settleWindow,
        uint32 oracleGrace
    ) external onlyOwner returns (uint256 marketId) {
        if (assetId >= _assets.length) revert UnknownAsset();
        if (!_assets[assetId].active) revert AssetInactive();
        if (strike == 0 || cap == 0) revert InvalidParams();
        // a put never pays more than its strike, so a bigger cap would only lock idle collateral
        if (!isCall && cap > strike) revert InvalidParams();
        if (expiry <= block.timestamp) revert InvalidParams();
        if (settleWindow == 0 || settleWindow > MAX_SETTLE_WINDOW || oracleGrace > MAX_ORACLE_GRACE) revert InvalidParams();

        bytes32 key = keccak256(abi.encode(assetId, isCall, strike, cap, expiry));
        if (marketExists[key]) revert MarketAlreadyExists();
        marketExists[key] = true;

        marketId = _markets.length;
        _markets.push(
            Market({
                assetId: assetId,
                isCall: isCall,
                settled: false,
                settledByAdmin: false,
                expiry: expiry,
                settleWindow: settleWindow,
                oracleGrace: oracleGrace,
                strike: strike,
                cap: cap,
                settlementPrice: 0,
                payoutPerContract: 0,
                offered: 0,
                sold: 0
            })
        );
        emit MarketCreated(marketId, assetId, isCall, strike, cap, expiry);
    }

    // ---------------------------------------------------------------- writers

    function write(uint256 marketId, uint256 qty, uint256 premium) external nonReentrant whenNotPaused {
        Market storage m = _market(marketId);
        if (m.settled) revert AlreadySettled();
        if (block.timestamp >= m.expiry) revert MarketExpired();
        if (qty == 0 || premium == 0) revert ZeroAmount();

        uint256 collateral = Math.mulDiv(qty, m.cap, ONE, Math.Rounding.Ceil);
        WriterPosition storage p = _positions[marketId][msg.sender];
        if (!_isWriter[marketId][msg.sender]) {
            _isWriter[marketId][msg.sender] = true;
            _writers[marketId].push(msg.sender);
        }
        p.offered += qty;
        p.collateral += collateral;
        p.premium = premium;
        m.offered += qty;

        usdc.safeTransferFrom(msg.sender, address(this), collateral);
        emit OptionWritten(marketId, msg.sender, qty, collateral, premium);
    }

    function updateAsk(uint256 marketId, uint256 premium) external {
        Market storage m = _market(marketId);
        if (m.settled) revert AlreadySettled();
        if (premium == 0) revert ZeroAmount();
        WriterPosition storage p = _positions[marketId][msg.sender];
        if (p.offered == 0) revert InsufficientOptions();
        p.premium = premium;
        emit AskUpdated(marketId, msg.sender, premium);
    }

    /// @notice Withdraw contracts nobody has bought yet, with their collateral.
    function cancel(uint256 marketId, uint256 qty) external nonReentrant {
        Market storage m = _market(marketId);
        WriterPosition storage p = _positions[marketId][msg.sender];
        if (qty == 0) revert ZeroAmount();
        if (p.claimed) revert AlreadyClaimed();
        if (qty > p.offered - p.sold) revert InsufficientOptions();

        uint256 refund = Math.mulDiv(qty, m.cap, ONE); // rounded down: the ceil on deposit keeps the rest covered
        p.offered -= qty;
        p.collateral -= refund;
        m.offered -= qty;

        usdc.safeTransfer(msg.sender, refund);
        emit OptionCancelled(marketId, msg.sender, qty, refund);
    }

    /// @notice After settlement, take back collateral that is not owed to holders and cancel anything unsold.
    function claim(uint256 marketId) external nonReentrant {
        Market storage m = _market(marketId);
        if (!m.settled) revert NotSettled();
        WriterPosition storage p = _positions[marketId][msg.sender];
        if (p.claimed) revert AlreadyClaimed();

        // rounding what is owed up keeps every holder's redemption covered
        uint256 owed = Math.mulDiv(p.sold, m.payoutPerContract, ONE, Math.Rounding.Ceil);
        uint256 amount = p.collateral > owed ? p.collateral - owed : 0;
        p.claimed = true;
        p.collateral -= amount;

        if (amount > 0) usdc.safeTransfer(msg.sender, amount);
        emit CollateralClaimed(marketId, msg.sender, amount);
    }

    // ---------------------------------------------------------------- buyers

    /// @notice Buy `qty` contracts from `writer` at their current ask, paying at most `maxPremium` per contract.
    function buy(uint256 marketId, address writer, uint256 qty, uint256 maxPremium)
        external
        nonReentrant
        whenNotPaused
    {
        Market storage m = _market(marketId);
        if (m.settled) revert AlreadySettled();
        if (block.timestamp >= m.expiry) revert MarketExpired();
        if (qty == 0) revert ZeroAmount();

        WriterPosition storage p = _positions[marketId][writer];
        if (p.claimed || qty > p.offered - p.sold) revert InsufficientOptions();
        uint256 premium = p.premium;
        if (premium > maxPremium) revert SlippageExceeded();

        uint256 total = Math.mulDiv(qty, premium, ONE);
        if (total == 0) revert DustOrder();
        uint256 fee = (total * feeBps) / 10_000;

        p.sold += qty;
        m.sold += qty;

        usdc.safeTransferFrom(msg.sender, writer, total - fee);
        if (fee > 0) usdc.safeTransferFrom(msg.sender, treasury, fee);
        _mint(msg.sender, marketId, qty, "");

        emit OptionBought(marketId, writer, msg.sender, qty, premium, total, fee);
    }

    /// @notice After settlement, burn options for their cash payout.
    function redeem(uint256 marketId, uint256 qty) external nonReentrant {
        Market storage m = _market(marketId);
        if (!m.settled) revert NotSettled();
        if (qty == 0) revert ZeroAmount();

        _burn(msg.sender, marketId, qty);
        uint256 payout = Math.mulDiv(qty, m.payoutPerContract, ONE);
        if (payout > 0) usdc.safeTransfer(msg.sender, payout);
        emit OptionRedeemed(marketId, msg.sender, qty, payout);
    }

    // ---------------------------------------------------------------- settlement

    /**
     * @notice Settle a Chainlink market with the feed round that was current at expiry.
     * @param roundId a round published inside [expiry - settleWindow, expiry] whose next round (if any)
     *                was published after expiry. Anyone can submit it; a wrong round simply reverts.
     */
    function settleWithChainlink(uint256 marketId, uint80 roundId) external nonReentrant {
        Market storage m = _market(marketId);
        Asset storage a = _assets[m.assetId];
        if (a.kind != OracleKind.Chainlink) revert WrongOracle();
        _checkSettleable(m);

        AggregatorV3Interface feed = AggregatorV3Interface(a.feed);
        (, int256 answer,, uint256 updatedAt,) = feed.getRoundData(roundId);
        if (updatedAt == 0 || updatedAt > m.expiry) revert BadRound();
        if (updatedAt + m.settleWindow < m.expiry) revert StalePrice();
        if (answer <= 0) revert NonPositivePrice();

        // the chosen round must be the last one before expiry: the next round is after expiry or doesn't exist yet
        (uint80 latestRound,,,,) = feed.latestRoundData();
        if (roundId != latestRound) {
            try feed.getRoundData(roundId + 1) returns (uint80, int256, uint256, uint256 nextUpdatedAt, uint80) {
                if (nextUpdatedAt != 0 && nextUpdatedAt <= m.expiry) revert BadRound();
                if (nextUpdatedAt == 0) revert BadRound();
            } catch {
                // the next id is in a different aggregator phase; can't prove ordering, use the admin fallback
                revert BadRound();
            }
        }

        _applySettlement(marketId, m, _scale(uint256(answer), a.feedDecimals), false);
    }

    /// @notice Settle a Signed market with a price signed by `priceSigner`. Anyone may submit the signature.
    function settleWithSignature(uint256 marketId, uint256 price, uint64 publishTime, bytes calldata signature)
        external
        nonReentrant
    {
        Market storage m = _market(marketId);
        if (_assets[m.assetId].kind != OracleKind.Signed) revert WrongOracle();
        _checkSettleable(m);
        if (price == 0) revert NonPositivePrice();
        if (publishTime > block.timestamp) revert BadRound();
        if (publishTime + m.settleWindow < m.expiry || publishTime > uint256(m.expiry) + m.settleWindow) {
            revert StalePrice();
        }

        bytes32 digest = settlementDigest(marketId, m.assetId, price, publishTime);
        address signer = ECDSA.recover(digest, signature);
        if (signer == address(0) || signer != priceSigner) revert BadSignature();

        _applySettlement(marketId, m, price, false);
    }

    /// @notice Manual settlement, only after the market's oracle grace period has passed without one.
    function adminSettle(uint256 marketId, uint256 price) external nonReentrant onlyOwner {
        Market storage m = _market(marketId);
        _checkSettleable(m);
        if (block.timestamp < uint256(m.expiry) + m.oracleGrace) revert GraceNotOver();
        if (price == 0) revert NonPositivePrice();
        _applySettlement(marketId, m, price, true);
    }

    function settlementDigest(uint256 marketId, uint32 assetId, uint256 price, uint64 publishTime)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(PRICE_TYPEHASH, marketId, assetId, price, publishTime)));
    }

    // ---------------------------------------------------------------- views

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function getAsset(uint32 assetId) external view returns (Asset memory) {
        if (assetId >= _assets.length) revert UnknownAsset();
        return _assets[assetId];
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _market(marketId);
    }

    function getPosition(uint256 marketId, address writer) external view returns (WriterPosition memory) {
        return _positions[marketId][writer];
    }

    function getWriters(uint256 marketId) external view returns (address[] memory) {
        _market(marketId);
        return _writers[marketId];
    }

    /// @notice Payout per contract for a market at a hypothetical settlement price.
    function payoutAt(uint256 marketId, uint256 price) public view returns (uint256) {
        Market storage m = _market(marketId);
        uint256 intrinsic;
        if (m.isCall) intrinsic = price > m.strike ? price - m.strike : 0;
        else intrinsic = m.strike > price ? m.strike - price : 0;
        return intrinsic < m.cap ? intrinsic : m.cap;
    }

    // ---------------------------------------------------------------- internal

    function _market(uint256 marketId) internal view returns (Market storage) {
        if (marketId >= _markets.length) revert UnknownMarket();
        return _markets[marketId];
    }

    function _checkSettleable(Market storage m) internal view {
        if (m.settled) revert AlreadySettled();
        if (block.timestamp < m.expiry) revert NotExpired();
    }

    function _applySettlement(uint256 marketId, Market storage m, uint256 price, bool byAdmin) internal {
        uint256 payout = payoutAt(marketId, price);
        m.settled = true;
        m.settledByAdmin = byAdmin;
        m.settlementPrice = price;
        m.payoutPerContract = payout;
        emit MarketSettled(marketId, price, payout, byAdmin);
    }

    function _scale(uint256 value, uint8 decimals) internal pure returns (uint256) {
        if (decimals == 6) return value;
        if (decimals > 6) return value / 10 ** (decimals - 6);
        return value * 10 ** (6 - decimals);
    }

    // Tokens cannot move while the protocol is paused, so a halt also stops secondary transfers.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override
    {
        if (from != address(0) && to != address(0)) _requireNotPaused();
        super._update(from, to, ids, values);
    }
}
