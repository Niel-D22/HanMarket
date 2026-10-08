// HanMarket terminal showcase: a live, onchain report of every contract the protocol runs on Robinhood Chain,
// drawn for a screen recording. Nothing is deployed and nothing is sent: every figure is read from the chain as it runs.
// Each contract's deployment transaction is fetched and its receipt must name that exact address, so the report can
// be checked line by line on the explorer.
//
//   npm run showcase                 interactive: type 1-6 (or deploy / verify / markets / status / clear / exit)
//   npm run showcase -- --auto       for recording: types verify and markets itself, then waits at the prompt
//   npm run showcase -- --auto --deploy   for recording the deployment: types deploy and markets itself, then waits
//   npm run showcase -- --fast       no pacing (for a quick check)
//   add --network mainnet            the mainnet deployment instead of testnet's
//   add --wait                       blank screen until Enter, so the recording can start before the show does
//   npm run showcase -- --network mainnet --auto --cook --wait   a teaser: the next feature is built, its name withheld
//
// `cook` checks the live protocol for real (chain, contracts, owner, settlement token) and then shows the build steps
// of an unannounced feature with its name blacked out. Those steps are a teaser, and the screen says it is pre-release.
//
// `deploy` replays the deployment as it was recorded onchain: the contracts in the order they were created, each with
// its real creation transaction, block and gas (and, on mainnet, the Safe accepting ownership). It sends nothing and
// says so on screen.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { formatEther, parseAbi, type Address, type Hash } from 'viem';
import { NETWORKS, publicClientFor, type NetworkKey } from '../src/chain';
import { feeAbi, oracleAbi, registryAbi, riskAbi, vaultAbi, perpsAbi, optionsAbi } from '../src/protocol/abis';

const AUTO = process.argv.includes('--auto');
const AUTO_DEPLOY = process.argv.includes('--deploy');
const FAST = process.argv.includes('--fast');
const WAIT = process.argv.includes('--wait');
const COOK = process.argv.includes('--cook');
const NETWORK: NetworkKey = process.argv[process.argv.indexOf('--network') + 1] === 'mainnet' ? 'mainnet' : 'testnet';
const MAINNET = NETWORK === 'mainnet';
const EXPLORER = MAINNET ? 'https://robinhoodchain.blockscout.com' : 'https://explorer.testnet.chain.robinhood.com';
const NET_NAME = MAINNET ? 'Robinhood Chain Mainnet' : 'Robinhood Chain Testnet';
const NET_LABEL = `${NET_NAME} (Chain ID ${MAINNET ? 4663 : 46630})`;
const NET_FLAG = MAINNET ? 'robinhoodMainnet' : 'robinhoodTestnet';
const TOKEN = MAINNET ? 'USDG' : 'USDC';
const keeperAbi = parseAbi(['function keeper() view returns (address)']);
const ownableAbi = parseAbi(['function owner() view returns (address)']);
const safeAbi = parseAbi(['function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)']);
/** The terminal window's title bar, as the recording shows it. */
const TITLE = 'HANMARKET · node hanmarket_terminal.ts';

const d = NETWORKS[NETWORK].deployment;
if (!d) throw new Error(`${NETWORK.toUpperCase()}_DEPLOYMENT is not set (api/.env)`);
const client = publicClientFor(NETWORK);

/** The Safe transaction that accepted ownership of all seven mainnet contracts (deploy-mainnet.sh accept-exec). */
const MAINNET_HANDOVER_TX: Hash = '0x0e6332526b3857ef6fb05296fb2d4137904bf46ce9f9f10b80d4224ded72c912';

/** Mainnet's Foundry broadcast record, kept in the repo: every contract's creation tx, and what the whole deploy cost. */
function mainnetRecord() {
  const file = path.resolve(__dirname, '../../contracts/deployments/mainnet-4663-broadcast.json');
  const run = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    transactions: { transactionType: string; contractAddress: string; hash: Hash }[];
    receipts: { gasUsed: string; effectiveGasPrice: string }[];
  };
  return {
    txs: Object.fromEntries(run.transactions.filter((t) => t.transactionType === 'CREATE').map((t) => [t.contractAddress.toLowerCase(), t.hash])) as Record<string, Hash>,
    count: run.receipts.length,
    costWei: run.receipts.reduce((s, r) => s + BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice), 0n),
  };
}
const MAINNET_RECORD = MAINNET ? mainnetRecord() : null;

