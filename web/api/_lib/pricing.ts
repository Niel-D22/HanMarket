// Option pricing for quotes: Black-Scholes on a flat volatility per underlying.
//
// Every HanMarket option has a cap (the most one contract pays), so it is a spread, not a vanilla option:
//   capped call = C(K) - C(K + cap)        capped put = P(K) - P(K - cap)
// Price and greeks are the differences of the two legs. Volatility is the underlying's 90-day realised
// volatility from daily closes, clamped to a sane band. These numbers only set quotes; they never decide
// settlement, which always comes from the oracle.

declare const process: { env: Record<string, string | undefined> };

const YEAR = 365 * 86_400;
export const RISK_FREE = 0.04;
const VOL_MIN = 0.2;
const VOL_MAX = 1.5;
const VOL_DEFAULT = 0.45;

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number; // per day
  vega: number; // per 1 vol point (0.01)
}

// Abramowitz-Stegun normal CDF, accurate to ~1e-7
function cdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
const pdf = (x: number) => 0.3989422804014327 * Math.exp((-x * x) / 2);

/** Vanilla European option. `t` in years. */
export function blackScholes(isCall: boolean, spot: number, strike: number, t: number, vol: number, r = RISK_FREE): Greeks {
  if (strike <= 0) {
    // a zero-strike call is the share itself; a zero-strike put is worthless
    return isCall ? { price: spot, delta: 1, gamma: 0, theta: 0, vega: 0 } : { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };
  }
  if (t <= 0 || vol <= 0) {
    const intrinsic = isCall ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
    const itm = isCall ? spot > strike : spot < strike;
    return { price: intrinsic, delta: itm ? (isCall ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const sq = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (r + (vol * vol) / 2) * t) / (vol * sq);
  const d2 = d1 - vol * sq;
  const disc = Math.exp(-r * t);
  const price = isCall ? spot * cdf(d1) - strike * disc * cdf(d2) : strike * disc * cdf(-d2) - spot * cdf(-d1);
  const delta = isCall ? cdf(d1) : cdf(d1) - 1;
  const gamma = pdf(d1) / (spot * vol * sq);
  const thetaYear = isCall
    ? (-spot * pdf(d1) * vol) / (2 * sq) - r * strike * disc * cdf(d2)
    : (-spot * pdf(d1) * vol) / (2 * sq) + r * strike * disc * cdf(-d2);
  const vega = (spot * pdf(d1) * sq) / 100;
  return { price, delta, gamma, theta: thetaYear / 365, vega };
}

/** A HanMarket option: payout min(intrinsic, cap). */
export function cappedOption(isCall: boolean, spot: number, strike: number, cap: number, t: number, vol: number): Greeks {
  const long = blackScholes(isCall, spot, strike, t, vol);
  const shortStrike = isCall ? strike + cap : strike - cap;
  const short = blackScholes(isCall, spot, shortStrike, t, vol);
  const price = Math.min(Math.max(long.price - short.price, 0), cap);
  return {
    price,
    delta: long.delta - short.delta,
    gamma: long.gamma - short.gamma,
    theta: long.theta - short.theta,
    vega: long.vega - short.vega,
  };
}

export const yearsTo = (expiry: number, now = Date.now() / 1000) => Math.max(expiry - now, 0) / YEAR;

// ---------------------------------------------------------------- volatility

const volCache = new Map<string, { at: number; vol: number }>();

/** 90-day realised volatility of a Yahoo ticker, annualised, cached for 6 hours. */
export async function realisedVol(yahooTicker: string): Promise<number> {
  const hit = volCache.get(yahooTicker);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.vol;
  let vol = VOL_DEFAULT;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=6mo`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) },
    );
    const json = await res.json();
    const closes: number[] = (json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((c: number | null) => c != null);
    const recent = closes.slice(-91);
    if (recent.length > 20) {
      const rets = recent.slice(1).map((c, i) => Math.log(c / recent[i]));
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
      vol = Math.sqrt(variance * 252);
    }
  } catch {
    // keep the default
  }
  vol = Math.min(Math.max(vol, VOL_MIN), VOL_MAX);
  volCache.set(yahooTicker, { at: Date.now(), vol });
  return vol;
}

// ---------------------------------------------------------------- bid / ask

/** Half-spread as a share of the mid; wider while the underlying exchange is closed and its price is stale. */
export function spreadFraction(sessionOpen: boolean): number {
  const base = Number(process.env.OPTION_SPREAD_BPS || 300) / 10_000;
  return sessionOpen ? base : base * 2.5;
}

const TICK = 0.01;

/** Bid/ask around the model price. A bid below one tick means the vault does not buy that option back. */
export function bidAsk(mid: number, cap: number, sessionOpen: boolean): { bid: number; ask: number } {
  const half = Math.max(mid * spreadFraction(sessionOpen), TICK);
  const ask = Math.min(Math.max(Math.ceil((mid + half) / TICK) * TICK, TICK), cap);
  const rawBid = Math.floor((mid - half) / TICK) * TICK;
  const bid = rawBid >= TICK ? Math.min(rawBid, ask - TICK) : 0;
  return { bid: +bid.toFixed(2), ask: +ask.toFixed(2) };
}
