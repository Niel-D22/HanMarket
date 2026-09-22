// Robinhood's official Stock Token REST API (docs.robinhood.com/chain/stock-token-apis).
//
// Two uses here:
//   - live bid/ask for the equities Robinhood has tokenized (of our catalogue: BABA and FUTU)
//   - `currentMultiplier`, which matters because the REST price is the raw underlying equity while the
//     onchain Chainlink feed is multiplier-adjusted. Showing one and settling on the other would drift
//     apart after a corporate action, so quotes are multiplied here to match what the contract will use.
//
// No API key; prices are cached ~15s upstream and the endpoints allow 60 requests/second.
// Note: some Indonesian ISPs block *.robinhood.com, so a local dev run may fall back to Yahoo.

const BASE = process.env.ROBINHOOD_API_URL || 'https://api.robinhood.com/rhj';
const ASSETS_TTL = 10 * 60_000;
const PRICE_TTL = 10_000;

export interface RhQuote {
  symbol: string;
  price: number; // token-equivalent USD (mid of bid/ask × multiplier)
  bid: number;
  ask: number;
  multiplier: number;
  halted: boolean;
  generatedAt: number; // unix seconds
}

interface AssetInfo {
  multiplier: number;
  tokenAddress?: string;
  active: boolean;
}

let assetCache: { at: number; assets: Map<string, AssetInfo> } | null = null;
const priceCache = new Map<string, { at: number; quote: RhQuote | null }>();

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export async function getAssets(): Promise<Map<string, AssetInfo>> {
  if (assetCache && Date.now() - assetCache.at < ASSETS_TTL) return assetCache.assets;
  const json = await getJson(`${BASE}/assets`);
  const assets = new Map<string, AssetInfo>();
  for (const a of json?.assets ?? []) {
    const deployment = (a.deployments ?? []).find((d: any) => d.chainId === 4663);
    assets.set(a.tokenSymbol, {
      multiplier: Number(a.currentMultiplier) || 1,
      tokenAddress: deployment?.contractAddress,
      active: a.status === 'ASSET_STATUS_ACTIVE',
    });
  }
  assetCache = { at: Date.now(), assets };
  return assets;
}

/** Live quote for a Robinhood-tokenized ticker, or null when it is not tokenized / unreachable. */
export async function getQuote(symbol: string): Promise<RhQuote | null> {
  const hit = priceCache.get(symbol);
  if (hit && Date.now() - hit.at < PRICE_TTL) return hit.quote;

  let quote: RhQuote | null = null;
  try {
    const [assets, json] = await Promise.all([getAssets().catch(() => new Map<string, AssetInfo>()), getJson(`${BASE}/prices/${symbol}`)]);
    const q = json?.quotes?.[0];
    const bid = Number(q?.bid);
    const ask = Number(q?.ask);
    if (q && bid > 0 && ask > 0) {
      const multiplier = assets.get(symbol)?.multiplier ?? 1;
      quote = {
        symbol,
        price: ((bid + ask) / 2) * multiplier,
        bid,
        ask,
        multiplier,
        halted: !!q.isTradingHalt,
        generatedAt: q.generatedAt ? Math.floor(new Date(q.generatedAt).getTime() / 1000) : Math.floor(Date.now() / 1000),
      };
    }
  } catch {
    quote = null; // blocked, rate-limited or not tokenized: callers fall back to their other source
  }
  priceCache.set(symbol, { at: Date.now(), quote });
  return quote;
}
