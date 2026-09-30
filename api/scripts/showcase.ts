// HanMarket terminal showcase: a live, onchain report of every contract the protocol runs on Robinhood Chain testnet,
// drawn for a screen recording. Nothing is deployed and nothing is sent: every figure is read from the chain as it runs.
// Each contract's deployment transaction is fetched and its receipt must name that exact address, so the report can
// be checked line by line on the explorer.
//
//   npm run showcase                 interactive: type 1-6 (or deploy / verify / markets / status / clear / exit)
//   npm run showcase -- --auto       for recording: types verify and markets itself, then waits at the prompt
//   npm run showcase -- --auto --deploy   for recording the deployment: types deploy itself, then waits
//   npm run showcase -- --fast       no pacing (for a quick check)
//
// `deploy` replays the testnet deployment as it was recorded onchain: the contracts in the order they were created,
// each with its real creation transaction, block and gas. It sends nothing and says so on screen.
import 'dotenv/config';
import readline from 'node:readline';
import { formatEther, parseAbi, type Address, type Hash } from 'viem';
import { NETWORKS, publicClientFor } from '../src/chain';
import { oracleAbi, registryAbi, riskAbi, vaultAbi, perpsAbi, optionsAbi } from '../src/protocol/abis';

const AUTO = process.argv.includes('--auto');
const AUTO_DEPLOY = process.argv.includes('--deploy');
const FAST = process.argv.includes('--fast');
const EXPLORER = 'https://explorer.testnet.chain.robinhood.com';
const keeperAbi = parseAbi(['function keeper() view returns (address)']);
/** The terminal window's title bar, as the recording shows it. */
const TITLE = 'HANMARKET · node hanmarket_terminal.ts';

const d = NETWORKS.testnet.deployment;
if (!d) throw new Error('TESTNET_DEPLOYMENT is not set (api/.env)');
const client = publicClientFor('testnet');

// The transaction that created each contract, from the Foundry broadcast logs (contracts/broadcast/.../run-*.json).
// A receipt is fetched for each at run time and must report the same contract address.
const DEPLOY_TXS: Record<string, Hash> = {
  '0x2848ab87bda098bb58cf70d1747839d95108e1f4': '0x0ebfd216062b8b20a2026c6b0be8f62dd7c7f021929560b5fe2bd42f1c20925a',
  '0xd3c68f5afc3e8046179e75e247fc18d92e75a5de': '0xf658a544d61f1d4586d0b07f7f3ec7d1c2f65be9b46f10ed2b79560893ad1d5d',
  '0x2e523c27c4686929d8f25176c2b7d934eff959f9': '0x873b509d1b0ed031c263c5dc754630636dbbed0c29645eba6d4a0ffadeb2c58f',
  '0xbe2cb42686e78a2e6c21f77c5f10e71c5394c097': '0x861b1bd54b34738530fe28359d8e751d21d522c990a74008844438f2039d38b6',
  '0x698e84a0454182c7fd48325ad11d67b2c35f64c8': '0x3248bf6bc8a8517a001bac7afbe6c022efa27237adb87c1e72b83bb43ffbbe2e',
  '0x1b4bf0748f3323839a61e71facc4547166b32cf6': '0x58cd954da199c98f59abbc5b6862905a6559764d2dd84640c27c92fa4cfc8761',
  '0xd2eaef238dc7fd327df37ec336d706d7da18eedc': '0xdb7b534cb814b5ae9c4069d370876df6dcdb4bf2148fff62b333b11c74517bed',
  '0xc99f41a39a014e4b799e3183bf5f8ed2ece8c036': '0x040a9562db179682fe731c18dce3a738c9f6ef105ef37d7f9fc7e755ee4ad282',
  '0xe256ac034dbf78460ba951b155031200d6478654': '0x0bcf3885e0d9c1fcebde0c89e043a3d4073b757103252f95e01b62f130ff61df',
  '0x085d4f205de14cb2f59da37417dd682edeb55373': '0x80aef9048a8e3b96c6e1a1f914433aca99e38ca3b6bf37558db37809088152e0',
  '0x6e98a94691165a8f3705a5f005e4675ff0cc213b': '0x63b0461e22c84048040c63410dfe1995d3e60956cff4c2d3b3997a13221d4453',
  '0xf09781e074ea67469a84b6baf2d7ba62d5b134ac': '0x08d480ee325f3c300f3541da90da722105f10080a658c0d2b3da534addf51a6f',
  '0x2c52f94f6e40f0d7116341d1a11ae936d54217a5': '0x59019e2700617bea56f524091c4149eb4c0faa8a9bbb93b0fb3861c96105bc02',
  '0xabdbaef6184a8b8cf52e5a08aaeca4cfe94ff925': '0xc0868544d54075d4141827474e5638ced023ed0dd82984c67c08c460c0553fa9',
  '0x34e74f8b3fae45683bfe28bc949a7564e8fa2d83': '0x30d3ad58be50b7fb86e1e4082ec76319debe976a2be58eefff153d475acc3ecd',
};

