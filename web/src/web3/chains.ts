import { defineChain } from 'viem';

// Robinhood Chain (Arbitrum Orbit L2, gas paid in ETH).
// RPCs default to third-party public endpoints: some Indonesian ISPs block *.robinhood.com,
// which would stop the terminal from loading for those visitors.

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_TESTNET_RPC_URL || 'https://robinhood-sepolia-rpc.publicnode.com', 'https://robinhood-testnet.drpc.org'],
    },
  },
  blockExplorers: {
    default: { name: 'Robinhood Explorer', url: 'https://explorer.testnet.chain.robinhood.com' },
  },
  testnet: true,
});

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_MAINNET_RPC_URL || 'https://robinhood-rpc.publicnode.com', 'https://robinhood.drpc.org'],
    },
  },
  blockExplorers: {
    default: { name: 'Robinhood Explorer', url: 'https://explorer.chain.robinhood.com' },
  },
});

export type { NetworkKey } from '../contexts/NetworkContext';

export const CHAINS = { testnet: robinhoodTestnet, mainnet: robinhoodMainnet } as const;
