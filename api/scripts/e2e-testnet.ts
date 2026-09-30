// End-to-end check of the deployed testnet protocol, the same steps a trader takes in the terminal:
// mint test USDC -> approve -> deposit -> get a signed quote from the pricing service -> buy an option -> sell it back
// -> open a perpetual at max leverage -> close it -> withdraw what is left.
//
//   npm run e2e:testnet -- [--api https://hanmarket.vercel.app/api] [--symbol BABA] [--perp BABA-PERP]
//
// Uses a throwaway wallet funded with a little gas by the keeper. Prints every transaction hash, so the run
// doubles as proof on the explorer. The perp leg is skipped, not failed, while that market's session is closed.
import 'dotenv/config';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { parseEther } from 'viem';
import { NETWORKS, accountFromEnv, publicClientFor, walletClientFor } from '../src/chain';
import { erc20Abi, optionsAbi, oracleAbi, perpsAbi, registryAbi, riskAbi, vaultAbi } from '../src/protocol/abis';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const api = arg('api', 'https://hanmarket.vercel.app/api').replace(/\/$/, '');
const symbol = arg('symbol', 'BABA');
const perpSymbol = arg('perp', 'BABA-PERP');
const EXPLORER = 'https://explorer.testnet.chain.robinhood.com/tx/';

const d = NETWORKS.testnet.deployment;
if (!d) throw new Error('TESTNET_DEPLOYMENT is not set');
const client = publicClientFor('testnet');

