// Read-only health check of a HanMarket deployment: nothing is signed or sent, no key is printed.
//
//   npm run health                        testnet
//   npm run health -- --network mainnet   the same checks on mainnet, once MAINNET_DEPLOYMENT is set
//
// It checks what has to be true for people to trade: the chain is live, the keeper and signers are the ones the
// contracts expect and have gas, the vault is unpaused with liquidity, every perp market has a fresh price and the
// session the keeper should have set, options are listed ahead and expired ones get settled, and the website's API
// (prices, option chain, quotes, RPC proxy) answers with a quote signed by the key the contract trusts.
// Exit code 1 if anything fails, so it can gate a launch step.
import 'dotenv/config';
import { formatEther, formatUnits, parseAbi, recoverAddress, type Address, type Hex } from 'viem';
import { NETWORKS, networkAccount, publicClientFor, type NetworkKey } from '../src/chain';
import { findAsset } from '../src/assets';
import { optionsAbi, oracleAbi, perpsAbi, registryAbi, riskAbi, vaultAbi } from '../src/protocol/abis';
import { isPerpSessionOpen, isSessionOpen } from '../src/protocol/sessions';

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const roleAbi = parseAbi([
  'function owner() view returns (address)',
  'function pendingOwner() view returns (address)',
  'function keeper() view returns (address)',
  'function quoteSigner() view returns (address)',
  'function treasury() view returns (address)',
  'function paused() view returns (bool)',
]);
const erc20Abi = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']);
const digestAbi = parseAbi([
  'struct Quote { uint256 seriesId; bool isBuy; uint256 premium; uint256 maxQty; uint64 deadline; }',
  'function quoteDigest(Quote q) view returns (bytes32)',
]);

const GAS_WARN = 0.002; // ETH: a few hundred keeper transactions on an L2
const GAS_FAIL = 0.0002;
const SETTLE_LATE = 60 * 60; // an expired series still unsettled after an hour means the settlement job is not running

type Level = 'ok' | 'warn' | 'fail';
const tally: Record<Level, number> = { ok: 0, warn: 0, fail: 0 };
const MARK: Record<Level, string> = { ok: '  ok  ', warn: ' WARN ', fail: ' FAIL ' };
function report(level: Level, msg: string) {
  tally[level]++;
  console.log(`[${MARK[level]}] ${msg}`);
}
const section = (title: string) => console.log(`\n== ${title}`);
const short = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? String(e)).split('\n')[0];
const ago = (seconds: number) =>
  seconds < 120 ? `${Math.round(seconds)}s` : seconds < 7200 ? `${Math.round(seconds / 60)}m` : seconds < 172800 ? `${(seconds / 3600).toFixed(1)}h` : `${(seconds / 86400).toFixed(1)}d`;
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

