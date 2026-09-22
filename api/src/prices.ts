import https from 'https';
import { ASSETS, USD_HKD_FEED_ID, type ChinaAsset } from './assets';
import { getQuote as getRhQuote } from './robinhood';
import { logger } from './logger';

// Quotes for the HanMarket asset catalogue.
// Source 1: Pyth Hermes (needs PYTH_API_KEY since the Aug 2026 Pyth Core upgrade). Kept on the server
//           so the key is never shipped in the browser bundle.
// Source 2: Yahoo Finance chart API, used when Pyth is not configured or a feed returns nothing.

export interface Quote {
  symbol: string;
  price: number;        // in the asset's own currency (HKD for HK listings, USD for ADRs)
  priceUsd: number;     // what strikes and settlement use
  currency: 'HKD' | 'USD';
  change24h: number;    // % vs previous close
  source: 'robinhood' | 'pyth' | 'yahoo';
  publishTime: number;  // unix seconds
  /** true when Robinhood reports the underlying equity is halted */
  halted?: boolean;
}

const CACHE_MS = 5_000;
type Snapshot = { at: number; quotes: Record<string, Quote>; usdHkd: number };
let cache: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;

function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers }, timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) return reject(new Error(`${res.statusCode} ${body.slice(0, 120)}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function yahooQuote(ticker: string) {
  const json = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`);
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return null;
  const prev = meta.chartPreviousClose || meta.previousClose;
  return {
    price: meta.regularMarketPrice as number,
    change24h: prev ? ((meta.regularMarketPrice - prev) / prev) * 100 : 0,
    publishTime: (meta.regularMarketTime as number) || Math.floor(Date.now() / 1000),
  };
}

async function pythPrices(feedIds: string[]): Promise<Record<string, { price: number; publishTime: number }>> {
  const key = process.env.PYTH_API_KEY;
  if (!key) return {};
  const base = process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network';
  const qs = feedIds.map((id) => `ids[]=${id}`).join('&');
  const json = await getJson(`${base}/v2/updates/price/latest?${qs}&parsed=true&ignore_invalid_price_ids=true`, {
    Authorization: `Bearer ${key}`,
  });
  const out: Record<string, { price: number; publishTime: number }> = {};
  for (const p of json?.parsed ?? []) {
    out[p.id] = { price: Number(p.price.price) * 10 ** p.price.expo, publishTime: p.price.publish_time };
  }
  return out;
}

// Some networks (several Indonesian ISPs, for one) block robinhood.com, and a run from there would quietly
// fall back to Yahoo's previous close — strikes and the onchain testnet feed would then disagree with the
// price the website shows. PRICES_URL borrows the snapshot from a deployed HanMarket API instead.
const upstream = () => process.env.PRICES_URL;

async function upstreamSnapshot(url: string): Promise<Snapshot> {
  const res = await fetch(`${url.replace(/\/$/, '')}/prices`);
  const json = await res.json() as { success: boolean; data?: Record<string, Quote>; usdHkd?: number; error?: string };
  if (!json.success || !json.data) throw new Error(json.error ?? 'no data');
  return { at: Date.now(), quotes: json.data, usdHkd: json.usdHkd ?? 7.8 };
}

async function refresh(): Promise<Snapshot> {
  const url = upstream();
  if (url) {
    try {
      return await upstreamSnapshot(url);
    } catch (e) {
      logger.warn(`PRICES_URL fetch failed, pricing locally instead: ${e}`);
    }
  }

  let pyth: Awaited<ReturnType<typeof pythPrices>> = {};
  try {
    pyth = await pythPrices([...ASSETS.map((a) => a.pythFeedId), USD_HKD_FEED_ID]);
  } catch (e) {
    logger.warn(`Pyth quote fetch failed, falling back to Yahoo: ${e}`);
  }

  // Robinhood's own API is the most faithful price for the equities they tokenized (BABA, FUTU today):
  // it is the quote their token tracks, and it carries the corporate-action multiplier and halt flag.
  const rhQuotes = await Promise.all(
    ASSETS.map((a) => (a.rhToken ? getRhQuote(a.rhToken).catch(() => null) : Promise.resolve(null))),
  );

  // Yahoo gives the 24h change even when another source supplies the price, so it is always fetched.
  const yahoo = await Promise.all(
    [...ASSETS.map((a) => a.yahoo), 'HKDUSD=X'].map((t) => yahooQuote(t).catch(() => null)),
  );
  const fxYahoo = yahoo[yahoo.length - 1];
  const usdHkd = pyth[USD_HKD_FEED_ID]?.price || (fxYahoo?.price ? 1 / fxYahoo.price : 7.8);

  const quotes: Record<string, Quote> = {};
  ASSETS.forEach((asset: ChinaAsset, i) => {
    const y = yahoo[i];
    const p = pyth[asset.pythFeedId];
    const rh = rhQuotes[i];
    const price = rh?.price ?? p?.price ?? y?.price;
    if (!price) return;
    quotes[asset.symbol] = {
      symbol: asset.symbol,
      price,
      priceUsd: asset.currency === 'HKD' ? price / usdHkd : price,
      currency: asset.currency,
      change24h: y?.change24h ?? 0,
      source: rh ? 'robinhood' : p ? 'pyth' : 'yahoo',
      publishTime: rh?.generatedAt ?? p?.publishTime ?? y?.publishTime ?? Math.floor(Date.now() / 1000),
      halted: rh?.halted,
    };
  });
  return { at: Date.now(), quotes, usdHkd };
}

export async function getQuotes(): Promise<Snapshot> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  if (!inflight) {
    inflight = refresh()
      .then((c) => (cache = c))
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// Candles for the terminal chart (Yahoo Finance; Pyth Benchmarks does not carry HK intraday history).
export const CANDLE_RANGES = {
  '1D': { range: '1d', interval: '5m' },
  '5D': { range: '5d', interval: '15m' },
  '1M': { range: '1mo', interval: '60m' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1d' },
  '5Y': { range: '5y', interval: '1wk' },
} as const;
export type CandleRange = keyof typeof CANDLE_RANGES;

const candleCache = new Map<string, { at: number; data: unknown }>();

export async function getCandles(asset: ChinaAsset, rangeKey: CandleRange) {
  const key = `${asset.symbol}:${rangeKey}`;
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;

  const { range, interval } = CANDLE_RANGES[rangeKey];
  const json = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.yahoo)}?interval=${interval}&range=${range}`);
  const r = json?.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  const candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  (r?.timestamp ?? []).forEach((t: number, i: number) => {
    if (q.open[i] == null || q.close[i] == null) return;
    candles.push({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] ?? 0 });
  });
  const data = { symbol: asset.symbol, currency: asset.currency, interval, candles };
  candleCache.set(key, { at: Date.now(), data });
  return data;
}
