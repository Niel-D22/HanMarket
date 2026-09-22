import { ASSETS, USD_HKD_FEED_ID } from './assets';

// Price of a Signed asset at a market's expiry, in USD with 6 decimals.
// Pyth (when PYTH_API_KEY is set) gives the first update at or after the timestamp; otherwise Yahoo Finance
// 1-minute candles give the last close at or before it. HK prices are converted with USD/HKD at the same time.

export interface ObservedPrice {
  price6: bigint; // USD, 6 decimals
  publishTime: number; // unix seconds of the observation
  source: 'pyth' | 'yahoo';
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}`);
  return res.json();
}

async function pythAt(feedId: string, ts: number): Promise<{ price: number; publishTime: number } | null> {
  const key = process.env.PYTH_API_KEY;
  if (!key) return null;
  const base = process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network';
  const json = await getJson(`${base}/v2/updates/price/${ts}?ids[]=${feedId}&parsed=true`, { Authorization: `Bearer ${key}` });
  const p = json?.parsed?.[0]?.price;
  if (!p) return null;
  return { price: Number(p.price) * 10 ** p.expo, publishTime: Number(p.publish_time) };
}

async function yahooAt(ticker: string, ts: number, windowSecs: number): Promise<{ price: number; publishTime: number } | null> {
  const json = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&period1=${ts - windowSecs}&period2=${ts + 60}`,
  );
  const r = json?.chart?.result?.[0];
  const times: number[] = r?.timestamp ?? [];
  const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
  for (let i = times.length - 1; i >= 0; i--) {
    if (times[i] <= ts && closes[i] != null) return { price: closes[i] as number, publishTime: Math.min(times[i] + 60, ts) };
  }
  return null;
}

export async function observePrice(symbol: string, expiry: number, windowSecs: number): Promise<ObservedPrice | null> {
  const asset = ASSETS.find((a) => a.symbol === symbol);
  if (!asset) return null;

  let observed = await pythAt(asset.pythFeedId, expiry).catch(() => null);
  let source: ObservedPrice['source'] = 'pyth';
  if (observed && Math.abs(observed.publishTime - expiry) > windowSecs) observed = null;
  if (!observed) {
    observed = await yahooAt(asset.yahoo, expiry, windowSecs).catch(() => null);
    source = 'yahoo';
  }
  if (!observed) return null;

  let usd = observed.price;
  if (asset.currency === 'HKD') {
    const fx = source === 'pyth'
      ? await pythAt(USD_HKD_FEED_ID, expiry).catch(() => null)
      : await yahooAt('HKDUSD=X', expiry, 6 * 3600).then((r) => (r ? { ...r, price: 1 / r.price } : null)).catch(() => null);
    const usdHkd = fx?.price ?? 7.8; // HKD is pegged to 7.75–7.85 per USD
    usd = observed.price / usdHkd;
  }
  return { price6: BigInt(Math.round(usd * 1e6)), publishTime: observed.publishTime, source };
}
