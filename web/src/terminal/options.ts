import { useQuery } from '@tanstack/react-query';
import { useNetwork } from '../contexts/NetworkContext';

// The option chain and signed quotes come from the pricing service (web/api/options/*).

export interface ChainSide {
  seriesId: number;
  bid: number;
  ask: number;
  price: number; // model mid
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  cap: number;
  open: number;
}

export interface ChainRow {
  strike: number;
  call?: ChainSide;
  put?: ChainSide;
}

export interface OptionChain {
  deployed: boolean;
  symbol?: string;
  spot?: number;
  iv?: number;
  sessionOpen?: boolean;
  expiries: { expiry: number; rows: ChainRow[] }[];
}

export function useOptionChain(symbol: string | undefined) {
  const { network, apiUrl } = useNetwork();
  return useQuery({
    queryKey: ['hm-chain', network, symbol],
    enabled: !!symbol,
    refetchInterval: 15_000,
    queryFn: async (): Promise<OptionChain> => {
      const res = await fetch(`${apiUrl}/options/chain?network=${network}&symbol=${encodeURIComponent(symbol!)}`);
      const json = await res.json().catch(() => null);
      if (!json) throw new Error('The pricing service is not reachable right now. Try again in a moment.');
      if (!json.success) throw new Error(json.error ?? 'Option chain unavailable');
      return json.data;
    },
  });
}

export interface SignedQuote {
  quote: { seriesId: string; isBuy: boolean; premium: string; maxQty: string; deadline: string };
  signature: `0x${string}`;
  premium: number;
  mark: number;
  total: number;
  iv: number;
  greeks: { delta: number; gamma: number; theta: number; vega: number };
  breakEven: number;
  maxLoss?: number;
  maxProfit?: number;
  spot: number;
  sessionOpen: boolean;
}

export async function fetchQuote(apiUrl: string, network: string, seriesId: number, side: 'buy' | 'sell', contracts: number): Promise<SignedQuote> {
  const res = await fetch(`${apiUrl}/options/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ network, seriesId, side, contracts }),
  });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error('The pricing service is not reachable right now. Try again in a moment.');
  if (!json.success) throw new Error(json.error ?? 'No quote available');
  return json.data;
}

/** The selected contract in the chain, which the order ticket trades. */
export interface SelectedOption {
  seriesId: number;
  symbol: string;
  isCall: boolean;
  strike: number;
  expiry: number;
  cap: number;
  side: 'buy' | 'sell';
  bid: number;
  ask: number;
  iv: number;
  delta: number;
}
