// POST /api/rpc?network=testnet|mainnet
// Read-only JSON-RPC proxy for the browser. The private RPC URL (an Alchemy key) lives in TESTNET_RPC_URL / MAINNET_RPC_URL,
// server-side only, so it never reaches the bundle. The terminal tries this first and the public RPCs after it: every
// refusal here is an HTTP error status, which viem's fallback transport treats as "try the next endpoint".
// Transactions never pass through: the wallet signs and sends them over its own RPC.

declare const process: { env: Record<string, string | undefined> };

const UPSTREAM: Record<string, string | undefined> = {
  testnet: process.env.TESTNET_RPC_URL,
  mainnet: process.env.MAINNET_RPC_URL,
};
const CHAIN_ID: Record<string, number> = { testnet: 46630, mainnet: 4663 };

// What the terminal reads through the main client. eth_getLogs is left out on purpose: History and Options Flow scan
// events over wide block ranges on the public RPCs (Alchemy's free plan caps a getLogs call at 10 blocks).
const ALLOWED = new Set([
  'eth_chainId', 'net_version', 'eth_blockNumber', 'eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionByHash', 'eth_getTransactionReceipt',
  'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory',
]);
const MAX_BATCH = 100; // the browser sends at most 25 per request (WalletContextProvider)
const MAX_BODY = 1024 * 1024; // a multicall's calldata is up to 64 KB, twice that as hex

// Per-IP budget. Serverless instances do not share memory, so this caps each instance, not the site as a whole: it stops
// one visitor's loop from draining the key, it is not a hard global quota (that is the provider dashboard's job).
const WINDOW_MS = 60_000;
const PER_WINDOW = 600; // JSON-RPC calls per IP per minute; the terminal makes well under 100 once multicall folds its reads
const hits = new Map<string, { start: number; n: number }>();
function overBudget(ip: string, calls: number) {
  const now = Date.now();
  if (hits.size > 5_000) for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
  const h = hits.get(ip);
  if (!h || now - h.start > WINDOW_MS) { hits.set(ip, { start: now, n: calls }); return false; }
  h.n += calls;
  return h.n > PER_WINDOW;
}

// The browser only ever calls this from our own pages; other sites get no CORS headers, so their pages cannot use it.
const OWN_ORIGIN = /^https:\/\/hanmarket(-[a-z0-9-]+)?\.vercel\.app$|^http:\/\/localhost(:\d+)?$/;

export default async function handler(req: any, res: any) {
  const origin = String(req.headers?.origin || '');
  if (OWN_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const network = String(req.query.network || '');
  const upstream = UPSTREAM[network];
  if (!CHAIN_ID[network]) return res.status(400).json({ error: 'network must be testnet or mainnet' });
  // not configured: 503 sends the browser straight on to the public RPCs
  if (!upstream) return res.status(503).json({ error: 'No private RPC configured' });

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
  if (!body || JSON.stringify(body).length > MAX_BODY) return res.status(413).json({ error: 'Body too large or not JSON' });
  const calls: any[] = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) return res.status(413).json({ error: `1 to ${MAX_BATCH} calls per request` });
  const refused = calls.find((c) => !c || typeof c.method !== 'string' || !ALLOWED.has(c.method));
  if (refused) return res.status(403).json({ error: `Method not served here: ${refused?.method}` });

  // eth_chainId is answered locally: it is asked constantly and never changes
  if (calls.every((c) => c.method === 'eth_chainId')) {
    const out = calls.map((c) => ({ jsonrpc: '2.0', id: c.id, result: `0x${CHAIN_ID[network].toString(16)}` }));
    return res.status(200).json(Array.isArray(body) ? out : out[0]);
  }

  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (overBudget(ip, calls.length)) return res.status(429).json({ error: 'Too many requests' });

  try {
    const r = await fetch(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9_000),
    });
    const text = await r.text();
    // upstream errors (429, 5xx) keep their status so the browser falls back to a public RPC
    res.status(r.ok ? 200 : r.status).setHeader('content-type', 'application/json');
    return res.end ? res.end(text) : res.json(safeJson(text));
  } catch (e) {
    console.error('rpc proxy', network, (e as Error).message);
    return res.status(502).json({ error: 'Upstream RPC unavailable' });
  }
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}
