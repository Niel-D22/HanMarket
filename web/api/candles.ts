import { findAsset } from './_lib/assets.js';
import { CANDLE_RANGES, getCandles, type CandleRange } from './_lib/prices.js';

export default async function handler(req: any, res: any) {
  const asset = findAsset(String(req.query.symbol || ''));
  const range = String(req.query.range || '1M').toUpperCase() as CandleRange;
  if (!asset) return res.status(404).json({ success: false, error: 'Unknown symbol' });
  if (!(range in CANDLE_RANGES)) {
    return res.status(400).json({ success: false, error: `range must be one of ${Object.keys(CANDLE_RANGES).join(', ')}` });
  }
  try {
    const data = await getCandles(asset, range);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ success: true, data });
  } catch (e) {
    console.error('candles', e);
    res.status(502).json({ success: false, error: 'Candle source unavailable' });
  }
}
