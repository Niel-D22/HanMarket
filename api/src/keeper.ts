import { encodeAbiParameters, type Address, type PrivateKeyAccount } from 'viem';
import { NETWORKS, accountFromEnv, publicClientFor, walletClientFor, type NetworkKey } from './chain';
import { aggregatorAbi, optionsAbi, oracleAbi, perpsAbi, registryAbi, riskAbi, testnetFeedAbi, SETTLEMENT_TYPES } from './protocol/abis';
import { isPerpSessionOpen, isSessionOpen } from './protocol/sessions';
import { findAsset } from './assets';
import { getQuotes } from './prices';
import { logger } from './logger';
import { observePrice } from './settlementPrice';

// The protocol's bots. None of them can move anyone's funds; they only trigger what the contracts allow.
//
//   settlement   (every 5 min)  settles expired option series: Chainlink assets with the feed round that was
//                               live at expiry, other assets with a price signed by PRICE_SIGNER_KEY.
//   sessions     (every minute) opens and closes each perp market with its exchange session (RiskManager keeper).
//   liquidations (every minute) liquidates perp positions below maintenance margin and earns the liquidation fee.
//   testnet feeds (every minute, testnet only) pushes the Robinhood price into the TestnetPriceFeed that stands in
//                               for Chainlink, on a 0.1% move or every 15 minutes.
//
// KEEPER_PRIVATE_KEY pays the gas and must be the RiskManager / OptionsEngine keeper.

const NETS: NetworkKey[] = ['testnet', 'mainnet'];
const short = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? String(e)).split('\n')[0];

// ---------------------------------------------------------------- settlement

async function findRoundAtOrBefore(key: NetworkKey, feed: Address, expiry: bigint): Promise<bigint | null> {
  const client = publicClientFor(key);
  const [latestId, , , latestUpdated] = await client.readContract({ address: feed, abi: aggregatorAbi, functionName: 'latestRoundData' });
  if (latestUpdated <= expiry) return latestId;
  // round ids are (phase << 64) | aggregatorRound; walk back inside the current phase
  const phase = latestId >> 64n;
  let round = latestId & ((1n << 64n) - 1n);
  for (let steps = 0; steps < 2_000 && round > 1n; steps++) {
    round -= 1n;
    const id = (phase << 64n) | round;
    const data = await client.readContract({ address: feed, abi: aggregatorAbi, functionName: 'getRoundData', args: [id] }).catch(() => null);
    if (data && data[3] > 0n && data[3] <= expiry) return id;
  }
  return null;
}

async function settleNetwork(key: NetworkKey, keeper: PrivateKeyAccount, signer: PrivateKeyAccount | null) {
  const { deployment: d, chain } = NETWORKS[key];
  if (!d) return;
  const client = publicClientFor(key);
  const wallet = walletClientFor(key, keeper);
  const now = BigInt(Math.floor(Date.now() / 1000));

  const count = await client.readContract({ address: d.optionsEngine, abi: optionsAbi, functionName: 'seriesCount' });
  const assets = new Map<number, { symbol: string; oracleId: `0x${string}` }>();
  // one oracle payload settles every series of an asset with the same expiry
  const payloads = new Map<string, `0x${string}` | null>();

  for (let i = 0n; i < count; i++) {
    const s = await client.readContract({ address: d.optionsEngine, abi: optionsAbi, functionName: 'getSeries', args: [i] });
    if (s.settled || s.expiry > now) continue;

    let asset = assets.get(s.assetId);
    if (!asset) {
      const a = await client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [s.assetId] });
      asset = { symbol: a.symbol, oracleId: a.oracleId };
      assets.set(s.assetId, asset);
    }

    const cacheKey = `${asset.oracleId}:${s.expiry}`;
    try {
      if (!payloads.has(cacheKey)) {
        const feed = await client.readContract({ address: d.oracleRouter, abi: oracleAbi, functionName: 'getFeed', args: [asset.oracleId] });
        let payload: `0x${string}` | null = null;
        if (feed.source === 1) {
          const roundId = await findRoundAtOrBefore(key, feed.aggregator, s.expiry);
          if (roundId === null) logger.warn(`[settle:${key}] ${asset.symbol}: no Chainlink round before expiry, admin settles after grace`);
          else payload = encodeAbiParameters([{ type: 'uint80' }], [roundId]);
        } else if (!signer) {
          logger.warn(`[settle:${key}] PRICE_SIGNER_KEY not set, cannot settle ${asset.symbol}`);
        } else {
          const observed = await observePrice(asset.symbol, Number(s.expiry), s.settleWindow);
          if (!observed) {
            logger.warn(`[settle:${key}] ${asset.symbol}: no price around expiry yet`);
          } else {
            const publishTime = BigInt(Math.min(observed.publishTime, Number(now)));
            const signature = await signer.signTypedData({
              domain: { name: 'HanMarket', version: '1', chainId: chain.id, verifyingContract: d.oracleRouter },
              types: SETTLEMENT_TYPES,
              primaryType: 'SettlementPrice',
              message: { oracleId: asset.oracleId, expiry: s.expiry, price: observed.price6, publishTime },
            });
            payload = encodeAbiParameters(
              [{ type: 'uint256' }, { type: 'uint64' }, { type: 'bytes' }],
              [observed.price6, publishTime, signature],
            );
            logger.info(`[settle:${key}] ${asset.symbol} expiry price ${Number(observed.price6) / 1e6} USD from ${observed.source}`);
          }
        }
        payloads.set(cacheKey, payload);
      }
      const payload = payloads.get(cacheKey);
      if (!payload) continue;

      const { request } = await client.simulateContract({
        account: keeper, address: d.optionsEngine, abi: optionsAbi, functionName: 'settle', args: [i, payload],
      });
      const hash = await wallet.writeContract(request);
      await client.waitForTransactionReceipt({ hash });
      logger.info(`[settle:${key}] series ${i} (${asset.symbol}) settled, tx ${hash}`);
    } catch (e) {
      logger.error(`[settle:${key}] series ${i} (${asset.symbol}) failed: ${short(e)}`);
    }
  }
}