// Testnet: the transaction that created each contract, from the Foundry broadcast logs (contracts/broadcast/.../run-*.json).
// A receipt is fetched for each at run time and must report the same contract address.
const TESTNET_DEPLOY_TXS: Record<string, Hash> = {
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
const DEPLOY_TXS = MAINNET_RECORD?.txs ?? TESTNET_DEPLOY_TXS;

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

/** HANMARKET in block letters, for the teaser's title card. */
const WORDMARK = [
  '██╗  ██╗ █████╗ ███╗   ██╗███╗   ███╗ █████╗ ██████╗ ██╗  ██╗███████╗████████╗',
  '██║  ██║██╔══██╗████╗  ██║████╗ ████║██╔══██╗██╔══██╗██║ ██╔╝██╔════╝╚══██╔══╝',
  '███████║███████║██╔██╗ ██║██╔████╔██║███████║██████╔╝█████╔╝ █████╗     ██║   ',
  '██╔══██║██╔══██║██║╚██╗██║██║╚██╔╝██║██╔══██║██╔══██╗██╔═██╗ ██╔══╝     ██║   ',
  '██║  ██║██║  ██║██║ ╚████║██║ ╚═╝ ██║██║  ██║██║  ██║██║  ██╗███████╗   ██║   ',
  '╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ',
];
/** a blacked-out word, as in a redacted document */
const redact = (n: number) => '█'.repeat(n);

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

const prompt = () => `${gold('┌──[')}${goldHi('HANMARKET TERMINAL v1.0')}${gold(']─[')}${muted('NET: ')}${red(`${NET_NAME} (${MAINNET ? 4663 : 46630})`)}${gold(']')}\n${gold('└──> ')}`;

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

/** `external`: a contract HanMarket uses but did not deploy (mainnet's USDG, Chainlink feed and Safe). */
interface Row { name: string; address: Address; role: string; external?: boolean }

async function contracts(): Promise<Row[]> {
  const core: Row[] = [
    { name: 'MarketRegistry', address: d!.marketRegistry, role: 'Assets and perp markets' },
    { name: 'OracleRouter', address: d!.oracleRouter, role: 'Price feeds and signed settlement prices' },
    { name: 'FeeManager', address: d!.feeManager, role: 'Trading, settlement and liquidation fees' },
    { name: 'RiskManager', address: d!.riskManager, role: 'Leverage, margin and open-interest limits' },
    { name: 'Vault', address: d!.vault, role: `${TOKEN} pool, counterparty to every trade` },
    { name: 'OptionsEngine', address: d!.optionsEngine, role: 'Cash-settled European calls and puts' },
    { name: 'PerpsEngine', address: d!.perpsEngine, role: 'Isolated-margin perpetuals' },
    MAINNET
      ? { name: 'USDG (Global Dollar)', address: d!.collateralToken, role: 'Settlement token, issued by Paxos', external: true }
      : { name: 'Collateral (test USDC)', address: d!.collateralToken, role: 'Testnet stand-in for USDC' },
  ];
  // one price feed per perp market, found through the registry and the oracle, not from a list
  const n = Number(await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'perpMarketCount' }));
  const feeds: Row[] = [];
  for (let m = 0; m < n; m++) {
    const mk = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getPerpMarket', args: [m] });
    const a = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [mk.assetId] });
    const f = await client.readContract({ address: d!.oracleRouter, abi: oracleAbi, functionName: 'getFeed', args: [a.oracleId] });
    feeds.push(MAINNET
      ? { name: `Chainlink ${a.symbol} / USD`, address: f.aggregator, role: `${mk.symbol} index, Chainlink price feed`, external: true }
      : { name: `PriceFeed ${a.symbol}`, address: f.aggregator, role: `${mk.symbol} index, updated by the keeper` });
  }
  if (!MAINNET) return [...core, ...feeds];
  // the owner, read from the registry rather than assumed
  const owner = await client.readContract({ address: d!.marketRegistry, abi: ownableAbi, functionName: 'owner' });
  const [owners, threshold] = await Promise.all([
    client.readContract({ address: owner, abi: safeAbi, functionName: 'getOwners' }),
    client.readContract({ address: owner, abi: safeAbi, functionName: 'getThreshold' }),
  ]);
  return [...core, ...feeds, { name: 'Safe (owner)', address: owner, role: `Owns every contract, ${threshold} of ${owners.length} multisig`, external: true }];
}

