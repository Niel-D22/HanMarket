import { deploymentFor, loadProtocol, parseNetwork } from '../_lib/protocol/client.js';
import { isTradable, priceSeries, underlying, type PricedSeries } from '../_lib/optionQuotes.js';

// GET /api/options/chain?network=testnet&symbol=BABA
// The tradable option chain of one underlying, grouped by expiry and strike: calls left, puts right,
// with bid / ask / mark / IV / greeks from the pricing model. Prices here are indicative; a trade needs a
// signed quote from /api/options/quote.

export default async function handler(req: any, res: any) {
  const network = parseNetwork(req.query.network);
  const symbol = String(req.query.symbol || '').toUpperCase();
  if (!network || !symbol) return res.status(400).json({ success: false, error: 'network and symbol are required' });
  const d = deploymentFor(network);
  if (!d) return res.status(200).json({ success: true, data: { deployed: false, expiries: [] } });

  try {
    const [{ series }, u] = await Promise.all([loadProtocol(network, d), underlying(symbol)]);
    if (!u) return res.status(404).json({ success: false, error: 'Unknown symbol or no price' });

    const now = Date.now() / 1000;
    const byExpiry = new Map<number, Map<number, { strike: number; call?: PricedSeries; put?: PricedSeries }>>();
    for (const s of series) {
      if (s.symbol !== u.symbol || !isTradable(s, now)) continue;
      const rows = byExpiry.get(s.expiry) ?? new Map();
      const row = rows.get(s.strike) ?? { strike: s.strike };
      row[s.isCall ? 'call' : 'put'] = priceSeries(s, u, now);
      rows.set(s.strike, row);
      byExpiry.set(s.expiry, rows);
    }

    const expiries = [...byExpiry.entries()]
      .sort(([a], [b]) => a - b)
      .map(([expiry, rows]) => ({ expiry, rows: [...rows.values()].sort((a, b) => a.strike - b.strike) }));

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.status(200).json({
      success: true,
      data: { deployed: true, symbol: u.symbol, spot: u.spot, iv: u.vol, sessionOpen: u.sessionOpen, expiries },
    });
  } catch (e) {
    console.error('options/chain', e);
    res.status(502).json({ success: false, error: 'Could not load the option chain' });
  }
}
