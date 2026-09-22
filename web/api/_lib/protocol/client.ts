import { createPublicClient, defineChain, http, type Chain, type PublicClient } from 'viem';
import { optionsAbi, registryAbi } from './abis.js';
import { parseDeployment, type Deployment, type NetworkKey } from './deployments.js';

// Server-side access to the protocol (serverless functions). The browser uses wagmi instead.

declare const process: { env: Record<string, string | undefined> };

const chains: Record<NetworkKey, Chain> = {
  testnet: defineChain({
    id: 46630,
    name: 'Robinhood Chain Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [process.env.ROBINHOOD_TESTNET_RPC || 'https://robinhood-sepolia-rpc.publicnode.com'] } },
    testnet: true,
  }),
  mainnet: defineChain({
    id: 4663,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [process.env.ROBINHOOD_MAINNET_RPC || 'https://robinhood.drpc.org'] } },
  }),
};

export const chainFor = (network: NetworkKey) => chains[network];

export function deploymentFor(network: NetworkKey): Deployment | null {
  return parseDeployment(network === 'testnet' ? process.env.VITE_TESTNET_DEPLOYMENT : process.env.VITE_MAINNET_DEPLOYMENT);
}

const clients = new Map<NetworkKey, PublicClient>();
export function clientFor(network: NetworkKey): PublicClient {
  let c = clients.get(network);
  if (!c) {
    c = createPublicClient({ chain: chains[network], transport: http(undefined, { batch: true, retryCount: 2 }) }) as PublicClient;
    clients.set(network, c);
  }
  return c;
}

export const parseNetwork = (v: unknown): NetworkKey | null => (v === 'testnet' || v === 'mainnet' ? v : null);

export interface SeriesRow {
  id: number;
  assetId: number;
  symbol: string;
  isCall: boolean;
  settled: boolean;
  expiry: number;
  strike: number; // USD
  cap: number; // USD
  open: number; // contracts
}

export interface AssetRow {
  id: number;
  symbol: string;
  oracleId: `0x${string}`;
  optionsEnabled: boolean;
  perpsEnabled: boolean;
  active: boolean;
}

type Snapshot = { at: number; assets: AssetRow[]; series: SeriesRow[] };
const snapshots = new Map<NetworkKey, Snapshot>();

/** Every asset and option series on a network, cached for 15 seconds per function instance. */
export async function loadProtocol(network: NetworkKey, d: Deployment): Promise<Snapshot> {
  const hit = snapshots.get(network);
  if (hit && Date.now() - hit.at < 15_000) return hit;
  const client = clientFor(network);

  const assetCount = Number(await client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'assetCount' }));
  const assets = (await Promise.all(
    Array.from({ length: assetCount }, (_, i) =>
      client.readContract({ address: d.marketRegistry, abi: registryAbi, functionName: 'getAsset', args: [i] }),
    ),
  )).map((a, i): AssetRow => ({ id: i, symbol: a.symbol, oracleId: a.oracleId, optionsEnabled: a.optionsEnabled, perpsEnabled: a.perpsEnabled, active: a.active }));

  const seriesCount = Number(await client.readContract({ address: d.optionsEngine, abi: optionsAbi, functionName: 'seriesCount' }));
  const raw = await Promise.all(
    Array.from({ length: seriesCount }, (_, i) =>
      client.readContract({ address: d.optionsEngine, abi: optionsAbi, functionName: 'getSeries', args: [BigInt(i)] }),
    ),
  );
  const series = raw.map((s, i): SeriesRow => ({
    id: i,
    assetId: s.assetId,
    symbol: assets[s.assetId]?.symbol ?? '?',
    isCall: s.isCall,
    settled: s.settled,
    expiry: Number(s.expiry),
    strike: Number(s.strike) / 1e6,
    cap: Number(s.cap) / 1e6,
    open: Number(s.open) / 1e6,
  }));

  const snap = { at: Date.now(), assets, series };
  snapshots.set(network, snap);
  return snap;
}
