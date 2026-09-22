// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IOracleRouter} from "../interfaces/IOracleRouter.sol";
import {IVault} from "../interfaces/IVault.sol";
import {IFeeManager} from "../interfaces/IFeeManager.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";

/**
 * @title Options engine
 * @notice European, cash-settled calls and puts, bought from and sold back to the vault.
 *
 *  - Premiums come from quotes signed by `quoteSigner` (the pricing service: Black-Scholes with a spread). A quote
 *    sets the price and the most contracts it can fill; it never decides settlement.
 *  - Every series has a cap, the most one contract can pay. Buying reserves cap x contracts in the vault, so the
 *    pool can always pay. A put's cap is at most its strike.
 *  - After expiry anyone settles the series with the oracle router's price for the expiry. If no valid price
 *    arrives within the grace period, the owner settles manually and the series is flagged.
 *  - Holders then redeem their tokens for the payout. Option positions are ERC-1155 tokens, id = series id.
 *
 *  Units: USDC, strikes, caps, premiums and prices use 6 decimals. Quantities use 6 decimals too, so 1e6 is one
 *  contract on one share.
 */
contract OptionsEngine is ERC1155, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    struct Series {
        uint32 assetId;
        bool isCall;
        bool settled;
        bool settledByAdmin;
        uint64 expiry;
        uint32 settleWindow;
        uint32 oracleGrace;
        uint256 strike;
        uint256 cap;
        uint256 open; // contracts outstanding
        uint256 reserved; // USDC reserved in the vault for this series
        int256 netPremium; // premiums received minus buy-backs paid, held until settlement
        uint256 settlementPrice;
        uint256 payoutPerContract;
        uint256 payableLeft; // settled payouts not redeemed yet
    }

    struct Quote {
        uint256 seriesId;
        bool isBuy; // true: the user buys from the vault at `premium` (ask); false: sells back (bid)
        uint256 premium;
        uint256 maxQty;
        uint64 deadline;
    }

    uint256 public constant ONE = 1e6;
    uint16 internal constant BPS = 10_000;
    uint32 public constant MAX_SETTLE_WINDOW = 3 days;
    uint32 public constant MAX_ORACLE_GRACE = 14 days;
    uint32 public constant MAX_TRADING_CUTOFF = 1 days;
    bytes32 public constant QUOTE_TYPEHASH =
        keccak256("Quote(uint256 seriesId,bool isBuy,uint256 premium,uint256 maxQty,uint64 deadline)");

    IMarketRegistry public immutable registry;
    IOracleRouter public immutable oracle;
    IVault public immutable vault;
    IFeeManager public immutable feeManager;
    IRiskManager public immutable riskManager;

    address public quoteSigner;
    address public keeper;
    /// trading stops this long before expiry
    uint32 public tradingCutoff;

    Series[] internal _series;
    mapping(bytes32 key => bool) public seriesExists;
    mapping(bytes32 quoteDigest => uint256) public quoteFilled;
    mapping(uint32 assetId => uint256) public reservedByAsset;

    event SeriesCreated(
        uint256 indexed seriesId, uint32 indexed assetId, bool isCall, uint256 strike, uint256 cap, uint64 expiry
    );
    event OptionPositionOpened(
        uint256 indexed seriesId, address indexed account, uint256 qty, uint256 premium, uint256 cost, uint256 fee
    );
    event OptionPositionClosed(
        uint256 indexed seriesId, address indexed account, uint256 qty, uint256 premium, uint256 proceeds, uint256 fee
    );
    event OptionSettled(uint256 indexed seriesId, uint256 price, uint256 payoutPerContract, bool byAdmin);
    event OptionExercised(uint256 indexed seriesId, address indexed account, uint256 qty, uint256 payout, uint256 fee);
    event QuoteSignerSet(address signer);
    event KeeperSet(address keeper);
    event TradingCutoffSet(uint32 cutoff);

    error InvalidParams();
    error UnknownSeries();
    error UnknownAsset();
    error OptionsDisabled();
    error SeriesExists();
    error TradingClosed();
    error NotExpired();
    error AlreadySettled();
    error NotSettled();
    error ZeroAmount();
    error DustOrder();
    error BadQuote();
    error QuoteExpired();
    error QuoteExhausted();
    error SlippageExceeded();
    error ReserveCapExceeded();
    error GraceNotOver();
    error NotKeeper();

    constructor(
        IMarketRegistry registry_,
        IOracleRouter oracle_,
        IVault vault_,
        IFeeManager feeManager_,
        IRiskManager riskManager_,
        address owner_,
        address quoteSigner_,
        address keeper_
    ) ERC1155("") Ownable(owner_) EIP712("HanMarket Options", "1") {
        registry = registry_;
        oracle = oracle_;
        vault = vault_;
        feeManager = feeManager_;
        riskManager = riskManager_;
        quoteSigner = quoteSigner_;
        keeper = keeper_;
        tradingCutoff = 30 minutes;
        emit QuoteSignerSet(quoteSigner_);
        emit KeeperSet(keeper_);
        emit TradingCutoffSet(30 minutes);
    }

    function name() external pure returns (string memory) {
        return "HanMarket Options";
    }

    function symbol() external pure returns (string memory) {
        return "HMOPT";
    }

    // ---------------------------------------------------------------- admin

    function setQuoteSigner(address signer) external onlyOwner {
        quoteSigner = signer;
        emit QuoteSignerSet(signer);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function setTradingCutoff(uint32 cutoff) external onlyOwner {
        if (cutoff > MAX_TRADING_CUTOFF) revert InvalidParams();
        tradingCutoff = cutoff;
        emit TradingCutoffSet(cutoff);
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

    function createSeries(
        uint32 assetId,
        bool isCall,
        uint256 strike,
        uint256 cap,
        uint64 expiry,
        uint32 settleWindow,
        uint32 oracleGrace
    ) external returns (uint256 seriesId) {
        if (msg.sender != owner() && msg.sender != keeper) revert NotKeeper();
        if (assetId >= registry.assetCount()) revert UnknownAsset();
        IMarketRegistry.Asset memory a = registry.getAsset(assetId);
        if (!a.optionsEnabled || !a.active) revert OptionsDisabled();
        if (strike == 0 || cap == 0 || (!isCall && cap > strike)) revert InvalidParams();
        if (expiry <= block.timestamp + tradingCutoff) revert InvalidParams();
        if (settleWindow == 0 || settleWindow > MAX_SETTLE_WINDOW || oracleGrace > MAX_ORACLE_GRACE) revert InvalidParams();

        bytes32 key = keccak256(abi.encode(assetId, isCall, strike, cap, expiry));
        if (seriesExists[key]) revert SeriesExists();
        seriesExists[key] = true;

        seriesId = _series.length;
        Series storage s = _series.push();
        s.assetId = assetId;
        s.isCall = isCall;
        s.expiry = expiry;
        s.settleWindow = settleWindow;
        s.oracleGrace = oracleGrace;
        s.strike = strike;
        s.cap = cap;
        emit SeriesCreated(seriesId, assetId, isCall, strike, cap, expiry);
    }

    // ---------------------------------------------------------------- trading

    /// @notice Buy `qty` contracts from the vault at a signed ask, paying at most `maxPremium` per contract.
    function buy(uint256 qty, uint256 maxPremium, Quote calldata q, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
    {
        Series storage s = _tradable(q.seriesId);
        if (!q.isBuy) revert BadQuote();
        _useQuote(q, signature, qty);
        if (q.premium > maxPremium) revert SlippageExceeded();

        uint256 cost = Math.mulDiv(qty, q.premium, ONE, Math.Rounding.Ceil);
        if (cost == 0) revert DustOrder();
        uint256 fee = (cost * feeManager.getFees().optionOpenFee) / BPS;

        uint256 reserveAmount = Math.mulDiv(qty, s.cap, ONE, Math.Rounding.Ceil);
        uint256 assetReserved = reservedByAsset[s.assetId] + reserveAmount;
        if (assetReserved > riskManager.optionsReserveCap(s.assetId)) revert ReserveCapExceeded();
        reservedByAsset[s.assetId] = assetReserved;
        s.reserved += reserveAmount;
        s.open += qty;
        _addPremium(s, int256(cost));

        vault.reserve(reserveAmount);
        vault.collectPremium(msg.sender, cost, fee);
        _mint(msg.sender, q.seriesId, qty, "");
        emit OptionPositionOpened(q.seriesId, msg.sender, qty, q.premium, cost, fee);
    }

    /// @notice Sell `qty` contracts back to the vault at a signed bid, receiving at least `minPremium` per contract.
    function sell(uint256 qty, uint256 minPremium, Quote calldata q, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
    {
        Series storage s = _tradable(q.seriesId);
        if (q.isBuy) revert BadQuote();
        _useQuote(q, signature, qty);
        if (q.premium < minPremium) revert SlippageExceeded();

        uint256 proceeds = Math.mulDiv(qty, q.premium, ONE);
        if (proceeds == 0) revert DustOrder();
        uint256 fee = (proceeds * feeManager.getFees().optionCloseFee) / BPS;

        _burn(msg.sender, q.seriesId, qty);
        uint256 releaseAmount = Math.mulDiv(s.reserved, qty, s.open);
        s.reserved -= releaseAmount;
        s.open -= qty;
        reservedByAsset[s.assetId] -= releaseAmount;
        _addPremium(s, -int256(proceeds));

        vault.release(releaseAmount);
        vault.payFromPool(msg.sender, proceeds, fee);
        emit OptionPositionClosed(q.seriesId, msg.sender, qty, q.premium, proceeds, fee);
    }

    // ---------------------------------------------------------------- settlement

    /// @notice Settle an expired series with the oracle router's expiry price. Anyone may call it.
    function settle(uint256 seriesId, bytes calldata oracleData) external nonReentrant {
        Series storage s = _settleable(seriesId);
        bytes32 oracleId = registry.getAsset(s.assetId).oracleId;
        uint256 price = oracle.settlementPrice(oracleId, s.expiry, s.settleWindow, oracleData);
        _applySettlement(seriesId, s, price, false);
    }

    /// @notice Manual settlement, only once the oracle grace period has passed without a valid price.
    function adminSettle(uint256 seriesId, uint256 price) external nonReentrant onlyOwner {
        Series storage s = _settleable(seriesId);
        if (block.timestamp < uint256(s.expiry) + s.oracleGrace) revert GraceNotOver();
        if (price == 0) revert InvalidParams();
        _applySettlement(seriesId, s, price, true);
    }

    /// @notice Burn settled options for their cash payout, credited to the vault balance.
    function redeem(uint256 seriesId, uint256 qty) external nonReentrant {
        Series storage s = _get(seriesId);
        if (!s.settled) revert NotSettled();
        if (qty == 0) revert ZeroAmount();

        _burn(msg.sender, seriesId, qty);
        uint256 payout = Math.mulDiv(qty, s.payoutPerContract, ONE);
        uint256 fee = (payout * feeManager.getFees().settlementFee) / BPS;
        s.payableLeft -= payout;
        if (payout > 0) vault.payFromPayable(msg.sender, payout, fee);
        emit OptionExercised(seriesId, msg.sender, qty, payout, fee);
    }

    // ---------------------------------------------------------------- views

    function seriesCount() external view returns (uint256) {
        return _series.length;
    }

    function getSeries(uint256 seriesId) external view returns (Series memory) {
        return _get(seriesId);
    }

    /// @notice Payout per contract at a hypothetical settlement price.
    function payoutAt(uint256 seriesId, uint256 price) public view returns (uint256) {
        Series storage s = _get(seriesId);
        uint256 intrinsic;
        if (s.isCall) intrinsic = price > s.strike ? price - s.strike : 0;
        else intrinsic = s.strike > price ? s.strike - price : 0;
        return intrinsic < s.cap ? intrinsic : s.cap;
    }

    function quoteDigest(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q.seriesId, q.isBuy, q.premium, q.maxQty, q.deadline)));
    }

    // ---------------------------------------------------------------- internal

    function _get(uint256 seriesId) internal view returns (Series storage) {
        if (seriesId >= _series.length) revert UnknownSeries();
        return _series[seriesId];
    }

    function _tradable(uint256 seriesId) internal view returns (Series storage s) {
        s = _get(seriesId);
        if (s.settled || block.timestamp + tradingCutoff >= s.expiry) revert TradingClosed();
    }

    function _settleable(uint256 seriesId) internal view returns (Series storage s) {
        s = _get(seriesId);
        if (s.settled) revert AlreadySettled();
        if (block.timestamp < s.expiry) revert NotExpired();
    }

    function _useQuote(Quote calldata q, bytes calldata signature, uint256 qty) internal {
        if (qty == 0) revert ZeroAmount();
        if (block.timestamp > q.deadline) revert QuoteExpired();
        Series storage s = _series[q.seriesId];
        if (q.premium == 0 || q.premium > s.cap) revert BadQuote();
        bytes32 digest = quoteDigest(q);
        address signer = ECDSA.recover(digest, signature);
        if (signer == address(0) || signer != quoteSigner) revert BadQuote();
        uint256 filled = quoteFilled[digest] + qty;
        if (filled > q.maxQty) revert QuoteExhausted();
        quoteFilled[digest] = filled;
    }

    /// premiums count towards LP value only once the series settles; only the positive net is held back
    function _addPremium(Series storage s, int256 delta) internal {
        int256 before = s.netPremium > 0 ? s.netPremium : int256(0);
        s.netPremium += delta;
        int256 afterward = s.netPremium > 0 ? s.netPremium : int256(0);
        if (afterward != before) vault.adjustDeferred(afterward - before);
    }

    function _applySettlement(uint256 seriesId, Series storage s, uint256 price, bool byAdmin) internal {
        uint256 payout = payoutAt(seriesId, price);
        uint256 total = Math.mulDiv(s.open, payout, ONE, Math.Rounding.Ceil);

        s.settled = true;
        s.settledByAdmin = byAdmin;
        s.settlementPrice = price;
        s.payoutPerContract = payout;
        s.payableLeft = total;

        reservedByAsset[s.assetId] -= s.reserved;
        vault.release(s.reserved);
        s.reserved = 0;
        if (s.netPremium > 0) vault.adjustDeferred(-s.netPremium);
        s.netPremium = 0;
        if (total > 0) vault.poolToPayable(total);
        emit OptionSettled(seriesId, price, payout, byAdmin);
    }

    // Tokens cannot move while the engine is paused, so a halt also stops secondary transfers.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0) && to != address(0)) _requireNotPaused();
        super._update(from, to, ids, values);
    }
}
