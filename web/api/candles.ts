import { findAsset } from './_lib/assets.js';
import { CANDLE_RANGES, CANDLE_TIMEFRAMES, getCandles, pickCandleSpec } from './_lib/prices.js';

// GET /api/candles?symbol=BABA&tf=15m   (tf: 1m 5m 15m 1h 1d 1w)
// GET /api/candles?symbol=BABA&range=1M (older look-back form, still served)
export default async function handler(req: any, res: any) {
  const asset = findAsset(String(req.query.symbol || ''));
  if (!asset) return res.status(404).json({ success: false, error: 'Unknown symbol' });
  const spec = pickCandleSpec(req.query.tf ? String(req.query.tf) : undefined, req.query.range ? String(req.query.range) : undefined);
  if (!spec) {
    const valid = req.query.tf ? Object.keys(CANDLE_TIMEFRAMES) : Object.keys(CANDLE_RANGES);
    return res.status(400).json({ success: false, error: `${req.query.tf ? 'tf' : 'range'} must be one of ${valid.join(', ')}` });
  }
  try {
    const data = await getCandles(asset, spec);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ success: true, data });
  } catch (e) {
    console.error('candles', e);
    res.status(502).json({ success: false, error: 'Candle source unavailable' });
  }
}