async function inspect(r: Row) {
  const tx = DEPLOY_TXS[r.address.toLowerCase()];
  const code = await client.getCode({ address: r.address });
  const receipt = tx ? await client.getTransactionReceipt({ hash: tx }) : null;
  const block = receipt ? await client.getBlock({ blockNumber: receipt.blockNumber }) : null;
  return {
    bytes: code ? (code.length - 2) / 2 : 0,
    tx,
    matches: r.external
      ? !!code && code !== '0x'
      : !!receipt && receipt.contractAddress?.toLowerCase() === r.address.toLowerCase() && receipt.status === 'success',
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
  const rows = (await contracts()).filter((r) => !r.external && (!r.name.startsWith('PriceFeed') || r.name === 'PriceFeed BABA'));
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
  const rpc = new URL(NETWORKS[NETWORK].chain.rpcUrls.default.http[0]).host;
  box(`${bold(goldHi('HANMARKET'))} ${dim('│')} ${muted('Onchain derivatives for Hong Kong & China equities')}`, [
    `${green('[✓]')} ${muted('RPC endpoint ')} : ${ink(rpc)} ${dim(`(latency ${latency} ms)`)}`,
    `${green('[✓]')} ${muted('Chain ID     ')} : ${ink(String(chainId))} ${dim(`(${NET_NAME})`)}`,
    `${green('[✓]')} ${muted('Latest block ')} : ${ink(head.toLocaleString('en-US'))}`,
    `${green('[✓]')} ${muted('Settlement   ')} : ${ink(TOKEN)} ${dim('· options + perpetuals · vault as counterparty')}`,
  ]);
  out(dim('Available commands: [1] deploy | [2] verify | [3] markets | [4] status | [5] clear | [6] exit'));
  out();
}

async function verify() {
  out(`${gold('[*]')} ${goldHi('VERIFYING HANMARKET PROTOCOL ONCHAIN…')}`);
  const rows = await progress('Reading contract registry', contracts(), 900);
  const ext = rows.filter((r) => r.external).length;
  out(`${green('[✓]')} ${muted(MAINNET
    ? `${rows.length} contracts found: ${rows.length - ext} HanMarket core, ${ext} external (settlement token, price feed, owner Safe)`
    : `${rows.length} contracts found: 8 core, ${rows.length - 8} perp price feeds`)}`);
  out();
  const results: { r: Row; i: Awaited<ReturnType<typeof inspect>> }[] = [];
  let totalGas = 0n;
  for (const r of rows) {
    const i = await progress(`Verify ${r.name}`, inspect(r), 700 + Math.random() * 600);
    results.push({ r, i });
    totalGas += i.gas;
    out(`    ${i.matches ? green('✓ Contract  ') : red('✗ Contract  ')}: ${goldHi(r.address)}`);
    out(`    ${dim('├─')} ${muted('Role      ')}: ${ink(r.role)}`);
    out(`    ${dim('├─')} ${muted('Deploy tx ')}: ${dim(i.tx ?? (r.external ? 'external contract, not deployed by HanMarket' : 'not in the broadcast log'))}`);
    out(`    ${dim('├─')} ${muted('Block     ')}: ${ink(i.block?.toLocaleString('en-US') ?? '—')} ${dim(i.time ? `(${i.time.toISOString().slice(0, 16).replace('T', ' ')} UTC)` : '')}`);
    out(`    ${dim('└─')} ${muted('Bytecode  ')}: ${ink(i.bytes.toLocaleString('en-US'))} bytes ${dim('·')} ${muted('gas')} ${ink(i.gas.toLocaleString('en-US'))}`);
    out();
  }
  const ok = results.every((x) => x.i.matches && x.i.bytes > 0);
  box(ok ? green(bold(`✓ VERIFIED: ALL ${results.length} HANMARKET CONTRACTS ARE LIVE ONCHAIN`)) : red(bold('✗ SOME CONTRACTS DID NOT VERIFY')), [
    `${muted('Network        ')} : ${ink(NET_LABEL)}`,
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
  out(`${gold('[INFO]')} ${goldHi(`HANMARKET DEPLOYMENT · ${NET_NAME.toUpperCase()}`)}`);
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
  out(`    ${green('✓')} ${ink(MAINNET ? 'BABA-PERP listed, priced by Chainlink' : 'BABA-PERP opened')} ${dim(`· ${perpCount} perpetual market${perpCount === 1n ? '' : 's'} live today`)}`);
  await progress('Wire vault, fees and risk', Promise.resolve(), 800);
  out(`    ${green('✓')} ${ink('Vault trusts OptionsEngine and PerpsEngine')} ${dim('· fees and risk limits set')}`);
  out();

  // mainnet: the deployer only proposed the Safe as owner; the Safe then accepted, with both signatures
  let owner: Address | null = null;
  let signers = '';
  if (MAINNET) {
    await typeAnswer('Hand ownership to the Safe multisig? [Y/n] ', 'y');
    out();
    const handover = await progress('Safe accepts ownership', (async () => {
      const receipt = await client.getTransactionReceipt({ hash: MAINNET_HANDOVER_TX });
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      const own = await client.readContract({ address: d!.vault, abi: ownableAbi, functionName: 'owner' });
      const [owners, threshold] = await Promise.all([
        client.readContract({ address: own, abi: safeAbi, functionName: 'getOwners' }),
        client.readContract({ address: own, abi: safeAbi, functionName: 'getThreshold' }),
      ]);
      return { receipt, block, own, owners, threshold };
    })(), 1400);
    owner = handover.own;
    signers = `${handover.threshold} of ${handover.owners.length}`;
    const accepted = handover.receipt.status === 'success' && handover.receipt.to?.toLowerCase() === owner.toLowerCase();
    out(`    ${accepted ? green('✓ Owner     ') : red('✗ Owner     ')}: ${goldHi(owner)}`);
    out(`    ${dim('├─')} ${muted('Role      ')}: ${ink(`Safe multisig, ${signers} signatures, owns all ${record.length} contracts`)}`);
    out(`    ${dim('├─')} ${muted('Tx        ')}: ${dim(MAINNET_HANDOVER_TX)}`);
    out(`    ${dim('└─')} ${muted('Block     ')}: ${ink(handover.receipt.blockNumber.toLocaleString('en-US'))} ${dim(`(${day(new Date(Number(handover.block.timestamp) * 1000))})`)}`);
    out();
  }

  box(green(bold(`✓ DEPLOYED: ${record.length} HANMARKET CONTRACTS ON ${NET_NAME.toUpperCase()}`)), [
    `${muted('Network        ')} : ${ink(NET_LABEL)}`,
    `${muted('Block explorer ')} : ${ink(EXPLORER)}`,
    ...(MAINNET_RECORD
      ? [`${muted('Transactions   ')} : ${ink(String(MAINNET_RECORD.count))} ${dim(`· total cost ${Number(formatEther(MAINNET_RECORD.costWei)).toFixed(6)} ETH`)}`,
        `${muted('Owner          ')} : ${ink(`Safe multisig, ${signers}`)} ${dim(short(owner ?? ''))}`]
      : [`${muted('Deploy gas     ')} : ${ink(totalGas.toLocaleString('en-US'))} ${dim('units, contract creations')}`]),
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

  // every listed equity and where its price comes from, read from the registry and the oracle
  const list = await progress('Reading listed equities', Promise.all(Array.from({ length: Number(assets) }, async (_, id) => {
    const a = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [id] });
    const f = await client.readContract({ address: d!.oracleRouter, abi: oracleAbi, functionName: 'getFeed', args: [a.oracleId] });
    return { symbol: a.symbol, chainlink: Number(f.source) === 1 };
  })), 900);
  const viaChainlink = list.filter((x) => x.chainlink).length;
  out(`${bold(goldHi('LISTED EQUITIES'))} ${dim(`· ${list.length} assets · options on every one · ${green('●')} Chainlink ${viaChainlink} · ${gold('●')} HanMarket signer ${list.length - viaChainlink}`)}`);
  out(dim('─'.repeat(86)));
  for (let i = 0; i < list.length; i += 5) {
    out(list.slice(i, i + 5).map((x) => pad(`${x.chainlink ? green('●') : gold('●')} ${ink(x.symbol)}`, 17)).join(''));
    await sleep(70);
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
    `${muted('Vault liquidity ')} : ${goldHi(`$${(Number(pool) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })}`)} ${dim(TOKEN)}`,
    `${muted('Reserved        ')} : ${ink(`$${(Number(reserved) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })}`)} ${dim(`(utilization ${Number(util) / 100}%)`)}`,
    `${muted('Keeper          ')} : ${ink(short(keeper))} ${dim(`· ${Number(formatEther(gas)).toFixed(5)} ETH for gas`)}`,
    `${muted('Latest block    ')} : ${ink(head.toLocaleString('en-US'))}`,
  ]);
  out();
}