async function getQuote(seriesId: number, side: 'buy' | 'sell', contracts: number) {
  const res = await fetch(`${api}/options/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'testnet', seriesId, side, contracts }),
  });
  const json = await res.json() as { success: boolean; data?: any; error?: string };
  if (!json.success) throw new Error(`quote ${side}: ${json.error}`);
  return json.data;
}

async function main() {
  const funder = accountFromEnv('KEEPER_PRIVATE_KEY');
  if (!funder) throw new Error('KEEPER_PRIVATE_KEY is not set (it pays a little gas to the test wallet)');
  const trader = privateKeyToAccount(generatePrivateKey());
  const funderWallet = walletClientFor('testnet', funder);
  const wallet = walletClientFor('testnet', trader);
  console.log(`test wallet ${trader.address}`);

  const step = async (label: string, send: () => Promise<`0x${string}`>) => {
    const hash = await send();
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error(`${label} reverted: ${EXPLORER}${hash}`);
    console.log(`ok  ${label.padEnd(22)} ${EXPLORER}${hash}`);
  };

  // the funder is also the live keeper's key, so its nonce can be taken by a keeper transaction in between: retry that
  for (let attempt = 1; ; attempt++) {
    try {
      await step('fund gas', () => funderWallet.sendTransaction({ to: trader.address, value: parseEther('0.0001') }));
      break;
    } catch (e) {
      if (attempt >= 4 || !/nonce/i.test(String((e as Error).message))) throw e;
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  await step('mint 10,000 USDC', () => wallet.writeContract({ address: d!.collateralToken, abi: erc20Abi, functionName: 'mint', args: [trader.address, 10_000_000_000n] }));
  await step('approve vault', () => wallet.writeContract({ address: d!.collateralToken, abi: erc20Abi, functionName: 'approve', args: [d!.vault, 5_000_000_000n] }));
  await step('deposit 5,000 USDC', () => wallet.writeContract({ address: d!.vault, abi: vaultAbi, functionName: 'deposit', args: [5_000_000_000n] }));

  // pick the at-the-money call of the first expiry from the live option chain
  const chain = await (await fetch(`${api}/options/chain?network=testnet&symbol=${symbol}`)).json() as { success: boolean; data: any; error?: string };
  if (!chain.success || !chain.data.deployed) throw new Error(`option chain: ${chain.error ?? 'not deployed'}`);
  const { spot, expiries } = chain.data as { spot: number; expiries: { rows: { strike: number; call?: { seriesId: number } }[] }[] };
  const row = expiries[0].rows.filter((r) => r.call).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
  const seriesId = row.call!.seriesId;
  console.log(`spot ${spot}, trading ${symbol} $${row.strike} call (series ${seriesId})`);

  for (const side of ['buy', 'sell'] as const) {
    const q = await getQuote(seriesId, side, 1);
    const quote = {
      seriesId: BigInt(q.quote.seriesId), isBuy: q.quote.isBuy, premium: BigInt(q.quote.premium),
      maxQty: BigInt(q.quote.maxQty), deadline: BigInt(q.quote.deadline),
    };
    await step(`${side} 1 contract @ $${q.premium}`, () => wallet.writeContract({
      address: d!.optionsEngine, abi: optionsAbi, functionName: side, args: [1_000_000n, quote.premium, quote, q.signature],
    }));
    const held = await client.readContract({ address: d!.optionsEngine, abi: optionsAbi, functionName: 'balanceOf', args: [trader.address, BigInt(seriesId)] });
    console.log(`    option balance after ${side}: ${Number(held) / 1e6}`);
  }

  const afterOptions = await client.readContract({ address: d!.vault, abi: vaultAbi, functionName: 'balances', args: [trader.address] });
  console.log(`vault balance ${Number(afterOptions) / 1e6} USDC after the option round trip`);

  // ---- perpetual: open at the market's max leverage, read the position back, close it
  const n = Number(await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'perpMarketCount' }));
  let marketId = -1;
  for (let m = 0; m < n; m++) {
    const mk = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getPerpMarket', args: [m] });
    if (mk.symbol === perpSymbol) marketId = m;
  }
  if (marketId < 0) throw new Error(`no perp market ${perpSymbol}`);
  const open = await client.readContract({ address: d!.riskManager, abi: riskAbi, functionName: 'tradingOpen', args: [marketId] });
  if (!open) {
    console.log(`skip ${perpSymbol}: its session is closed right now`);
  } else {
    const risk = await client.readContract({ address: d!.riskManager, abi: riskAbi, functionName: 'getPerpRisk', args: [marketId] });
    const mk = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getPerpMarket', args: [marketId] });
    const asset = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [mk.assetId] });
    const [price] = await client.readContract({ address: d!.oracleRouter, abi: oracleAbi, functionName: 'getPrice', args: [asset.oracleId] });
    const lev = BigInt(risk.maxLeverage);
    const size = 1_000_000_000n; // $1,000 notional
    // margin = size / leverage, plus the 0.08% fee, plus the terminal's tenth-of-a-cent buffer
    const collateral = size / lev + (size * 8n) / 10_000n + 1_000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    await step(`open ${perpSymbol} long ${lev}x`, () => wallet.writeContract({
      address: d!.perpsEngine, abi: perpsAbi, functionName: 'increasePosition',
      args: [marketId, true, collateral, size, (price * 1005n) / 1000n, deadline],
    }));
    const info = await client.readContract({ address: d!.perpsEngine, abi: perpsAbi, functionName: 'positionInfo', args: [trader.address, marketId, true] });
    console.log(`    entry ${Number(info.entryPrice) / 1e6}, margin ${Number(info.collateral) / 1e6}, liquidation ${Number(info.liquidationPrice) / 1e6} (${((1 - Number(info.liquidationPrice) / Number(info.entryPrice)) * 100).toFixed(2)}% below entry)`);
    const [now] = await client.readContract({ address: d!.oracleRouter, abi: oracleAbi, functionName: 'getPrice', args: [asset.oracleId] });
    await step(`close ${perpSymbol} long`, () => wallet.writeContract({
      address: d!.perpsEngine, abi: perpsAbi, functionName: 'closePosition',
      args: [marketId, true, (now * 995n) / 1000n, BigInt(Math.floor(Date.now() / 1000) + 300)],
    }));
    const after = await client.readContract({ address: d!.perpsEngine, abi: perpsAbi, functionName: 'positionInfo', args: [trader.address, marketId, true] });
    if (after.size !== 0n) throw new Error('position still open after closing');
  }

  // ---- withdraw everything back to the wallet
  const bal = await client.readContract({ address: d!.vault, abi: vaultAbi, functionName: 'balances', args: [trader.address] });
  await step(`withdraw ${Number(bal) / 1e6} USDC`, () => wallet.writeContract({ address: d!.vault, abi: vaultAbi, functionName: 'withdraw', args: [bal] }));
  const locked = await client.readContract({ address: d!.vault, abi: vaultAbi, functionName: 'lockedMargin', args: [trader.address] });
  const walletUsdc = await client.readContract({ address: d!.collateralToken, abi: erc20Abi, functionName: 'balanceOf', args: [trader.address] });
  console.log(`wallet ${Number(walletUsdc) / 1e6} USDC, vault 0, locked margin ${Number(locked) / 1e6} (10,000 minted; the gap is fees and spread)`);
  console.log('E2E PASSED');
}

main().catch((e) => {
  console.error('E2E FAILED:', e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