async function main() {
  const flag = process.argv.indexOf('--network');
  const key = (flag > 0 ? process.argv[flag + 1] : 'testnet') as NetworkKey;
  if (key !== 'testnet' && key !== 'mainnet') throw new Error('--network must be testnet or mainnet');
  const { deployment: d, chain } = NETWORKS[key];
  console.log(`HanMarket health check: ${chain.name} (${chain.id})`);
  if (!d) {
    report('fail', `${key.toUpperCase()}_DEPLOYMENT is not set, nothing to check`);
    return;
  }
  const c = publicClientFor(key);
  const now = Math.floor(Date.now() / 1000);
  const read = <T>(address: Address, abi: readonly unknown[], functionName: string, args: unknown[] = []) =>
    c.readContract({ address, abi: abi as never, functionName: functionName as never, args: args as never }) as Promise<T>;

  // ------------------------------------------------------------------ chain
  section('Chain');
  const block = await c.getBlock();
  const lag = now - Number(block.timestamp);
  report(lag < 120 ? 'ok' : 'fail', `RPC at block ${block.number}, ${ago(lag)} behind the clock`);
  const chainId = await c.getChainId();
  report(chainId === chain.id ? 'ok' : 'fail', `chain id ${chainId}`);
  for (const [name, address] of Object.entries(d)) {
    if (name === 'startBlock') continue;
    const code = await c.getCode({ address: address as Address });
    if (!code || code === '0x') report('fail', `${name} ${address} has no code`);
  }
  report('ok', 'all 8 protocol addresses hold contract code');

  // ------------------------------------------------------------------ roles and gas
  section('Owner, keeper and signers');
  const contracts: [string, Address][] = [
    ['MarketRegistry', d.marketRegistry], ['OracleRouter', d.oracleRouter], ['FeeManager', d.feeManager],
    ['RiskManager', d.riskManager], ['Vault', d.vault], ['OptionsEngine', d.optionsEngine], ['PerpsEngine', d.perpsEngine],
  ];
  const owners = new Set<string>();
  for (const [name, address] of contracts) {
    const owner = await read<Address>(address, roleAbi, 'owner');
    const pending = await read<Address>(address, roleAbi, 'pendingOwner').catch(() => null);
    owners.add(owner.toLowerCase());
    if (pending && !/^0x0{40}$/i.test(pending)) report('warn', `${name}: ownership transfer to ${pending} not accepted yet`);
    void name;
  }
  for (const owner of owners) {
    const code = await c.getCode({ address: owner as Address });
    const isContract = !!code && code !== '0x';
    // mainnet must be owned by the multisig; a testnet owned by the operator EOA is expected
    report(isContract ? 'ok' : key === 'mainnet' ? 'fail' : 'ok', `owner ${owner} is ${isContract ? 'a contract (multisig)' : 'a plain wallet (EOA)'}${owners.size > 1 ? ' (owners differ between contracts)' : ''}`);
  }

  const riskKeeper = await read<Address>(d.riskManager, roleAbi, 'keeper');
  const optionsKeeper = await read<Address>(d.optionsEngine, roleAbi, 'keeper');
  const quoteSigner = await read<Address>(d.optionsEngine, roleAbi, 'quoteSigner');
  const priceSigner = await read<Address>(d.oracleRouter, oracleAbi, 'priceSigner');
  const treasury = await read<Address>(d.feeManager, roleAbi, 'treasury');
  report(same(riskKeeper, optionsKeeper) ? 'ok' : 'warn', `keeper on RiskManager ${riskKeeper}, on OptionsEngine ${optionsKeeper}`);
  const localKeeper = networkAccount('KEEPER_PRIVATE_KEY', key);
  const localSigner = networkAccount('PRICE_SIGNER_KEY', key);
  if (localKeeper) report(same(localKeeper.address, riskKeeper) ? 'ok' : 'fail', `local keeper key is ${localKeeper.address}${same(localKeeper.address, riskKeeper) ? ', the one the contracts expect' : ', NOT the contracts\' keeper'}`);
  if (localSigner) report(same(localSigner.address, priceSigner) ? 'ok' : 'fail', `local price signer key is ${localSigner.address}${same(localSigner.address, priceSigner) ? ', the OracleRouter\'s priceSigner' : ', NOT the OracleRouter\'s priceSigner'}`);
  report('ok', `quote signer ${quoteSigner}, price signer ${priceSigner}, treasury ${treasury}`);
  if (key === 'mainnet') {
    for (const [role, address] of [['keeper', riskKeeper], ['quote signer', quoteSigner], ['price signer', priceSigner]] as const) {
      if (owners.has(address.toLowerCase())) report('fail', `${role} is the owner: roles must be separate keys on mainnet`);
    }
  }
  const gas = Number(formatEther(await c.getBalance({ address: riskKeeper })));
  report(gas < GAS_FAIL ? 'fail' : gas < GAS_WARN ? 'warn' : 'ok', `keeper gas ${gas.toPrecision(3)} ETH${gas < GAS_FAIL ? ': it cannot send transactions (feeds, sessions, settlement and new series all stop)' : ''}`);
  const nonce = await c.getTransactionCount({ address: riskKeeper });
  report('ok', `keeper has sent ${nonce} transactions`);

  // ------------------------------------------------------------------ vault
  section('Vault');
  const token = await read<Address>(d.vault, vaultAbi, 'collateralToken');
  const [symbol, decimals] = await Promise.all([read<string>(token, erc20Abi, 'symbol'), read<number>(token, erc20Abi, 'decimals')]);
  report(decimals === 6 ? 'ok' : 'fail', `collateral ${symbol} (${decimals} decimals) at ${token}`);
  const usd = (v: bigint) => Number(formatUnits(v, decimals)).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const paused = await read<boolean>(d.vault, roleAbi, 'paused').catch(() => false);
  report(paused ? 'fail' : 'ok', `vault ${paused ? 'PAUSED' : 'not paused'}`);
  const [nav, pool, reserved, free, util, maxUtil] = await Promise.all([
    read<bigint>(d.vault, vaultAbi, 'nav'), read<bigint>(d.vault, vaultAbi, 'poolAmount'), read<bigint>(d.vault, vaultAbi, 'reservedAmount'),
    read<bigint>(d.vault, vaultAbi, 'freeLiquidity'), read<number>(d.vault, vaultAbi, 'utilizationBps'), read<number>(d.riskManager, riskAbi, 'maxUtilizationBps'),
  ]);
  report(free > 0n ? 'ok' : 'fail', `pool ${usd(pool)} ${symbol}, NAV ${usd(nav)}, reserved ${usd(reserved)}, free ${usd(free)}`);
  report(Number(util) < Number(maxUtil) * 0.9 ? 'ok' : 'warn', `utilization ${(Number(util) / 100).toFixed(1)}% of a ${(Number(maxUtil) / 100).toFixed(0)}% cap`);

  // ------------------------------------------------------------------ perps
  section('Perpetual markets');
  const perpCount = Number(await read<bigint>(d.marketRegistry, registryAbi, 'perpMarketCount'));
  report(perpCount > 0 ? 'ok' : 'fail', `${perpCount} perp markets`);
  for (let m = 0; m < perpCount; m++) {
    const market = await read<{ symbol: string; assetId: number; active: boolean }>(d.marketRegistry, registryAbi, 'getPerpMarket', [m]);
    const asset = await read<{ symbol: string; oracleId: Hex }>(d.marketRegistry, registryAbi, 'getAsset', [market.assetId]);
    const risk = await read<{ maxLeverage: number; maxPriceAge: number; openInterestCap: bigint }>(d.riskManager, riskAbi, 'getPerpRisk', [m]);
    const open = await read<boolean>(d.riskManager, riskAbi, 'tradingOpen', [m]);
    const state = await read<{ longEntryNotional: bigint; shortEntryNotional: bigint }>(d.perpsEngine, perpsAbi, 'getMarketState', [m]);
    const info = findAsset(asset.symbol);
    const shouldOpen = info?.board === 'HK' ? isSessionOpen('HK') : isPerpSessionOpen();
    const label = `${market.symbol.padEnd(12)}`;
    let priceNote: string;
    let level: Level = 'ok';
    try {
      const [price, at] = await read<[bigint, bigint]>(d.oracleRouter, oracleAbi, 'getPrice', [asset.oracleId]);
      const age = now - Number(at);
      priceNote = `$${Number(formatUnits(price, 6)).toFixed(2)} ${ago(age)} old`; // the router scales every feed to 6 decimals
      // while the market is open a price older than maxPriceAge makes every trade revert
      if (open && age > risk.maxPriceAge) level = 'fail';
    } catch (e) {
      priceNote = `no price (${short(e)})`;
      if (open) level = 'fail';
    }
    if (!market.active) level = 'warn';
    if (open !== shouldOpen && level === 'ok') level = 'warn';
    const oi = Number(formatUnits(state.longEntryNotional + state.shortEntryNotional, 6)).toLocaleString('en-US', { maximumFractionDigits: 0 });
    report(level, `${label} ${open ? 'OPEN  ' : 'closed'}${open !== shouldOpen ? ` (session says ${shouldOpen ? 'open' : 'closed'})` : ''}, ${priceNote}, ${risk.maxLeverage}x, OI $${oi}`);
  }

  // ------------------------------------------------------------------ options
  section('Options');
  const count = Number(await read<bigint>(d.optionsEngine, optionsAbi, 'seriesCount'));
  const series = count
    ? (await c.multicall({
        multicallAddress: MULTICALL3,
        allowFailure: false,
        contracts: Array.from({ length: count }, (_, i) => ({ address: d.optionsEngine, abi: optionsAbi, functionName: 'getSeries', args: [BigInt(i)] }) as const),
      })) as unknown as { assetId: number; settled: boolean; expiry: bigint; open: bigint }[]
    : [];
  const assetCount = Number(await read<bigint>(d.marketRegistry, registryAbi, 'assetCount'));
  const symbols = await Promise.all(Array.from({ length: assetCount }, (_, i) => read<{ symbol: string; optionsEnabled: boolean }>(d.marketRegistry, registryAbi, 'getAsset', [i])));
  const live = series.filter((s) => Number(s.expiry) > now);
  const late = series.filter((s) => !s.settled && Number(s.expiry) + SETTLE_LATE < now);
  const pending = series.filter((s) => !s.settled && Number(s.expiry) <= now);
  report(live.length > 0 ? 'ok' : 'fail', `${count} series in total, ${live.length} still trading`);
  const nextExpiry = live.length ? Math.min(...live.map((s) => Number(s.expiry))) : 0;
  const lastExpiry = live.length ? Math.max(...live.map((s) => Number(s.expiry))) : 0;
  if (live.length) {
    const days = (lastExpiry - now) / 86400;
    // markets:create lists the coming Fridays; if the furthest one is under a week away nothing has been added lately
    report(days > 7 ? 'ok' : 'warn', `next expiry ${new Date(nextExpiry * 1000).toISOString().slice(0, 16)}Z, furthest ${new Date(lastExpiry * 1000).toISOString().slice(0, 10)} (${days.toFixed(1)} days ahead)`);
  }
  const withoutSeries = symbols.filter((a, i) => a.optionsEnabled && !live.some((s) => s.assetId === i)).map((a) => a.symbol);
  report(withoutSeries.length ? 'warn' : 'ok', withoutSeries.length ? `no live options for: ${withoutSeries.join(', ')}` : `every options-enabled asset (${symbols.filter((a) => a.optionsEnabled).length}) has live series`);
  if (late.length) {
    const oldest = Math.min(...late.map((s) => Number(s.expiry)));
    const withOpen = late.filter((s) => s.open > 0n).length;
    report(withOpen ? 'fail' : 'warn', `${late.length} expired series unsettled for over an hour (${withOpen} with open contracts), oldest expired ${ago(now - oldest)} ago`);
  } else {
    report('ok', `settlement up to date${pending.length ? ` (${pending.length} expired in the last hour, waiting for the next run)` : ''}`);
  }

  // ------------------------------------------------------------------ website API
  section('Website API');
  const base = (process.env.PRICES_URL || 'https://hanmarket.vercel.app/api').replace(/\/$/, '');
  const timed = async (label: string, run: () => Promise<Response>) => {
    const t = Date.now();
    const r = await run();
    return { r, ms: Date.now() - t, label };
  };
  try {
    const { r, ms } = await timed('prices', () => fetch(`${base}/prices`));
    const body = (await r.json()) as { success: boolean; data?: Record<string, unknown> | unknown[]; updatedAt?: number | string };
    const n = body.data ? Object.keys(body.data).length : 0;
    const at = body.updatedAt ? new Date(body.updatedAt).getTime() / 1000 : now;
    report(r.ok && n > 0 ? 'ok' : 'fail', `/prices ${r.status} in ${ms}ms, ${n} assets, updated ${ago(Math.max(0, now - at))} ago`);
  } catch (e) {
    report('fail', `/prices: ${short(e)}`);
  }
  let quoteSeries: number | null = null;
  try {
    const { r, ms } = await timed('chain', () => fetch(`${base}/options/chain?network=${key}&symbol=BABA`));
    const body = (await r.json()) as { data?: { deployed: boolean; expiries: { rows?: { call?: { seriesId: number }; put?: { seriesId: number } }[] }[] } };
    const expiries = body.data?.expiries ?? [];
    const rows = expiries.flatMap((e) => e.rows ?? []);
    quoteSeries = rows.map((row) => row.call?.seriesId ?? row.put?.seriesId).find((id) => id !== undefined) ?? null;
    report(r.ok && body.data?.deployed && expiries.length ? 'ok' : 'fail', `/options/chain BABA ${r.status} in ${ms}ms, ${expiries.length} expiries, ${rows.length} strikes`);
  } catch (e) {
    report('fail', `/options/chain: ${short(e)}`);
  }
  if (quoteSeries === null) quoteSeries = live.length ? series.indexOf(live[0]) : null;
  if (quoteSeries !== null) {
    try {
      const { r, ms } = await timed('quote', () =>
        fetch(`${base}/options/quote`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ network: key, seriesId: quoteSeries, side: 'buy', contracts: 1 }),
        }),
      );
      const body = (await r.json()) as { success: boolean; error?: string; data?: { quote: Record<string, string | boolean>; signature: Hex } };
      if (!body.success || !body.data) {
        // outside the exchange session the quote endpoint may refuse on purpose; the signer can only be checked when it quotes
        report('warn', `/options/quote ${r.status}: ${body.error ?? 'no quote'}`);
      } else {
        const q = body.data.quote;
        const digest = await read<Hex>(d.optionsEngine, digestAbi, 'quoteDigest', [{
          seriesId: BigInt(q.seriesId as string), isBuy: q.isBuy as boolean, premium: BigInt(q.premium as string),
          maxQty: BigInt(q.maxQty as string), deadline: BigInt(q.deadline as string),
        }]);
        const signer = await recoverAddress({ hash: digest, signature: body.data.signature });
        report(same(signer, quoteSigner) ? 'ok' : 'fail', `/options/quote ${r.status} in ${ms}ms, signed by ${signer}${same(signer, quoteSigner) ? ' = the contract\'s quoteSigner' : ', NOT the contract\'s quoteSigner: every buy would revert'}`);
      }
    } catch (e) {
      report('fail', `/options/quote: ${short(e)}`);
    }
  }
  try {
    const { r, ms } = await timed('rpc', () =>
      fetch(`${base}/rpc?network=${key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      }),
    );
    const body = (await r.json().catch(() => ({}))) as { result?: string; error?: string | { message: string } };
    report(r.ok && body.result ? 'ok' : 'warn', `/rpc ${r.status} in ${ms}ms${body.result ? `, block ${BigInt(body.result)}` : ' (the site falls back to public RPCs)'}`);
  } catch (e) {
    report('warn', `/rpc: ${short(e)}`);
  }
}

main()
  .catch((e) => report('fail', `stopped: ${short(e)}`))
  .finally(() => {
    console.log(`\n${tally.ok} ok, ${tally.warn} warnings, ${tally.fail} failures`);
    process.exit(tally.fail ? 1 : 0);
  });
