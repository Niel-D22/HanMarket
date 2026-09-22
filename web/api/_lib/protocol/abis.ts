import { parseAbi } from 'viem';

// Human-readable ABIs of contracts/src (only what the app, the pricing service and the keeper call).
// Shared by the web app and the serverless functions in web/api.

export const registryAbi = parseAbi([
  'struct Asset { string symbol; bytes32 oracleId; address token; bool optionsEnabled; bool perpsEnabled; bool active; }',
  'struct PerpMarket { string symbol; uint32 assetId; bool active; }',
  'function assetCount() view returns (uint256)',
  'function getAsset(uint32 assetId) view returns (Asset)',
  'function perpMarketCount() view returns (uint256)',
  'function getPerpMarket(uint32 marketId) view returns (PerpMarket)',
]);

export const oracleAbi = parseAbi([
  'struct Feed { uint8 source; address aggregator; uint8 decimals; uint32 maxAge; bool paused; }',
  'function getPrice(bytes32 oracleId) view returns (uint256 price, uint256 timestamp)',
  'function getFeed(bytes32 oracleId) view returns (Feed)',
  'function priceSigner() view returns (address)',
]);

export const riskAbi = parseAbi([
  'struct PerpRisk { uint16 maxLeverage; uint16 initialMarginBps; uint16 maintenanceMarginBps; uint32 maxProfitBps; uint32 fundingInterval; uint32 maxPriceAge; uint64 fundingRatePerInterval; uint256 maxPositionNotional; uint256 openInterestCap; }',
  'function getPerpRisk(uint32 marketId) view returns (PerpRisk)',
  'function tradingOpen(uint32 marketId) view returns (bool)',
  'function setTradingOpen(uint32 marketId, bool open)',
  'function optionsReserveCap(uint32 assetId) view returns (uint256)',
  'function maxUtilizationBps() view returns (uint16)',
]);

export const feeAbi = parseAbi([
  'struct FeeConfig { uint16 makerFee; uint16 takerFee; uint16 optionOpenFee; uint16 optionCloseFee; uint16 settlementFee; uint16 liquidationFee; }',
  'function getFees() view returns (FeeConfig)',
]);

export const vaultAbi = parseAbi([
  'function collateralToken() view returns (address)',
  'function balances(address) view returns (uint256)',
  'function lockedMargin(address) view returns (uint256)',
  'function deposit(uint256 amount)',
  'function withdraw(uint256 amount)',
  'function nav() view returns (uint256)',
  'function freeLiquidity() view returns (uint256)',
  'function poolAmount() view returns (uint256)',
  'function reservedAmount() view returns (uint256)',
  'function utilizationBps() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function lpUnlockAt(address) view returns (uint64)',
  'function previewAddLiquidity(uint256 amount) view returns (uint256)',
  'function previewRemoveLiquidity(uint256 shares) view returns (uint256)',
  'function addLiquidity(uint256 amount, uint256 minShares) returns (uint256)',
  'function removeLiquidity(uint256 shares, uint256 minAmount) returns (uint256)',
]);

export const optionsAbi = parseAbi([
  'struct Series { uint32 assetId; bool isCall; bool settled; bool settledByAdmin; uint64 expiry; uint32 settleWindow; uint32 oracleGrace; uint256 strike; uint256 cap; uint256 open; uint256 reserved; int256 netPremium; uint256 settlementPrice; uint256 payoutPerContract; uint256 payableLeft; }',
  'struct Quote { uint256 seriesId; bool isBuy; uint256 premium; uint256 maxQty; uint64 deadline; }',
  'function seriesCount() view returns (uint256)',
  'function getSeries(uint256 seriesId) view returns (Series)',
  'function seriesExists(bytes32 key) view returns (bool)',
  'function tradingCutoff() view returns (uint32)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
  'function createSeries(uint32 assetId, bool isCall, uint256 strike, uint256 cap, uint64 expiry, uint32 settleWindow, uint32 oracleGrace) returns (uint256)',
  'function buy(uint256 qty, uint256 maxPremium, Quote q, bytes signature)',
  'function sell(uint256 qty, uint256 minPremium, Quote q, bytes signature)',
  'function settle(uint256 seriesId, bytes oracleData)',
  'function redeem(uint256 seriesId, uint256 qty)',
]);

