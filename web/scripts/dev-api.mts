// Local stand-in for Vercel: serves the serverless handlers in web/api on http://localhost:8787, so /api/prices, /candles and
// /options/* can be changed and tried without deploying. Run it with `npm run dev:api` (it reads web/.env for the deployment
// addresses and QUOTE_SIGNER_KEY), then start the dev server with VITE_API_PROXY=http://localhost:8787.
import http from 'node:http';

const load = async (file: string) => (await import(new URL(`../api/${file}`, import.meta.url).href)).default;
const routes: Record<string, (req: unknown, res: unknown) => Promise<void>> = {
  '/api/prices': await load('prices.ts'),
  '/api/candles': await load('candles.ts'),
  '/api/options/chain': await load('options/chain.ts'),
  '/api/options/quote': await load('options/quote.ts'),
  '/api/rpc': await load('rpc.ts'),
};

const PORT = Number(process.env.DEV_API_PORT || 8787);
http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const url = new URL(req.url!, 'http://localhost');
  const handler = routes[url.pathname];
  if (!handler) { res.statusCode = 404; res.end('{"success":false,"error":"Not found"}'); return; }
  let body = '';
  for await (const chunk of req) body += chunk;
  // the small subset of Vercel's req/res that the handlers use
  const shim = {
    setHeader: (k: string, v: string) => res.setHeader(k, v),
    status(code: number) { res.statusCode = code; return shim; },
    json(payload: unknown) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); },
    end: (text?: string) => res.end(text),
  };
  try {
    await handler({ method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : {} }, shim);
  } catch (e) {
    console.error(url.pathname, e);
    if (!res.headersSent) { res.statusCode = 500; res.end('{"success":false,"error":"Handler crashed"}'); }
  }
}).listen(PORT, () => console.log(`dev API on http://localhost:${PORT}  (forward the dev server to it with VITE_API_PROXY=http://localhost:${PORT})`));