// ---------------------------------------------------------------- drawing

const rgb = (r: number, g: number, b: number) => (s: string | number) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
const gold = rgb(201, 163, 106);
const goldHi = rgb(226, 194, 141);
const red = rgb(240, 74, 82);
const green = rgb(38, 194, 129);
const ink = rgb(236, 236, 239);
const dim = rgb(110, 110, 120);
const muted = rgb(160, 160, 170);
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const out = (s = '') => process.stdout.write(`${s}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, FAST ? 0 : ms));
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - strip(s).length));
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

const MARK = [
  '                    .::---    ---:..', '               .:-=+++++++   .+++++++=-:.', '            .-=+++++++++++   .+++++++++++=-.',
  '          :=++++++++=-++++   .+++=-=++++++++=.', '        :=++++++=-.   =+++   .+++-   :-+++++++=.', '      .=++++++-.      =*++   .++*-      :=++++++-',
  '     :++++++-.        ::::    :::.        .=++++++.', '    :++++++:    ........................    :++++++.', '   .++++++.    -++++++++++++++++++++++++:    :++++++',
  '   ++++++.     -++++===============+++++:     :+++++=', '  -+++++:      -++++               .++++:      =+++++.', '  ++++++.....  -++++               .++++:  ....:+++++-',
  ' .+++++++++++  -++++               .++++: .+++++++++++', '  ...........  -++++               .++++:  ...........', '               -++++               .++++:',
  ' .===========  -++++               .++++: .+==========', '  ++++++-----  -++++               .++++: .----=+++++=', '  -+++++:      -++++               .++++:      -+++++:',
  '   ++++++.     -++++================++++:     :+++++=', '   :++++++.    -*+++****************+++*:    :++++++', '    :++++++:   .::::::::::::::::::::::::    -++++++.',
  '     .++++++=.        ::::    :::.        :++++++=.', '       =++++++=:      =**+   .*+*-      :=++++++-', '        .=+++++++-:.  =+++   .+++-  .:=+++++++=.',
  '          :=+++++++++=++++   .++++=+++++++++-.', '            .:=+++++++++++   .+++++++++++=:', '                :-=+++++++   .++++++==-.',
  '                    ..::--    --::.',
];

function box(title: string, rows: string[], width = 86) {
  const line = '─'.repeat(width - 2);
  out(gold(`┌${line}┐`));
  out(gold('│ ') + pad(title, width - 4) + gold(' │'));
  out(gold(`├${line}┤`));
  for (const r of rows) out(gold('│ ') + pad(r, width - 4) + gold(' │'));
  out(gold(`└${line}┘`));
}

/** A question and the answer typed after it, as someone at the keyboard would. */
async function typeAnswer(question: string, answer: string) {
  process.stdout.write(muted(question));
  await sleep(700);
  for (const ch of answer) { process.stdout.write(ink(ch)); await sleep(90); }
  await sleep(300);
  out();
}

async function typeCommand(cmd: string) {
  process.stdout.write(prompt());
  for (const ch of cmd) {
    process.stdout.write(ink(ch));
    await sleep(45 + Math.random() * 55);
  }
  await sleep(350);
  out();
}

const prompt = () => `${gold('┌──[')}${goldHi('HANMARKET TERMINAL v1.0')}${gold(']─[')}${muted('NET: ')}${red('Robinhood Chain Testnet (46630)')}${gold(']')}\n${gold('└──> ')}`;

/** A progress bar that fills while `work` runs, and finishes when it does (never faster than `minMs`). */
async function progress<T>(label: string, work: Promise<T>, minMs: number): Promise<T> {
  const W = 26;
  const start = Date.now();
  let done = false;
  let result: T | undefined;
  let error: unknown;
  work.then((r) => { result = r; done = true; }, (e) => { error = e; done = true; });
  let f = 0;
  while (true) {
    const t = Date.now() - start;
    const target = done && t >= minMs ? 1 : Math.min(0.93, t / Math.max(minMs, 1));
    f = Math.max(f, target);
    const n = Math.round(f * W);
    process.stdout.write(`\r${muted('[*]')} ${ink(pad(label, 26))} ${gold('[')}${green('█'.repeat(n))}${dim('░'.repeat(W - n))}${gold(']')} ${dim(`${Math.round(f * 100)}%`.padStart(4))}`);
    if (f >= 1) break;
    await sleep(40);
    if (FAST && done) f = 1;
  }
  out();
  if (error) throw error;
  return result as T;
}

// ---------------------------------------------------------------- data

interface Row { name: string; address: Address; role: string }

async function contracts(): Promise<Row[]> {
  const core: Row[] = [
    { name: 'MarketRegistry', address: d!.marketRegistry, role: 'Assets and perp markets' },
    { name: 'OracleRouter', address: d!.oracleRouter, role: 'Price feeds and signed settlement prices' },
    { name: 'FeeManager', address: d!.feeManager, role: 'Trading, settlement and liquidation fees' },
    { name: 'RiskManager', address: d!.riskManager, role: 'Leverage, margin and open-interest limits' },
    { name: 'Vault', address: d!.vault, role: 'USDC pool, counterparty to every trade' },
    { name: 'OptionsEngine', address: d!.optionsEngine, role: 'Cash-settled European calls and puts' },
    { name: 'PerpsEngine', address: d!.perpsEngine, role: 'Isolated-margin perpetuals' },
    { name: 'Collateral (test USDC)', address: d!.collateralToken, role: 'Testnet stand-in for USDC' },
  ];
  // one price feed per perp market, found through the registry and the oracle, not from a list
  const n = Number(await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'perpMarketCount' }));
  const feeds: Row[] = [];
  for (let m = 0; m < n; m++) {
    const mk = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getPerpMarket', args: [m] });
    const a = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [mk.assetId] });
    const f = await client.readContract({ address: d!.oracleRouter, abi: oracleAbi, functionName: 'getFeed', args: [a.oracleId] });
    feeds.push({ name: `PriceFeed ${a.symbol}`, address: f.aggregator, role: `${mk.symbol} index, updated by the keeper` });
  }
  return [...core, ...feeds];
}

async function inspect(r: Row) {
  const tx = DEPLOY_TXS[r.address.toLowerCase()];
  const code = await client.getCode({ address: r.address });
  const receipt = tx ? await client.getTransactionReceipt({ hash: tx }) : null;
  const block = receipt ? await client.getBlock({ blockNumber: receipt.blockNumber }) : null;
  return {
    bytes: code ? (code.length - 2) / 2 : 0,
    tx,
    matches: !!receipt && receipt.contractAddress?.toLowerCase() === r.address.toLowerCase() && receipt.status === 'success',
    gas: receipt?.gasUsed ?? 0n,
    block: receipt?.blockNumber,
    index: receipt?.transactionIndex ?? 0,
    from: receipt?.from,
    time: block ? new Date(Number(block.timestamp) * 1000) : null,
  };
}

/**
 * The first deployment (contracts/script/Deploy.s.sol), as the chain recorded it: the test USDC, BABA's price feed and
 * the seven core contracts, in the order they were created. The six later price feeds came from a separate script.
 */
async function deploymentRecord() {
  const rows = (await contracts()).filter((r) => !r.name.startsWith('PriceFeed') || r.name === 'PriceFeed BABA');
  const items = await Promise.all(rows.map(async (r) => ({ r, i: await inspect(r) })));
  return items
    .filter((x) => x.i.matches && x.i.block !== undefined)
    .sort((a, b) => Number(a.i.block! - b.i.block!) || a.i.index - b.i.index);
}

// ---------------------------------------------------------------- commands

async function banner() {
  out();
  for (const l of MARK) { out(`        ${gold(l)}`); await sleep(18); }
  out();
  const chainId = await client.getChainId(); // also opens the connection, so the timing below is one request's round trip
  const t0 = Date.now();
  const head = await client.getBlockNumber();
  const latency = Date.now() - t0;
  const rpc = new URL(NETWORKS.testnet.chain.rpcUrls.default.http[0]).host;
  box(`${bold(goldHi('HANMARKET'))} ${dim('│')} ${muted('Onchain derivatives for Hong Kong & China equities')}`, [
    `${green('[✓]')} ${muted('RPC endpoint ')} : ${ink(rpc)} ${dim(`(latency ${latency} ms)`)}`,
    `${green('[✓]')} ${muted('Chain ID     ')} : ${ink(String(chainId))} ${dim('(Robinhood Chain Testnet)')}`,
    `${green('[✓]')} ${muted('Latest block ')} : ${ink(head.toLocaleString('en-US'))}`,
    `${green('[✓]')} ${muted('Settlement   ')} : ${ink('USDC')} ${dim('· options + perpetuals · vault as counterparty')}`,
  ]);
  out(dim('Available commands: [1] deploy | [2] verify | [3] markets | [4] status | [5] clear | [6] exit'));
  out();
}

async function verify() {
  out(`${gold('[*]')} ${goldHi('VERIFYING HANMARKET PROTOCOL ONCHAIN…')}`);
  const rows = await progress('Reading contract registry', contracts(), 900);
  out(`${green('[✓]')} ${muted(`${rows.length} contracts found: 8 core, ${rows.length - 8} perp price feeds`)}`);
  out();
  const results: { r: Row; i: Awaited<ReturnType<typeof inspect>> }[] = [];
  let totalGas = 0n;
  for (const r of rows) {
    const i = await progress(`Verify ${r.name}`, inspect(r), 700 + Math.random() * 600);
    results.push({ r, i });
    totalGas += i.gas;
    out(`    ${i.matches ? green('✓ Contract  ') : red('✗ Contract  ')}: ${goldHi(r.address)}`);
    out(`    ${dim('├─')} ${muted('Role      ')}: ${ink(r.role)}`);
    out(`    ${dim('├─')} ${muted('Deploy tx ')}: ${dim(i.tx ?? 'not in the broadcast log')}`);
    out(`    ${dim('├─')} ${muted('Block     ')}: ${ink(i.block?.toLocaleString('en-US') ?? '—')} ${dim(i.time ? `(${i.time.toISOString().slice(0, 16).replace('T', ' ')} UTC)` : '')}`);
    out(`    ${dim('└─')} ${muted('Bytecode  ')}: ${ink(i.bytes.toLocaleString('en-US'))} bytes ${dim('·')} ${muted('gas')} ${ink(i.gas.toLocaleString('en-US'))}`);
    out();
  }
  const ok = results.every((x) => x.i.matches && x.i.bytes > 0);
  box(ok ? green(bold(`✓ VERIFIED: ALL ${results.length} HANMARKET CONTRACTS ARE LIVE ONCHAIN`)) : red(bold('✗ SOME CONTRACTS DID NOT VERIFY')), [
    `${muted('Network        ')} : ${ink('Robinhood Chain Testnet (Chain ID 46630)')}`,
    `${muted('Block explorer ')} : ${ink(EXPLORER)}`,
    `${muted('Deploy gas     ')} : ${ink(totalGas.toLocaleString('en-US'))} ${dim('units across all deployments')}`,
  ]);
  out();
  out(`${bold(goldHi('DEPLOYED CONTRACT ADDRESSES'))}`);
  out(dim('─'.repeat(86)));
  out(`${pad(muted('CONTRACT'), 26)}${pad(muted('STATUS'), 12)}${muted('ADDRESS')}`);
  out(dim('─'.repeat(86)));
  for (const { r, i } of results) {
    out(`${pad(ink(r.name), 26)}${pad(i.matches ? green('[ONLINE]') : red('[CHECK]'), 12)}${goldHi(r.address)}`);
    await sleep(60);
  }
  out(dim('─'.repeat(86)));
  out(dim('Every address and transaction above can be checked on the explorer.'));
  out();
}

async function deploy() {
  out(`${gold('[INFO]')} ${goldHi('HANMARKET DEPLOYMENT · ROBINHOOD CHAIN TESTNET')}`);
  out(dim('       A replay of the recorded deployment. Every address, hash, block and gas figure is read back from the chain.'));
  const record = await progress('Loading deployment record', deploymentRecord(), 1100);
  if (!record.length) throw new Error('no deployment transactions found');
  const first = record[0].i;
  const last = record[record.length - 1].i;
  const day = (t: Date | null) => (t ? t.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '');
  out(`${muted('Deployer     ')} : ${goldHi(first.from ?? '')}`);
  out(`${muted('Blocks       ')} : ${ink(first.block!.toLocaleString('en-US'))} ${dim('→')} ${ink(last.block!.toLocaleString('en-US'))} ${dim(`(${day(first.time)})`)}`);
  out(`${muted('Script       ')} : ${ink('contracts/script/Deploy.s.sol')} ${dim('· solc 0.8.24 · via-IR · optimizer 200 runs')}`);
  out();
  await typeAnswer('Replay the deployment? [Y/n] ', 'y');
  out();

  let totalGas = 0n;
  for (const { r, i } of record) {
    await progress(`Deploy ${r.name}`, Promise.resolve(), 900 + Math.random() * 700);
    totalGas += i.gas;
    out(`    ${green('✓ Deployed  ')}: ${goldHi(r.address)}`);
    out(`    ${dim('├─')} ${muted('Role      ')}: ${ink(r.role)}`);
    out(`    ${dim('├─')} ${muted('Tx        ')}: ${dim(i.tx ?? '')}`);
    out(`    ${dim('├─')} ${muted('Block     ')}: ${ink(i.block!.toLocaleString('en-US'))} ${dim(`(${day(i.time)})`)}`);
    out(`    ${dim('└─')} ${muted('Gas used  ')}: ${ink(i.gas.toLocaleString('en-US'))}`);
    out();
  }

  // what the same script then configured, as the contracts hold it today
  const [assets, perpCount] = await Promise.all([
    client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'assetCount' }),
    client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'perpMarketCount' }),
  ]);
  await progress('Register assets', Promise.resolve(), 900);
  out(`    ${green('✓')} ${ink(`${assets} Hong Kong & China equities listed`)} ${dim('· options on every one')}`);
  await progress('Open perpetual markets', Promise.resolve(), 800);
  out(`    ${green('✓')} ${ink('BABA-PERP opened')} ${dim(`· ${perpCount} perpetual markets live today`)}`);
  await progress('Wire vault, fees and risk', Promise.resolve(), 800);
  out(`    ${green('✓')} ${ink('Vault trusts OptionsEngine and PerpsEngine')} ${dim('· fees and risk limits set')}`);
  out();

  box(green(bold(`✓ DEPLOYED: ${record.length} HANMARKET CONTRACTS ON ROBINHOOD CHAIN TESTNET`)), [
    `${muted('Network        ')} : ${ink('Robinhood Chain Testnet (Chain ID 46630)')}`,
    `${muted('Block explorer ')} : ${ink(EXPLORER)}`,
    `${muted('Deploy gas     ')} : ${ink(totalGas.toLocaleString('en-US'))} ${dim('units, contract creations')}`,
  ]);
  out();
  out(`${bold(goldHi('DEPLOYED CONTRACT ADDRESSES'))}`);
  out(dim('─'.repeat(86)));
  for (const { r } of record) {
    out(`${pad(ink(r.name), 26)}${pad(green('[LIVE]'), 12)}${goldHi(r.address)}`);
    await sleep(60);
  }
  out(dim('─'.repeat(86)));
  out(dim('Every address and transaction above can be checked on the explorer.'));
  out();
}

async function markets() {
  const n = Number(await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'perpMarketCount' }));
  const series = await client.readContract({ address: d!.optionsEngine, abi: optionsAbi, functionName: 'seriesCount' });
  const assets = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'assetCount' });
  out(`${bold(goldHi('PERPETUAL MARKETS'))} ${dim(`· ${n} live · ${assets} listed assets · ${series} option series`)}`);
  out(dim('─'.repeat(86)));
  out(`${pad(muted('MARKET'), 16)}${pad(muted('INDEX (USD)'), 14)}${pad(muted('MAX LEV'), 10)}${pad(muted('FUNDING/1H'), 13)}${pad(muted('OPEN INT. L/S'), 20)}${muted('SESSION')}`);
  out(dim('─'.repeat(86)));
  for (let m = 0; m < n; m++) {
    const mk = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getPerpMarket', args: [m] });
    const a = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [mk.assetId] });
    const [price] = await client.readContract({ address: d!.oracleRouter, abi: oracleAbi, functionName: 'getPrice', args: [a.oracleId] }).catch(() => [0n, 0n] as const);
    const risk = await client.readContract({ address: d!.riskManager, abi: riskAbi, functionName: 'getPerpRisk', args: [m] });
    const open = await client.readContract({ address: d!.riskManager, abi: riskAbi, functionName: 'tradingOpen', args: [m] });
    const st = await client.readContract({ address: d!.perpsEngine, abi: perpsAbi, functionName: 'getMarketState', args: [m] });
    const rate = await client.readContract({ address: d!.perpsEngine, abi: perpsAbi, functionName: 'currentFundingRate', args: [m] });
    const oi = `$${(Number(st.longEntryNotional) / 1e6).toLocaleString('en-US')} / $${(Number(st.shortEntryNotional) / 1e6).toLocaleString('en-US')}`;
    out(`${pad(ink(mk.symbol), 16)}${pad(goldHi((Number(price) / 1e6).toFixed(2)), 14)}${pad(ink(`${risk.maxLeverage}x`), 10)}${pad(ink(`${(Number(rate) / 1e16).toFixed(4)}%`), 13)}${pad(ink(oi), 20)}${open ? green('OPEN') : red('CLOSED')}`);
    await sleep(80);
  }
  out(dim('─'.repeat(86)));
  out();
}

async function status() {
  const [pool, reserved, util, head] = await Promise.all([
    client.readContract({ address: d!.vault, abi: vaultAbi, functionName: 'poolAmount' }),
    client.readContract({ address: d!.vault, abi: vaultAbi, functionName: 'reservedAmount' }),
    client.readContract({ address: d!.vault, abi: vaultAbi, functionName: 'utilizationBps' }),
    client.getBlockNumber(),
  ]);
  const keeper = await client.readContract({ address: d!.riskManager, abi: keeperAbi, functionName: 'keeper' });
  const gas = await client.getBalance({ address: keeper });
  box(bold(goldHi('PROTOCOL STATUS')), [
    `${muted('Vault liquidity ')} : ${goldHi(`$${(Number(pool) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })}`)} ${dim('USDC')}`,
    `${muted('Reserved        ')} : ${ink(`$${(Number(reserved) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })}`)} ${dim(`(utilization ${Number(util) / 100}%)`)}`,
    `${muted('Keeper          ')} : ${ink(short(keeper))} ${dim(`· ${Number(formatEther(gas)).toFixed(5)} ETH for gas`)}`,
    `${muted('Latest block    ')} : ${ink(head.toLocaleString('en-US'))}`,
  ]);
  out();
}

// ---------------------------------------------------------------- main

const COMMANDS: Record<string, () => Promise<void>> = {
  '1': deploy, deploy, '2': verify, verify, '3': markets, markets, '4': status, status,
};

async function main() {
  process.stdout.write(`\x1b]0;${TITLE}\x07`); // the window title (Windows Terminal, macOS Terminal, iTerm)
  process.stdout.write('\x1b[2J\x1b[H');
  await banner();
  if (AUTO && AUTO_DEPLOY) {
    await sleep(1200);
    await typeCommand('hanmarket deploy --network robinhoodTestnet');
    await deploy();
  } else if (AUTO) {
    await sleep(1200);
    await typeCommand('hanmarket verify --network robinhoodTestnet');
    await verify();
    await sleep(1500);
    await typeCommand('hanmarket markets');
    await markets();
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () => rl.question(prompt(), async (raw) => {
    const cmd = raw.trim().toLowerCase().replace(/^hanmarket\s+/, '').split(/\s+/)[0];
    if (cmd === '6' || cmd === 'exit' || cmd === 'quit') { rl.close(); return; }
    if (cmd === '5' || cmd === 'clear') { process.stdout.write('\x1b[2J\x1b[H'); await banner(); return ask(); }
    const run = COMMANDS[cmd];
    if (run) await run().catch((e) => out(red(`error: ${(e as Error).message.split('\n')[0]}`)));
    else if (cmd) out(dim('Commands: [1] deploy | [2] verify | [3] markets | [4] status | [5] clear | [6] exit'));
    ask();
  });
  ask();
}

main().catch((e) => {
  out(red(`showcase failed: ${(e as Error).message}`));
  process.exit(1);
});