// ---------------------------------------------------------------- sessions

async function syncSessions(key: NetworkKey, keeper: PrivateKeyAccount) {
  const { deployment: d } = NETWORKS[key];
  if (!d) return;
  const client = publicClientFor(key);
  const wallet = walletClientFor(key, keeper);
  const { quotes } = await getQuotes().catch(() => ({ quotes: {} as Record<string, { halted?: boolean }> }));

  const n = Number(await client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'perpMarketCount' }));
  for (let m = 0; m < n; m++) {
    const market = await client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'getPerpMarket', args: [m] });
    const asset = await client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [market.assetId] });
    const info = findAsset(asset.symbol);
    const halted = !!(quotes as Record<string, { halted?: boolean }>)[asset.symbol]?.halted;
    // Robinhood-tokenized US shares (with a Chainlink feed) trade on weekdays around the clock; others follow their exchange
    const open = !halted && (info?.board === 'HK' ? isSessionOpen('HK') : isPerpSessionOpen());
    const current = await client.readContract({ address: d.riskManager, abi: riskAbi, functionName: 'tradingOpen', args: [m] });
    if (current === open) continue;
    try {
      const { request } = await client.simulateContract({
        account: keeper, address: d.riskManager, abi: riskAbi, functionName: 'setTradingOpen', args: [m, open],
      });
      const hash = await wallet.writeContract(request);
      await client.waitForTransactionReceipt({ hash });
      logger.info(`[sessions:${key}] ${market.symbol} ${open ? 'opened' : 'closed'}${halted ? ' (halted)' : ''}, tx ${hash}`);
    } catch (e) {
      logger.error(`[sessions:${key}] ${market.symbol}: ${short(e)}`);
    }
  }
}

// ---------------------------------------------------------------- liquidations

/** positions seen in PerpPositionOpened events, per network, found by an incremental log scan */
const tracked: Record<NetworkKey, { cursor: bigint; positions: Map<string, { account: Address; marketId: number; isLong: boolean }> }> = {
  testnet: { cursor: 0n, positions: new Map() },
  mainnet: { cursor: 0n, positions: new Map() },
};
const LOG_CHUNK = 9_000n;

async function scanPositions(key: NetworkKey) {
  const { deployment: d } = NETWORKS[key];
  if (!d) return;
  const client = publicClientFor(key);
  const t = tracked[key];
  if (t.cursor === 0n) t.cursor = BigInt(d.startBlock);
  const head = await client.getBlockNumber();
  const event = perpsAbi.find((x) => x.type === 'event' && x.name === 'PerpPositionOpened')!;
  while (t.cursor <= head) {
    const to = t.cursor + LOG_CHUNK > head ? head : t.cursor + LOG_CHUNK;
    const logs = await client.getLogs({ address: d.perpsEngine, event: event as never, fromBlock: t.cursor, toBlock: to });
    for (const log of logs as unknown as { args: { account: Address; marketId: number; isLong: boolean } }[]) {
      const { account, marketId, isLong } = log.args;
      t.positions.set(`${account}:${marketId}:${isLong}`, { account, marketId: Number(marketId), isLong });
    }
    t.cursor = to + 1n;
  }
}

