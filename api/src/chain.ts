import { createPublicClient, createWalletClient, defineChain, http, type Chain } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { parseDeployment, type Deployment, type NetworkKey } from './protocol/deployments';

export type { NetworkKey } from './protocol/deployments';

// Robinhood Chain networks. Public RPCs from third parties are the default because some ISPs
// (e.g. Telkomsel "Internet Baik") block *.robinhood.com.

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_TESTNET_RPC || 'https://robinhood-sepolia-rpc.publicnode.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
});

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_MAINNET_RPC || 'https://robinhood.drpc.org'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.chain.robinhood.com' } },
});

export interface NetworkSetup {
  key: NetworkKey;
  chain: Chain;
  /** null until the protocol is deployed on this network */
  deployment: Deployment | null;
}

// Same JSON as the web app's VITE_*_DEPLOYMENT, printed by contracts/script/Deploy.s.sol
export const NETWORKS: Record<NetworkKey, NetworkSetup> = {
  testnet: {
    key: 'testnet',
    chain: robinhoodTestnet,
    deployment: parseDeployment(process.env.TESTNET_DEPLOYMENT || process.env.VITE_TESTNET_DEPLOYMENT),
  },
  mainnet: {
    key: 'mainnet',
    chain: robinhoodMainnet,
    deployment: parseDeployment(process.env.MAINNET_DEPLOYMENT || process.env.VITE_MAINNET_DEPLOYMENT),
  },
};

export const publicClientFor = (key: NetworkKey) =>
  createPublicClient({ chain: NETWORKS[key].chain, transport: http(undefined, { batch: true, retryCount: 3 }) });

export function accountFromEnv(name: string): PrivateKeyAccount | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  return privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`);
}

export const walletClientFor = (key: NetworkKey, account: PrivateKeyAccount) =>
  createWalletClient({ account, chain: NETWORKS[key].chain, transport: http(undefined, { retryCount: 3 }) });

/** Chainlink "Robinhood BABA / USD" on Robinhood Chain mainnet (docs.chain.link, verified onchain 2026-09-17). */
export const BABA_FEED_MAINNET = '0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984' as const;
