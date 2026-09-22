// Shows the price the keeper would sign for an asset at a given time.
//   npx ts-node scripts/check-settlement-price.ts 0700.HK 2026-09-17T08:00:00Z
import 'dotenv/config';
import { observePrice } from '../src/settlementPrice';

async function main() {
  const [symbol = '0700.HK', iso] = process.argv.slice(2);
  const at = iso ? Math.floor(new Date(iso).getTime() / 1000) : Math.floor(Date.now() / 1000);
  const observed = await observePrice(symbol, at, 1800);
  if (!observed) {
    console.log(`${symbol}: no price within 30 minutes of ${new Date(at * 1000).toISOString()}`);
    return;
  }
  console.log(`${symbol} at ${new Date(at * 1000).toISOString()}: $${Number(observed.price6) / 1e6} (observed ${new Date(observed.publishTime * 1000).toISOString()}, ${observed.source})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
