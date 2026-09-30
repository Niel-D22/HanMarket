import { defineChain } from 'viem';

// Robinhood Chain (Arbitrum Orbit L2, gas paid in ETH).
// RPCs default to third-party public endpoints: some Indonesian ISPs block *.robinhood.com,
// which would stop the terminal from loading for those visitors.

// Multicall3 at its canonical address, checked on both networks (eth_getCode returns the contract). Registering
// it lets viem fold many contract reads into one eth_call: the terminal reads every option series, and doing
// that one call at a time (200+ of them, every 30s) is enough to get a public RPC to answer 429.
const multicall3 = { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } as const;

// The public endpoints. They are also what a wallet is given when it adds the chain. The private RPC (Alchemy) is never
// in the browser: reads go through /api/rpc first (rpcProxyUrl), which holds its key server-side. Reads of events over a
// wide block range (History, Options Flow) use these public ones only; Alchemy caps eth_getLogs at 10 blocks per request.
export const PUBLIC_RPC = {
  testnet: ['https://robinhood-sepolia-rpc.publicnode.com', 'https://robinhood-testnet.drpc.org'],
  mainnet: ['https://robinhood-rpc.publicnode.com', 'https://robinhood.drpc.org'],
} as const;

/** This site's read-only RPC proxy (web/api/rpc.ts) for a network; absolute, since viem wants a full URL. */
export const rpcProxyUrl = (network: 'testnet' | 'mainnet') =>
  typeof window === 'undefined' ? null : `${window.location.origin}/api/rpc?network=${network}`;

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [...PUBLIC_RPC.testnet],
    },
  },
  blockExplorers: {
    default: { name: 'Robinhood Explorer', url: 'https://explorer.testnet.chain.robinhood.com' },
  },
  contracts: { multicall3 },
  testnet: true,
});

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [...PUBLIC_RPC.mainnet],
    },
  },
  blockExplorers: {
    default: { name: 'Robinhood Explorer', url: 'https://explorer.chain.robinhood.com' },
  },
  contracts: { multicall3 },
});

export type { NetworkKey } from '../contexts/NetworkContext';

export const CHAINS = { testnet: robinhoodTestnet, mainnet: robinhoodMainnet } as const;
