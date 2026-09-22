import { ASSETS, USD_HKD_FEED_ID, type ChinaAsset } from './assets.js';
import { getQuote as getRhQuote } from './robinhood.js';

// Serverless port of api/src/prices.ts. Pyth when PYTH_API_KEY is set, Yahoo Finance otherwise.
// Module-level cache survives between invocations on a warm function instance.

declare const process: { env: Record<string, string | undefined> };

export interface Quote {
  symbol: string;
  price: number;
  priceUsd: number;
  currency: 'HKD' | 'USD';
  change24h: number;
  source: 'robinhood' | 'pyth' | 'yahoo';
  publishTime: number;
  halted?: boolean;
  /** the session's range and turnover, in the asset's own currency; absent when Yahoo has none */
  high?: number;
  low?: number;
  volume?: number;
}

type Snapshot = { at: number; quotes: Record<string, Quote>; usdHkd: number };
let cache: Snapshot | null = null;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}`);
  return res.json();
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
    // the session's range and turnover, which the terminal shows beside the price
    high: meta.regularMarketDayHigh as number | undefined,
    low: meta.regularMarketDayLow as number | undefined,
    volume: meta.regularMarketVolume as number | undefined,
  };
}

async function pythPrices(feedIds: string[]) {
  const out: Record<string, { price: number; publishTime: number }> = {};
  const key = process.env.PYTH_API_KEY;
  if (!key) return out;
  const base = process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network';
  const qs = feedIds.map((id) => `ids[]=${id}`).join('&');
  const json = await getJson(`${base}/v2/updates/price/latest?${qs}&parsed=true&ignore_invalid_price_ids=true`, {
    Authorization: `Bearer ${key}`,
  });
  for (const p of json?.parsed ?? []) {
    out[p.id] = { price: Number(p.price.price) * 10 ** p.price.expo, publishTime: p.price.publish_time };
  }
  return out;
}

export async function getQuotes(): Promise<Snapshot> {
  if (cache && Date.now() - cache.at < 5_000) return cache;
  let pyth: Awaited<ReturnType<typeof pythPrices>> = {};
  try {
    pyth = await pythPrices([...ASSETS.map((a) => a.pythFeedId), USD_HKD_FEED_ID]);
  } catch (e) {
    console.warn('Pyth quote fetch failed, falling back to Yahoo', e);
  }
  // Robinhood's own API is the truest price for the equities they tokenized (BABA, FUTU today)
  const rhQuotes = await Promise.all(
    ASSETS.map((a) => (a.rhToken ? getRhQuote(a.rhToken).catch(() => null) : Promise.resolve(null))),
  );
  const yahoo = await Promise.all(
    [...ASSETS.map((a) => a.yahoo), 'HKDUSD=X'].map((t) => yahooQuote(t).catch(() => null)),
  );
  const fx = yahoo[yahoo.length - 1];
  const usdHkd = pyth[USD_HKD_FEED_ID]?.price || (fx?.price ? 1 / fx.price : 7.8);

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
      // Yahoo's high and low cover the exchange's regular session, but Robinhood's tokenized shares keep
      // trading after it closes. Widening the range to the live price keeps the header honest — without
      // this, a stock that moved after hours shows a price above its own "24h High".
      high: y?.high ? Math.max(y.high, price) : undefined,
      low: y?.low ? Math.min(y.low, price) : undefined,
      volume: y?.volume,
    };
  });
  cache = { at: Date.now(), quotes, usdHkd };
  return cache;
}

export const CANDLE_RANGES = {
  '1D': { range: '1d', interval: '5m' },
  '5D': { range: '5d', interval: '15m' },
  '1M': { range: '1mo', interval: '60m' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1d' },
  '5Y': { range: '5y', interval: '1wk' },
} as const;
export type CandleRange = keyof typeof CANDLE_RANGES;

export async function getCandles(asset: ChinaAsset, rangeKey: CandleRange) {
  const { range, interval } = CANDLE_RANGES[rangeKey];
  const json = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.yahoo)}?interval=${interval}&range=${range}`);
  const r = json?.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  const candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  (r?.timestamp ?? []).forEach((t: number, i: number) => {
    if (q.open[i] == null || q.close[i] == null) return;
    candles.push({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] ?? 0 });
  });
  return { symbol: asset.symbol, currency: asset.currency, interval, candles };
}
