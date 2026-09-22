// First, before anything else: ./chain reads TESTNET_DEPLOYMENT at module load, and imports are evaluated
// in order. Loading dotenv further down (or calling dotenv.config() after the imports) leaves every
// deployment null, and the keeper then starts and quietly does nothing.
import 'dotenv/config';

import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cron from 'node-cron';
import { parseEther } from 'viem';
import { logger } from './logger';
import { ASSETS, findAsset } from './assets';
import { CANDLE_RANGES, getCandles, getQuotes, type CandleRange } from './prices';
import { runLiquidations, runSessions, runSettlement, runTestnetFeeds } from './keeper';
import { createMarkets } from './markets';
import { NETWORKS } from './chain';

// HanMarket API: prices and chart data, plus the protocol's bots (settlement, perp sessions, liquidations).
// Markets and positions are read by the web app straight from the contracts; option quotes come from web/api.

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(morgan('tiny', { stream: { write: (message) => logger.info(message.trim()) } }));

app.get('/', (_req: Request, res: Response) => {
  res.send('HanMarket API is running');
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    networks: Object.fromEntries(Object.values(NETWORKS).map((n) => [n.key, { chainId: n.chain.id, deployment: n.deployment }])),
    keeper: !!process.env.KEEPER_PRIVATE_KEY,
  });
});

// GET /api/assets — the tradable catalogue
app.get('/api/assets', (_req: Request, res: Response) => {
  res.json({ success: true, data: ASSETS.map(({ yahoo, ...a }) => a) });
});

// GET /api/prices?symbols=0700.HK,BABA — latest quotes, cached for 5s
app.get('/api/prices', async (req: Request, res: Response) => {
  const wanted = String(req.query.symbols || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  try {
    const { quotes, usdHkd, at } = await getQuotes();
    const data = wanted.length
      ? Object.fromEntries(Object.entries(quotes).filter(([sym]) => wanted.includes(sym.toUpperCase())))
      : quotes;
    res.json({ success: true, data, usdHkd, updatedAt: at });
  } catch (error) {
    logger.error('Error fetching prices:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch prices' });
  }
});

// GET /api/candles?symbol=0700.HK&range=1M
app.get('/api/candles', async (req: Request, res: Response) => {
  const asset = findAsset(String(req.query.symbol || ''));
  const range = String(req.query.range || '1M').toUpperCase() as CandleRange;
  if (!asset) return res.status(404).json({ success: false, error: 'Unknown symbol' });
  if (!(range in CANDLE_RANGES)) return res.status(400).json({ success: false, error: `range must be one of ${Object.keys(CANDLE_RANGES).join(', ')}` });
  try {
    res.json({ success: true, data: await getCandles(asset, range) });
  } catch (error) {
    logger.error('Error fetching candles:', error);
    res.status(502).json({ success: false, error: 'Candle source unavailable' });
  }
});

app.listen(PORT, () => {
  logger.info(`HanMarket API listening on port ${PORT}`);

  if (process.env.KEEPER_PRIVATE_KEY) {
    const settleCron = process.env.KEEPER_CRON || '*/5 * * * *';
    const fail = (job: string) => (e: unknown) => logger.error(`${job} failed: ${(e as Error).message}`);
    cron.schedule(settleCron, () => { runSettlement().catch(fail('settlement')); });
    cron.schedule('* * * * *', () => {
      runTestnetFeeds().catch(fail('testnet feeds'));
      runSessions().catch(fail('sessions'));
      runLiquidations().catch(fail('liquidations'));
    });
    // New expiries, once a week. Chains are opened two Fridays ahead, so a missed run still leaves a
    // week of cover. The gas floor keeps a long run from starving the jobs above, which matter more.
    const marketsCron = process.env.MARKETS_CRON || '0 2 * * 1';
    const gasFloor = parseEther(process.env.MARKETS_GAS_FLOOR_ETH || '0.0001');
    cron.schedule(marketsCron, () => {
      for (const network of ['testnet', 'mainnet'] as const) {
        if (!NETWORKS[network].deployment) continue;
        createMarkets({ network, weeks: 2, gasFloorWei: gasFloor })
          .then((r) => logger.info(`[markets:${network}] ${r.created} created, ${r.existed} already open${r.stoppedForGas ? ' (stopped at the gas floor)' : ''}`))
          .catch(fail(`markets:${network}`));
      }
    });
    logger.info(`Keeper on: settlement (${settleCron}), perp sessions and liquidations (every minute), option chains (${marketsCron})`);
  } else {
    logger.info('Keeper disabled (KEEPER_PRIVATE_KEY not set)');
  }
});
