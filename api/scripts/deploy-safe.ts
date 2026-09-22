// Deploys a Safe (multisig) via SafeProxyFactory, without relying on app.safe.global's web UI — useful on
// chains it may not have onboarded yet, since our project already has Foundry/viem scripting for every
// other deployment step. Confirmed by checking bytecode directly on Robinhood Chain testnet (46630) and
// mainnet (4663) before trusting these addresses: contracts really are live at all three.
//
//   npm run deploy:safe -- --network testnet --owners 0xA,0xB,0xC --threshold 2 [--dry-run]
//
// Addresses are Safe v1.4.1's canonical deployment (github.com/safe-global/safe-deployments), the same
// on nearly every EVM chain because they are deployed through a deterministic factory.
import 'dotenv/config';
import { encodeFunctionData, decodeEventLog, getAddress, isAddress, type Address } from 'viem';
import { accountFromEnv, publicClientFor, walletClientFor, type NetworkKey } from '../src/chain';

const SAFE_L2_SINGLETON: Address = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762';
const SAFE_PROXY_FACTORY: Address = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67';
const COMPATIBILITY_FALLBACK_HANDLER: Address = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99';

const safeSetupAbi = [{
  type: 'function', name: 'setup', stateMutability: 'nonpayable',
  inputs: [
    { name: '_owners', type: 'address[]' }, { name: '_threshold', type: 'uint256' },
    { name: 'to', type: 'address' }, { name: 'data', type: 'bytes' },
    { name: 'fallbackHandler', type: 'address' }, { name: 'paymentToken', type: 'address' },
    { name: 'payment', type: 'uint256' }, { name: 'paymentReceiver', type: 'address' },
  ], outputs: [],
}] as const;

const proxyFactoryAbi = [
  {
    type: 'function', name: 'createProxyWithNonce', stateMutability: 'nonpayable',
    inputs: [{ name: '_singleton', type: 'address' }, { name: 'initializer', type: 'bytes' }, { name: 'saltNonce', type: 'uint256' }],
    outputs: [{ name: 'proxy', type: 'address' }],
  },
  {
    type: 'event', name: 'ProxyCreation',
    inputs: [{ name: 'proxy', type: 'address', indexed: true }, { name: 'singleton', type: 'address', indexed: false }],
  },
] as const;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const network = (arg('network') ?? 'testnet') as NetworkKey;
  const ownersArg = arg('owners');
  const threshold = Number(arg('threshold') ?? '2');
  const dryRun = process.argv.includes('--dry-run');
  if (!ownersArg) throw new Error('--owners 0xA,0xB,0xC is required');
  const owners = ownersArg.split(',').map((s) => s.trim());
  for (const o of owners) if (!isAddress(o)) throw new Error(`not an address: ${o}`);
  if (threshold < 1 || threshold > owners.length) throw new Error(`threshold must be between 1 and ${owners.length}`);

  const client = publicClientFor(network);
  for (const [label, addr] of [['SafeL2 singleton', SAFE_L2_SINGLETON], ['SafeProxyFactory', SAFE_PROXY_FACTORY], ['CompatibilityFallbackHandler', COMPATIBILITY_FALLBACK_HANDLER]] as const) {
    const code = await client.getBytecode({ address: addr });
    if (!code || code === '0x') throw new Error(`${label} has no bytecode at ${addr} on ${network} — refusing to deploy against a chain where Safe was not actually confirmed live`);
  }
  console.log(`Safe contracts confirmed live on ${network}. Owners (${threshold}-of-${owners.length}):`);
  owners.forEach((o) => console.log(`  ${getAddress(o)}`));

  const initializer = encodeFunctionData({
    abi: safeSetupAbi, functionName: 'setup',
    // .map(getAddress) is a classic array.map footgun: map passes (value, index, array), and if the
    // callback accepts a second argument, the index leaks in — same shape as `["1","2"].map(parseInt)`.
    // Wrapping it keeps only the address.
    args: [owners.map((o) => getAddress(o)), BigInt(threshold), '0x0000000000000000000000000000000000000000', '0x', COMPATIBILITY_FALLBACK_HANDLER, '0x0000000000000000000000000000000000000000', 0n, '0x0000000000000000000000000000000000000000'],
  });
  const saltNonce = BigInt(Date.now());

  if (dryRun) {
    console.log('dry run: would call SafeProxyFactory.createProxyWithNonce(...)');
    return;
  }

  const deployer = accountFromEnv('KEEPER_PRIVATE_KEY') ?? accountFromEnv('OWNER_PRIVATE_KEY');
  if (!deployer) throw new Error('KEEPER_PRIVATE_KEY or OWNER_PRIVATE_KEY must be set to pay the deploy gas (it is not an owner of the Safe unless you also listed it in --owners)');
  const wallet = walletClientFor(network, deployer);

  const hash = await wallet.writeContract({
    address: SAFE_PROXY_FACTORY, abi: proxyFactoryAbi, functionName: 'createProxyWithNonce',
    args: [SAFE_L2_SINGLETON, initializer, saltNonce],
  });
  console.log(`tx: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('deployment reverted');

  const created = receipt.logs
    .map((l) => { try { return decodeEventLog({ abi: proxyFactoryAbi, ...l }); } catch { return null; } })
    .find((e) => e?.eventName === 'ProxyCreation');
  const safeAddress = (created?.args as { proxy?: Address } | undefined)?.proxy;
  console.log(`Safe deployed: ${safeAddress ?? '(address not decoded — check the receipt logs manually)'}`);
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
