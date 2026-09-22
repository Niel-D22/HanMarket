import { getQuotes } from './_lib/prices.js';

export default async function handler(req: any, res: any) {
  const wanted = String(req.query.symbols || '')
    .split(',')
    .map((s: string) => s.trim().toUpperCase())
    .filter(Boolean);
  try {
    const { quotes, usdHkd, at } = await getQuotes();
    const data = wanted.length
      ? Object.fromEntries(Object.entries(quotes).filter(([s]) => wanted.includes(s.toUpperCase())))
      : quotes;
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=30');
    res.status(200).json({ success: true, data, usdHkd, updatedAt: at });
  } catch (e) {
    console.error('prices', e);
    res.status(500).json({ success: false, error: 'Failed to fetch prices' });
  }
}
