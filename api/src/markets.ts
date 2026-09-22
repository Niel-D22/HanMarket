// Creates the weekly option chains on OptionsEngine.
//
// For every asset with options enabled: calls and puts at 5 strikes around spot, for each of the next
// `weeks` Fridays at the exchange close (16:00 New York for ADRs, 16:00 Hong Kong for HK listings).
// Signs with KEEPER_PRIVATE_KEY, which must be the OptionsEngine keeper (or owner).
//
// Run weekly from the keeper (src/index.ts) and on demand from scripts/create-markets.ts.
import { keccak256, encodeAbiParameters, type PrivateKeyAccount } from 'viem';
import { ASSETS } from './assets';
import { getQuotes } from './prices';
import { NETWORKS, accountFromEnv, publicClientFor, walletClientFor, type NetworkKey } from './chain';
import { optionsAbi, oracleAbi, registryAbi } from './protocol/abis';
import { logger } from './logger';

/** Unix times of the next `count` Fridays at 16:00 in `tz`, the first at least `minHours` away. */
export function fridayCloses(tz: string, count: number, minHours = 24): number[] {
  const out: number[] = [];
  const now = Date.now();
  for (let d = 0; out.length < count && d < 7 * count + 8; d++) {
    const day = new Date(now + d * 86_400_000);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(day).map((p) => [p.type, p.value]),
    );
    if (parts.weekday !== 'Fri') continue;
    // 16:00 local = 16:00 UTC minus the zone's offset on that date
    const guess = Date.UTC(+parts.year, +parts.month - 1, +parts.day, 16, 0, 0);
    const local = new Date(new Date(guess).toLocaleString('en-US', { timeZone: tz }));
    const utc = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
    const ts = Math.floor((guess - (local.getTime() - utc.getTime())) / 1000);
    if (ts * 1000 - now >= minHours * 3_600_000 && !out.includes(ts)) out.push(ts);
  }
  return out;
}

/** A round strike step for a price: 1, 2.5 or 5 times a power of ten, about 2.5% of spot. */
export function strikeStep(spot: number): number {
  const target = spot * 0.025;
  const pow = 10 ** Math.floor(Math.log10(target));
  return [1, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= target) ?? 10 * pow;
}

const usd6 = (n: number) => BigInt(Math.round(n * 1e6));

export interface CreateMarketsOptions {
  network: NetworkKey;
  /** how many upcoming Fridays to open, 1–8 */
  weeks?: number;
  /** only these symbols, uppercase; every asset when omitted */
  only?: string[];
  dryRun?: boolean;
  /**
   * Stop once the keeper's balance would fall below this, in wei. Creating a chain for every asset costs
   * far more gas than a day of keeping, and a keeper that cannot pay for gas stops updating prices,
   * settling options and liquidating — so the keeper's own budget comes first.
   */
  gasFloorWei?: bigint;
  log?: (line: string) => void;
}

export interface CreateMarketsResult {
  created: number;
  existed: number;
  skipped: string[];
  /** set when the run stopped early to leave the keeper its gas */
  stoppedForGas?: boolean;
}

export async function createMarkets(opts: CreateMarketsOptions): Promise<CreateMarketsResult> {
  const { network, weeks = 2, only, dryRun = false, gasFloorWei = 0n } = opts;
  const log = opts.log ?? ((l: string) => logger.info(`[markets:${network}] ${l}`));

  const d = NETWORKS[network].deployment;
  if (!d) throw new Error(`${network.toUpperCase()}_DEPLOYMENT is not set`);
  const keeper = accountFromEnv('KEEPER_PRIVATE_KEY');
  if (!keeper && !dryRun) throw new Error('KEEPER_PRIVATE_KEY is not set');

  const client = publicClientFor(network);
  const wallet = keeper ? walletClientFor(network, keeper) : null;
  const { quotes: marks } = await getQuotes();

  const assetCount = Number(await client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'assetCount' }));
  const onchain = new Map<string, { id: number; chainlink: boolean }>();
  for (let i = 0; i < assetCount; i++) {
    const a = await client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [i] });
    if (!a.active || !a.optionsEnabled) continue;
    const feed = await client.readContract({ address: d.oracleRouter, abi: oracleAbi, functionName: 'getFeed', args: [a.oracleId] });
    onchain.set(a.symbol, { id: i, chainlink: feed.source === 1 });
  }

  const out: CreateMarketsResult = { created: 0, existed: 0, skipped: [] };

  for (const asset of ASSETS) {
    if (only && !only.includes(asset.symbol)) continue;
    const reg = onchain.get(asset.symbol);
    const spot = marks[asset.symbol]?.priceUsd;
    if (!reg || !spot) {
      out.skipped.push(`${asset.symbol}: ${!reg ? 'not registered or options disabled' : 'no price'}`);
      continue;
    }

    const step = strikeStep(spot);
    const atm = Math.round(spot / step) * step;
    // Chainlink equity feeds can go a day without an update, so their window matches the feed heartbeat
    const settleWindow = reg.chainlink ? 86_400 : 1_800;
    const oracleGrace = 3 * 86_400;

    for (const expiryNum of fridayCloses(asset.board === 'HK' ? 'Asia/Hong_Kong' : 'America/New_York', weeks)) {
      const expiry = BigInt(expiryNum);
      for (const k of [-2, -1, 0, 1, 2]) {
        const strikeNum = +(atm + k * step).toFixed(6);
        if (strikeNum <= 0) continue;
        for (const isCall of [true, false]) {
          const strike = usd6(strikeNum);
          const capNum = isCall ? step * 4 : Math.min(step * 4, strikeNum);
          const cap = usd6(capNum);
          const key = keccak256(encodeAbiParameters(
            [{ type: 'uint32' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint64' }],
            [reg.id, isCall, strike, cap, expiry],
          ));
          const label = `${asset.symbol} ${isCall ? 'C' : 'P'} $${strikeNum} cap $${capNum} exp ${new Date(expiryNum * 1000).toISOString()}`;

          const exists = await client.readContract({ address: d.optionsEngine, abi: optionsAbi, functionName: 'seriesExists', args: [key] });
          if (exists) { out.existed++; continue; }
          if (dryRun || !wallet || !keeper) { log(`would create ${label}`); continue; }

          if (gasFloorWei > 0n && (await client.getBalance({ address: keeper.address })) <= gasFloorWei) {
            log(`stopping: keeper balance is down to its gas floor, ${out.created} series created`);
            out.stoppedForGas = true;
            return out;
          }

          const { request } = await client.simulateContract({
            account: keeper as PrivateKeyAccount, address: d.optionsEngine, abi: optionsAbi, functionName: 'createSeries',
            args: [reg.id, isCall, strike, cap, expiry, settleWindow, oracleGrace],
          });
          const hash = await wallet.writeContract(request);
          await client.waitForTransactionReceipt({ hash });
          out.created++;
          log(`created ${label}`);
        }
      }
    }
  }
  return out;
}
