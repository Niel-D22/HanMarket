import { findAsset } from './assets.js';
import { getQuotes } from './prices.js';
import { bidAsk, cappedOption, realisedVol, yearsTo, type Greeks } from './pricing.js';
import { isSessionOpen } from './protocol/sessions.js';
import type { SeriesRow } from './protocol/client.js';

// Prices one option series the same way for the chain table and for a signed quote.

/** trading on a series stops this long before expiry (OptionsEngine.tradingCutoff) */
export const TRADING_CUTOFF = 30 * 60;

export interface PricedSeries extends Greeks {
  seriesId: number;
  bid: number;
  ask: number;
  iv: number;
  cap: number;
  open: number;
}

export interface UnderlyingInfo {
  symbol: string;
  spot: number; // USD
  vol: number;
  sessionOpen: boolean;
}

export async function underlying(symbol: string): Promise<UnderlyingInfo | null> {
  const asset = findAsset(symbol);
  if (!asset) return null;
  const [{ quotes }, vol] = await Promise.all([getQuotes(), realisedVol(asset.yahoo)]);
  const spot = quotes[asset.symbol]?.priceUsd;
  if (!spot) return null;
  return { symbol: asset.symbol, spot, vol, sessionOpen: isSessionOpen(asset.board) && !quotes[asset.symbol]?.halted };
}

export function priceSeries(s: SeriesRow, u: UnderlyingInfo, now = Date.now() / 1000): PricedSeries {
  const g = cappedOption(s.isCall, u.spot, s.strike, s.cap, yearsTo(s.expiry, now), u.vol);
  const { bid, ask } = bidAsk(g.price, s.cap, u.sessionOpen);
  return { seriesId: s.id, ...g, bid, ask, iv: u.vol, cap: s.cap, open: s.open };
}

export const isTradable = (s: SeriesRow, now = Date.now() / 1000) => !s.settled && now + TRADING_CUTOFF < s.expiry;
