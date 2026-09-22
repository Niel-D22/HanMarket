import { privateKeyToAccount } from 'viem/accounts';
import { QUOTE_TYPES } from '../_lib/protocol/abis.js';
import { chainFor, deploymentFor, loadProtocol, parseNetwork } from '../_lib/protocol/client.js';
import { isTradable, priceSeries, underlying } from '../_lib/optionQuotes.js';

// POST /api/options/quote   { network, seriesId, side: "buy" | "sell", contracts }
// Returns an EIP-712 quote signed by QUOTE_SIGNER_KEY, valid for 60 seconds and for at most `contracts`,
// plus the numbers the order ticket shows before the wallet signs (premium, cost, break-even, max loss).

declare const process: { env: Record<string, string | undefined> };

const QUOTE_TTL = 60;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {};
  const network = parseNetwork(body.network);
  const seriesId = Number(body.seriesId);
  const contracts = Number(body.contracts);
  const isBuy = body.side === 'buy';
  if (!network || !Number.isInteger(seriesId) || seriesId < 0 || !(contracts > 0) || (body.side !== 'buy' && body.side !== 'sell')) {
    return res.status(400).json({ success: false, error: 'network, seriesId, side and contracts are required' });
  }
  const d = deploymentFor(network);
  const key = process.env.QUOTE_SIGNER_KEY?.trim();
  if (!d || !key) return res.status(503).json({ success: false, error: 'Quoting is not configured on this network' });

  try {
    const { series } = await loadProtocol(network, d);
    const s = series[seriesId];
    if (!s || !isTradable(s)) return res.status(400).json({ success: false, error: 'This option is not trading' });
    const u = await underlying(s.symbol);
    if (!u) return res.status(502).json({ success: false, error: 'No price for the underlying' });

    const p = priceSeries(s, u);
    const premium = isBuy ? p.ask : p.bid;
    if (!(premium > 0)) return res.status(400).json({ success: false, error: 'No bid for this option right now' });

    const qty = BigInt(Math.round(contracts * 1e6));
    const quote = {
      seriesId: BigInt(seriesId),
      isBuy,
      premium: BigInt(Math.round(premium * 1e6)),
      maxQty: qty,
      deadline: BigInt(Math.floor(Date.now() / 1000) + QUOTE_TTL),
    };
    const signer = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`);
    const signature = await signer.signTypedData({
      domain: { name: 'HanMarket Options', version: '1', chainId: chainFor(network).id, verifyingContract: d.optionsEngine },
      types: QUOTE_TYPES,
      primaryType: 'Quote',
      message: quote,
    });

    const total = premium * contracts;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      success: true,
      data: {
        quote: {
          seriesId: quote.seriesId.toString(),
          isBuy,
          premium: quote.premium.toString(),
          maxQty: quote.maxQty.toString(),
          deadline: quote.deadline.toString(),
        },
        signature,
        premium,
        mark: p.price,
        total,
        iv: p.iv,
        greeks: { delta: p.delta, gamma: p.gamma, theta: p.theta, vega: p.vega },
        breakEven: s.isCall ? s.strike + premium : s.strike - premium,
        maxLoss: isBuy ? total : undefined,
        maxProfit: isBuy ? (s.cap - premium) * contracts : undefined,
        spot: u.spot,
        sessionOpen: u.sessionOpen,
      },
    });
  } catch (e) {
    console.error('options/quote', e);
    res.status(502).json({ success: false, error: 'Could not price this option' });
  }
}
