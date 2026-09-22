// End-to-end check of the deployed testnet protocol, the same steps a trader takes in the terminal:
// mint test USDC -> approve -> deposit -> get a signed quote from the pricing service -> buy an option -> sell it back.
//
//   npm run e2e:testnet -- [--api https://hanmarket.vercel.app/api] [--symbol BABA]
//
// Uses a throwaway wallet funded with a little gas by the keeper. Prints every transaction hash, so the run
// doubles as proof on the explorer. Perps are not exercised here: they only trade while their session is open.
import 'dotenv/config';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { parseEther } from 'viem';
import { NETWORKS, accountFromEnv, publicClientFor, walletClientFor } from '../src/chain';
import { optionsAbi, vaultAbi, erc20Abi } from '../src/protocol/abis';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const api = arg('api', 'https://hanmarket.vercel.app/api').replace(/\/$/, '');
const symbol = arg('symbol', 'BABA');
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

  await step('fund gas', () => funderWallet.sendTransaction({ to: trader.address, value: parseEther('0.00006') }));
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

  const bal = await client.readContract({ address: d!.vault, abi: vaultAbi, functionName: 'balances', args: [trader.address] });
  console.log(`vault balance ${Number(bal) / 1e6} USDC (5000 deposited, minus the round-trip spread and fees)`);
  console.log('E2E PASSED');
}

main().catch((e) => {
  console.error('E2E FAILED:', e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