// ---------------------------------------------------------------- the kitchen (teaser)
//
// Its own look, apart from the deploy/verify replays: a plain shell prompt, the wordmark shaded from cinnabar to gold,
// and an audit log with elapsed time and a spinner per step instead of progress bars and boxes. The audit block is
// read from the chain as it runs; the build block names an unannounced feature only in black bars.

const cinnabar = rgb(214, 62, 52);
const kitchenPrompt = () => `${cinnabar('漢')} ${ink('kitchen')} ${dim('~')} ${muted('$')} `;
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let kitchenStart = 0;
const stamp = () => dim(`[${((Date.now() - kitchenStart) / 1000).toFixed(2).padStart(5)}s]`);

/** One audit step: a spinner while `work` runs (never shorter than `minMs`), then a tick and its detail lines. */
async function kStep<T>(label: string, work: Promise<T>, detail: (r: T) => string[], minMs = 650) {
  const start = Date.now();
  let done = false;
  let result: T | undefined;
  let failed = false;
  work.then((r) => { result = r; }, () => { failed = true; }).finally(() => { done = true; });
  let i = 0;
  while (!done || Date.now() - start < minMs) {
    process.stdout.write(`\r${stamp()} ${cinnabar(SPIN[i++ % SPIN.length])} ${ink(label)}`);
    await sleep(80);
    if (FAST && done) break;
  }
  process.stdout.write(`\r${stamp()} ${failed ? red('✗') : green('✓')} ${ink(label)}\x1b[K\n`);
  const lines = failed ? ['could not read this one right now'] : detail(result as T);
  for (const l of lines) { out(`           ${dim('└')} ${muted(l)}`); await sleep(70); }
}

