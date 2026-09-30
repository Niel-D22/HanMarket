import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { parseDeployment } from '../../api/_lib/protocol/deployments';

export type NetworkKey = 'testnet' | 'mainnet';
export type NetworkType = NetworkKey;

interface NetworkContextState {
  network: NetworkKey;
  setNetwork: (network: NetworkKey) => void;
  apiUrl: string;
}

const STORAGE_KEY = 'hanperp-network';
/**
 * Until the mainnet contracts exist, a saved "mainnet" choice is not restored: every visit opens on testnet, where the
 * markets are, instead of on an empty mainnet terminal the visitor switched to once and forgot about.
 */
const MAINNET_LIVE = !!parseDeployment(import.meta.env.VITE_MAINNET_DEPLOYMENT as string | undefined);
const NetworkContext = createContext<NetworkContextState | undefined>(undefined);

function initialNetwork(): NetworkKey {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'testnet' || (saved === 'mainnet' && MAINNET_LIVE)) return saved;
  } catch {
    // storage unavailable (private mode): fall through to the default
  }
  return 'testnet';
}

export const NetworkProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [network, setNetwork] = useState<NetworkKey>(initialNetwork);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, network);
    } catch {
      // not persisted, which only means the choice resets on reload
    }
  }, [network]);

  return (
    <NetworkContext.Provider value={{ network, setNetwork, apiUrl: import.meta.env.VITE_API_URL || '/api' }}>
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = () => {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};
