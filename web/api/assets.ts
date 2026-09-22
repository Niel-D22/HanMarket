import { ASSETS } from './_lib/assets.js';

export default function handler(_req: any, res: any) {
  res.setHeader('Cache-Control', 's-maxage=3600');
  res.status(200).json({ success: true, data: ASSETS.map(({ yahoo, ...a }) => a) });
}
