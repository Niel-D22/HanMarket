// Opens the weekly option chains on demand. The keeper does this on its own every week (src/index.ts);
// this is the manual route, for the first run after a deploy or to top up one symbol.
//
//   npm run markets:create -- --network testnet [--weeks 2] [--symbols BABA,0700.HK]
//                             [--prices-url URL] [--gas-floor 0.0001] [--dry-run]
import 'dotenv/config';
import { parseEther } from 'viem';
import { createMarkets } from '../src/markets';
import type { NetworkKey } from '../src/chain';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// Strikes sit around spot, so they must come from the same prices the pricing service uses. Where
// robinhood.com is blocked, borrow them from a deployed HanMarket API (see PRICES_URL in src/prices.ts):
//   --prices-url https://hanmarket.vercel.app/api
const pricesUrl = arg('prices-url');
if (pricesUrl) process.env.PRICES_URL = pricesUrl;

// Leave the keeper this much ETH for gas, so a big chain run cannot starve price updates and settlement.
const gasFloor = arg('gas-floor');

createMarkets({
  network: (arg('network') ?? 'testnet') as NetworkKey,
  weeks: Math.max(1, Math.min(8, Number(arg('weeks') ?? 2))),
  only: arg('symbols')?.split(',').map((s) => s.trim().toUpperCase()),
  dryRun: process.argv.includes('--dry-run'),
  gasFloorWei: gasFloor ? parseEther(gasFloor) : 0n,
  log: (line) => console.log(line),
})
  .then((r) => {
    for (const s of r.skipped) console.log(`skip ${s}`);
    console.log(`done: ${r.created} created, ${r.existed} already open${r.stoppedForGas ? ' (stopped at the gas floor)' : ''}`);
  })
  .catch((e) => {
    console.error(e.shortMessage ?? e.message ?? e);
    process.exit(1);
  });
