import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type NetworkKey = 'testnet' | 'mainnet';
export type NetworkType = NetworkKey;

interface NetworkContextState {
  network: NetworkKey;
  setNetwork: (network: NetworkKey) => void;
  apiUrl: string;
}

const STORAGE_KEY = 'hanperp-network';
const NetworkContext = createContext<NetworkContextState | undefined>(undefined);

function initialNetwork(): NetworkKey {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'mainnet' || saved === 'testnet') return saved;
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
