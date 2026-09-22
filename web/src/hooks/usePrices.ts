import { useEffect, useState } from 'react';
import { useNetwork } from '../contexts/NetworkContext';

export interface Quote {
  symbol: string;
  price: number;       // asset's own currency (HKD / USD)
  priceUsd: number;    // strikes and settlement are in USD(C)
  currency: 'HKD' | 'USD';
  change24h: number;
  source: 'robinhood' | 'pyth' | 'yahoo';
  /** Robinhood reports the underlying equity as halted */
  halted?: boolean;
  publishTime: number;
}

// One poller shared by every component that asks for prices, so the terminal makes a single request
// every few seconds no matter how many panels are mounted.
type Listener = (q: Record<string, Quote>) => void;
const listeners = new Set<Listener>();
let latest: Record<string, Quote> = {};
let timer: ReturnType<typeof setInterval> | null = null;
let currentApi = '';

async function poll() {
  try {
    const res = await fetch(`${currentApi}/prices`);
    const json = await res.json();
    if (json.success) {
      latest = json.data;
      listeners.forEach((l) => l(latest));
    }
  } catch (e) {
    console.warn('Price feed unavailable', e);
  }
}

export function usePrices(intervalMs = 5000) {
  const { apiUrl } = useNetwork();
  const [quotes, setQuotes] = useState<Record<string, Quote>>(latest);

  useEffect(() => {
    listeners.add(setQuotes);
    if (currentApi !== apiUrl || !timer) {
      currentApi = apiUrl;
      if (timer) clearInterval(timer);
      poll();
      timer = setInterval(poll, intervalMs);
    }
    return () => {
      listeners.delete(setQuotes);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [apiUrl, intervalMs]);

  return quotes;
}