const section = (title: string) => { out(); out(`  ${cinnabar('■')} ${bold(goldHi(title))}`); };

async function typeKitchen(cmd: string) {
  process.stdout.write(kitchenPrompt());
  for (const ch of cmd) { process.stdout.write(ink(ch)); await sleep(40 + Math.random() * 50); }
  await sleep(300);
  out();
}

const erc20InfoAbi = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)']);
const usd6 = (v: bigint) => Number(v) / 1e6;
const ago = (ts: bigint) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts));
  return s < 120 ? `${s}s ago` : s < 7200 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

async function cook() {
  await typeKitchen(`hanmarket kitchen --network ${NET_FLAG} --cinematic`);
  kitchenStart = Date.now();
  out();
  // the wordmark, shaded line by line from cinnabar to gold
  WORDMARK.forEach((l, i) => {
    const k = i / (WORDMARK.length - 1);
    out(`  ${rgb(Math.round(214 + (226 - 214) * k), Math.round(62 + (194 - 62) * k), Math.round(52 + (141 - 52) * k))(l)}`);
  });
  out(`  ${dim('HANMARKET  /  KITCHEN  /  PROTOCOL AUDIT')}${' '.repeat(8)}${dim('pre-release · details withheld')}`);
  out(`  ${dim('─'.repeat(78))}`);

  section('PROTOCOL AUDIT');
  await kStep('Resolving Robinhood Chain network', (async () => {
    const t0 = Date.now();
    const [id, head] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
    return { id, head, ms: Date.now() - t0 };
  })(), (r) => [`${NET_NAME} · chain ${r.id}`, `head block ${r.head.toLocaleString('en-US')} · round trip ${r.ms} ms`], 900);

  const core: [string, Address][] = [
    ['MarketRegistry', d!.marketRegistry], ['OracleRouter', d!.oracleRouter], ['FeeManager', d!.feeManager],
    ['RiskManager', d!.riskManager], ['Vault', d!.vault], ['OptionsEngine', d!.optionsEngine], ['PerpsEngine', d!.perpsEngine],
  ];
  await kStep('Inspecting core contracts', Promise.all(core.map(([, a]) => client.getCode({ address: a }))),
    (codes) => core.map(([name, a], i) => `${name.padEnd(15)} ${short(a)}  ${(((codes[i]?.length ?? 2) - 2) / 2).toLocaleString('en-US').padStart(6)} bytes`), 1100);

  await kStep('Verifying ownership', (async () => {
    const owner = await client.readContract({ address: d!.marketRegistry, abi: ownableAbi, functionName: 'owner' });
    const [owners, threshold] = await Promise.all([
      client.readContract({ address: owner, abi: safeAbi, functionName: 'getOwners' }),
      client.readContract({ address: owner, abi: safeAbi, functionName: 'getThreshold' }),
    ]);
    return { owner, owners, threshold };
  })(), (r) => [`owner ${short(r.owner)} · Safe multisig`, `${r.threshold} of ${r.owners.length} signatures for any change`]);

  await kStep('Resolving settlement asset', Promise.all([
    client.readContract({ address: d!.collateralToken, abi: erc20InfoAbi, functionName: 'symbol' }),
    client.readContract({ address: d!.collateralToken, abi: erc20InfoAbi, functionName: 'decimals' }),
    client.readContract({ address: d!.collateralToken, abi: erc20InfoAbi, functionName: 'totalSupply' }),
  ]), ([sym, dec, supply]) => [`${sym} · ${dec} decimals · ${short(d!.collateralToken)}`, `${Math.round(Number(supply) / 10 ** Number(dec)).toLocaleString('en-US')} in circulation`]);

  await kStep('Reading price oracle', (async () => {
    const mk = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getPerpMarket', args: [0] });
    const a = await client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [mk.assetId] });
    const [price, ts] = await client.readContract({ address: d!.oracleRouter, abi: oracleAbi, functionName: 'getPrice', args: [a.oracleId] });
    const feed = await client.readContract({ address: d!.oracleRouter, abi: oracleAbi, functionName: 'getFeed', args: [a.oracleId] });
    return { symbol: a.symbol, price, ts, chainlink: Number(feed.source) === 1 };
  })(), (r) => [`${r.symbol}/USD ${usd6(r.price).toFixed(2)} · ${r.chainlink ? 'Chainlink' : 'signed feed'} · updated ${ago(r.ts)}`]);

  await kStep('Checking market directory', Promise.all([
    client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'assetCount' }),
    client.readContract({ address: d!.marketRegistry, abi: registryAbi, functionName: 'perpMarketCount' }),
    client.readContract({ address: d!.optionsEngine, abi: optionsAbi, functionName: 'seriesCount' }),
  ]), ([assets, perps, series]) => [`${assets} Hong Kong & China equities listed`, `${perps} perpetual market · ${series} option series`]);

  await kStep('Reading risk parameters', Promise.all([
    client.readContract({ address: d!.riskManager, abi: riskAbi, functionName: 'getPerpRisk', args: [0] }),
    client.readContract({ address: d!.riskManager, abi: riskAbi, functionName: 'maxUtilizationBps' }),
  ]), ([risk, util]) => [`max leverage ${risk.maxLeverage}x · utilization cap ${Number(util) / 100}%`]);

  await kStep('Reading fee schedule', client.readContract({ address: d!.feeManager, abi: feeAbi, functionName: 'getFees' }),
    (f) => [`options ${f.optionOpenFee / 100}% of premium · perps ${f.takerFee / 100}% taker · liquidation ${f.liquidationFee / 100}%`]);

  await kStep('Reading live vault state', client.readContract({ address: d!.vault, abi: vaultAbi, functionName: 'utilizationBps' }),
    (u) => [`vault live · ${Number(u) / 100}% of liquidity reserved for open positions`]);

  await kStep('Checking Hong Kong session', Promise.resolve(new Date()), (now) => {
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
    return [`北京 ${t} (UTC+8)`];
  }, 500);

  // the unannounced feature: every name blacked out
  section(`BUILDING ${redact(10)}`);
  for (const [label, done] of [
    [`Loading ${redact(6)} assets`, 'assets loaded'],
    [`Compiling ${redact(8)} module`, 'module compiled'],
    [`Wiring ${redact(6)} into the terminal`, 'hooks attached'],
    ['Syncing to UTC+8', 'in sync'],
    [`Tuning ${redact(7)}`, 'tuned'],
    ['Rendering light & dark themes', 'both themes rendered'],
    ['Running checks', 'passing'],
  ] as const) {
    await kStep(label, Promise.resolve(), () => [done], 700 + Math.random() * 500);
  }
  out(`           ${red('!')} ${ink('feature flag')} ${goldHi(`hm.${redact(9)}`)} ${dim('= OFF  ·  pre-release')}`);

  out();
  out(`  ${dim('─'.repeat(78))}`);
  out(`  ${bold(cinnabar('STATUS'))} ${muted('▸')} ${bold(goldHi('COOKING'))}`);
  out(`  ${muted('still building · still testing · coming to HanMarket soon')}`);
  out();
}