async function liquidateNetwork(key: NetworkKey, keeper: PrivateKeyAccount) {
  const { deployment: d } = NETWORKS[key];
  if (!d) return;
  await scanPositions(key);
  const client = publicClientFor(key);
  const wallet = walletClientFor(key, keeper);
  for (const [id, p] of tracked[key].positions) {
    try {
      const info = await client.readContract({
        address: d.perpsEngine, abi: perpsAbi, functionName: 'positionInfo', args: [p.account, p.marketId, p.isLong],
      });
      if (info.size === 0n) {
        tracked[key].positions.delete(id);
        continue;
      }
      if (!info.liquidatable) continue;
      const { request } = await client.simulateContract({
        account: keeper, address: d.perpsEngine, abi: perpsAbi, functionName: 'liquidate', args: [p.account, p.marketId, p.isLong],
      });
      const hash = await wallet.writeContract(request);
      await client.waitForTransactionReceipt({ hash });
      tracked[key].positions.delete(id);
      logger.info(`[liquidate:${key}] ${p.account} market ${p.marketId} ${p.isLong ? 'long' : 'short'} liquidated, tx ${hash}`);
    } catch (e) {
      logger.error(`[liquidate:${key}] ${id}: ${short(e)}`);
    }
  }
}

// ---------------------------------------------------------------- testnet feeds

const FEED_DEVIATION = 0.001;
const FEED_HEARTBEAT = 15 * 60;

async function pushTestnetFeeds(key: NetworkKey, keeper: PrivateKeyAccount) {
  const { deployment: d } = NETWORKS[key];
  if (key !== 'testnet' || !d) return;
  const client = publicClientFor(key);
  const wallet = walletClientFor(key, keeper);
  const { quotes } = await getQuotes();

  const n = Number(await client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'perpMarketCount' }));
  for (let m = 0; m < n; m++) {
    const market = await client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'getPerpMarket', args: [m] });
    const asset = await client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [market.assetId] });
    const feed = await client.readContract({ address: d.oracleRouter, abi: oracleAbi, functionName: 'getFeed', args: [asset.oracleId] });
    if (feed.source !== 1) continue;
    // only feeds this keeper runs; a real Chainlink aggregator has no updater()
    const updater = await client.readContract({ address: feed.aggregator, abi: testnetFeedAbi, functionName: 'updater' }).catch(() => null);
    if (!updater || updater.toLowerCase() !== keeper.address.toLowerCase()) continue;

    const price = quotes[asset.symbol]?.priceUsd;
    if (!price) continue;
    const [, answer, , updatedAt] = await client.readContract({ address: feed.aggregator, abi: aggregatorAbi, functionName: 'latestRoundData' });
    const last = Number(answer) / 1e8;
    const age = Date.now() / 1000 - Number(updatedAt);
    if (last > 0 && Math.abs(price - last) / last < FEED_DEVIATION && age < FEED_HEARTBEAT) continue;
    try {
      const { request } = await client.simulateContract({
        account: keeper, address: feed.aggregator, abi: testnetFeedAbi, functionName: 'push', args: [BigInt(Math.round(price * 1e8))],
      });
      const hash = await wallet.writeContract(request);
      await client.waitForTransactionReceipt({ hash });
      logger.info(`[feeds:${key}] ${asset.symbol} ${last} -> ${price.toFixed(4)} USD, tx ${hash}`);
    } catch (e) {
      logger.error(`[feeds:${key}] ${asset.symbol}: ${short(e)}`);
    }
  }
}

// ---------------------------------------------------------------- runners

function runner(name: string, job: (key: NetworkKey, keeper: PrivateKeyAccount) => Promise<void>) {
  let running = false;
  return async () => {
    const keeper = accountFromEnv('KEEPER_PRIVATE_KEY');
    if (!keeper || running) return;
    running = true;
    try {
      for (const key of NETS) await job(key, keeper).catch((e) => logger.error(`[${name}:${key}] ${short(e)}`));
    } finally {
      running = false;
    }
  };
}

export const runSettlement = runner('settle', (key, keeper) => settleNetwork(key, keeper, accountFromEnv('PRICE_SIGNER_KEY')));
export const runSessions = runner('sessions', syncSessions);
export const runLiquidations = runner('liquidate', liquidateNetwork);
export const runTestnetFeeds = runner('feeds', pushTestnetFeeds);

/** Everything once, for `npm run keeper:once`. */
export async function runKeeper() {
  await runTestnetFeeds();
  await runSessions();
  await runLiquidations();
  await runSettlement();
}