export const perpsAbi = parseAbi([
  'struct Position { uint256 size; uint256 collateral; uint256 entryNotional; uint256 reserved; uint256 fundingIndex; uint64 lastUpdated; }',
  'struct MarketState { uint256 longSize; uint256 shortSize; uint256 longEntryNotional; uint256 shortEntryNotional; uint256 longFundingIndex; uint256 shortFundingIndex; uint64 lastFundingTime; }',
  'struct PositionInfo { uint256 size; uint256 collateral; uint256 entryPrice; uint256 markPrice; uint256 notional; int256 pnl; uint256 fundingOwed; int256 equity; uint256 leverageBps; uint256 liquidationPrice; uint256 maintenanceMargin; bool liquidatable; }',
  'function increasePosition(uint32 marketId, bool isLong, uint256 collateralDelta, uint256 sizeDeltaUsd, uint256 acceptablePrice, uint64 deadline)',
  'function decreasePosition(uint32 marketId, bool isLong, uint256 sizeDeltaUsd, uint256 collateralOut, uint256 acceptablePrice, uint64 deadline)',
  'function closePosition(uint32 marketId, bool isLong, uint256 acceptablePrice, uint64 deadline)',
  'function liquidate(address account, uint32 marketId, bool isLong)',
  'function getPosition(address account, uint32 marketId, bool isLong) view returns (Position)',
  'function getMarketState(uint32 marketId) view returns (MarketState)',
  'function positionInfo(address account, uint32 marketId, bool isLong) view returns (PositionInfo)',
  'function currentFundingRate(uint32 marketId) view returns (int256)',
  'function nextFundingTime(uint32 marketId) view returns (uint256)',
  'event PerpPositionOpened(bytes32 indexed key, address indexed account, uint32 indexed marketId, bool isLong, uint256 sizeUsd, uint256 collateral, uint256 price, uint256 fee)',
  'event PerpPositionClosed(bytes32 indexed key, address indexed account, uint32 indexed marketId, bool isLong, uint256 price, int256 realizedPnl, uint256 payout, uint256 fee)',
  'event PerpPositionUpdated(bytes32 indexed key, address indexed account, uint32 indexed marketId, bool isLong, uint256 size, uint256 collateral, uint256 entryNotional, uint256 price, int256 realizedPnl, uint256 fee)',
  'event PositionLiquidated(bytes32 indexed key, address indexed account, uint32 indexed marketId, bool isLong, uint256 price, int256 equity, address liquidator, uint256 reward, uint256 returned)',
]);

export const optionsEventsAbi = parseAbi([
  'event OptionPositionOpened(uint256 indexed seriesId, address indexed account, uint256 qty, uint256 premium, uint256 cost, uint256 fee)',
  'event OptionPositionClosed(uint256 indexed seriesId, address indexed account, uint256 qty, uint256 premium, uint256 proceeds, uint256 fee)',
  'event OptionExercised(uint256 indexed seriesId, address indexed account, uint256 qty, uint256 payout, uint256 fee)',
]);

export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function mint(address to, uint256 amount)',
]);

export const aggregatorAbi = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function getRoundData(uint80 roundId) view returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80)',
]);

/** contracts/src/testnet/TestnetPriceFeed.sol: the keeper-updated stand-in for Chainlink on testnet only */
export const testnetFeedAbi = parseAbi([
  'function updater() view returns (address)',
  'function push(int256 answer) returns (uint80)',
]);

/** EIP-712 type of an option quote, signed by the pricing service. */
export const QUOTE_TYPES = {
  Quote: [
    { name: 'seriesId', type: 'uint256' },
    { name: 'isBuy', type: 'bool' },
    { name: 'premium', type: 'uint256' },
    { name: 'maxQty', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

/** EIP-712 type of a settlement price for assets without a Chainlink feed. */
export const SETTLEMENT_TYPES = {
  SettlementPrice: [
    { name: 'oracleId', type: 'bytes32' },
    { name: 'expiry', type: 'uint64' },
    { name: 'price', type: 'uint256' },
    { name: 'publishTime', type: 'uint64' },
  ],
} as const;