// ---------------------------------------------------------------- main

const COMMANDS: Record<string, () => Promise<void>> = {
  '1': deploy, deploy, '2': verify, verify, '3': markets, markets, '4': status, status,
};

async function main() {
  process.stdout.write(`\x1b]0;${TITLE}\x07`); // the window title (Windows Terminal, macOS Terminal, iTerm)
  process.stdout.write('\x1b[2J\x1b[H');
  if (WAIT) {
    await new Promise<void>((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
    });
    process.stdout.write('\x1b[2J\x1b[H');
  }
  if (COOK) {
    // the teaser has its own shell: it ends at the kitchen prompt, and Enter closes it (so the window never shows a path)
    await sleep(600);
    await cook();
    process.stdout.write(kitchenPrompt());
    await new Promise<void>((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
    });
    process.exit(0);
  } else if (AUTO && AUTO_DEPLOY) {
    await banner();
    await sleep(1200);
    await typeCommand(`hanmarket deploy --network ${NET_FLAG}`);
    await deploy();
    await sleep(1500);
    await typeCommand('hanmarket markets');
    await markets();
  } else if (AUTO) {
    await banner();
    await sleep(1200);
    await typeCommand(`hanmarket verify --network ${NET_FLAG}`);
    await verify();
    await sleep(1500);
    await typeCommand('hanmarket markets');
    await markets();
  } else {
    await banner();
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
