import { useEffect, useMemo, useState } from 'react';
import { ASSETS } from '../data/assets';
import { useOptionChain, type ChainSide, type SelectedOption } from './options';
import { fmtExpiry, fmtPrice, fmtUsd, type Fees } from './protocol';

// Strategy builder: combine options on one underlying and see the payoff at expiry, the cost, the break-evens and the
// combined greeks before trading. Every leg is bought: the vault is the only option writer on HanMarket, so a strategy
// that needs selling an option you do not hold (a spread, a condor) cannot be traded here. Each HanMarket option is
// already capped, which is what a spread does, and the payoff below includes that cap.

type StrategyId = 'long-call' | 'long-put' | 'straddle' | 'strangle';
const STRATEGIES: { id: StrategyId; name: string; text: string }[] = [
  { id: 'long-call', name: 'Long call', text: 'Buy a call. Profits if the price rises above the strike plus the premium, up to the cap.' },
  { id: 'long-put', name: 'Long put', text: 'Buy a put. Profits if the price falls below the strike minus the premium, up to the cap.' },
  { id: 'straddle', name: 'Straddle', text: 'Buy a call and a put at one strike. Profits from a big move either way.' },
  { id: 'strangle', name: 'Strangle', text: 'Buy an out-of-the-money put and call. Cheaper than a straddle, needs a bigger move.' },
];

interface Leg { isCall: boolean; strike: number; side: ChainSide }

/** One leg's payout per contract at expiry price `s`, capped as the contract caps it. */
const legPayout = (l: Leg, s: number) => Math.min(Math.max(l.isCall ? s - l.strike : l.strike - s, 0), l.side.cap);

export function StrategiesView({ symbol, fees, onTradeLeg }: {
  symbol: string;
  fees?: Fees;
  onTradeLeg: (o: SelectedOption) => void;
}) {
  const [underlying, setUnderlying] = useState(symbol);
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [strategy, setStrategy] = useState<StrategyId>('straddle');
  const [units, setUnits] = useState(1);
  const [strike, setStrike] = useState<number | null>(null);
  const [putStrike, setPutStrike] = useState<number | null>(null);
  const [callStrike, setCallStrike] = useState<number | null>(null);
  const { data, isLoading, error } = useOptionChain(underlying);

  const exp = data?.expiries[Math.min(expiryIdx, (data?.expiries.length ?? 1) - 1)];
  const spot = data?.spot ?? 0;
  const strikes = useMemo(() => exp?.rows.map((r) => r.strike) ?? [], [exp]);
  const atm = strikes.length ? strikes.reduce((b, k) => (Math.abs(k - spot) < Math.abs(b - spot) ? k : b), strikes[0]) : 0;

  // new chain: start from the at-the-money strike and the nearest out-of-the-money pair
  useEffect(() => {
    if (!strikes.length) return;
    setStrike(atm);
    setPutStrike([...strikes].reverse().find((k) => k < spot) ?? strikes[0]);
    setCallStrike(strikes.find((k) => k > spot) ?? strikes[strikes.length - 1]);
  }, [strikes, atm, spot]);

  const row = (k: number | null) => exp?.rows.find((r) => r.strike === k);
  const legs: Leg[] = [];
  const add = (isCall: boolean, k: number | null) => {
    const side = isCall ? row(k)?.call : row(k)?.put;
    if (k !== null && side) legs.push({ isCall, strike: k, side });
  };
  if (strategy === 'long-call' || strategy === 'straddle') add(true, strike);
  if (strategy === 'long-put' || strategy === 'straddle') add(false, strike);
  if (strategy === 'strangle') { add(false, putStrike); add(true, callStrike); }
  const expected = strategy === 'straddle' || strategy === 'strangle' ? 2 : 1;
  const complete = legs.length === expected && legs.every((l) => l.side.ask > 0);

  const feeRate = (fees?.optionOpenFee ?? 0) / 10_000;
  const premium = legs.reduce((a, l) => a + l.side.ask, 0) * units;
  const cost = premium * (1 + feeRate);
  const payoff = (s: number) => legs.reduce((a, l) => a + legPayout(l, s), 0) * units - cost;

  // the payoff is piecewise linear, bending only at each strike and where each cap starts to bind
  const kinks = legs.flatMap((l) => [l.strike, l.isCall ? l.strike + l.side.cap : l.strike - l.side.cap]).filter((k) => k >= 0);
  const lo = Math.max(0, Math.min(spot, ...kinks) * 0.8);
  const hi = Math.max(spot, ...kinks) * 1.2;
  const probes = [...new Set([lo, hi, 0, ...kinks])].sort((a, b) => a - b);
  const values = probes.map(payoff);
  const maxProfit = Math.max(...values);
  const maxLoss = -Math.min(...values);
  const breakEvens: number[] = [];
  for (let i = 1; i < probes.length; i++) {
    const [a, b, fa, fb] = [probes[i - 1], probes[i], values[i - 1], values[i]];
    if ((fa < 0 && fb >= 0) || (fa >= 0 && fb < 0)) breakEvens.push(a + ((0 - fa) * (b - a)) / (fb - fa));
  }
  const greeks = legs.reduce((g, l) => ({
    delta: g.delta + l.side.delta * units, gamma: g.gamma + l.side.gamma * units,
    theta: g.theta + l.side.theta * units, vega: g.vega + l.side.vega * units,
  }), { delta: 0, gamma: 0, theta: 0, vega: 0 });

  const select = (label: string, value: number | null, set: (n: number) => void) => (
    <label className="tm-field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => set(Number(e.target.value))}>
        {strikes.map((k) => <option key={k} value={k}>{+k.toFixed(4)}{k === atm ? ' (ATM)' : ''}</option>)}
      </select>
    </label>
  );

  return (
    <div className="tm-view">
      <div>
        <h1>Strategies</h1>
        <p>Build a position from several options and see its payoff at expiry, cost and break-even before you trade.</p>
      </div>
      <div className="tm-panel" style={{ padding: 16 }}>
        <div className="tm-fields">
          <label className="tm-field">
            <span>Underlying</span>
            <select value={underlying} onChange={(e) => { setUnderlying(e.target.value); setExpiryIdx(0); }}>
              {ASSETS.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol} · {a.name}</option>)}
            </select>
          </label>
          <label className="tm-field">
            <span>Expiry</span>
            <select value={expiryIdx} onChange={(e) => setExpiryIdx(Number(e.target.value))} disabled={!data?.expiries.length}>
              {data?.expiries.map((e, i) => <option key={e.expiry} value={i}>{fmtExpiry(e.expiry)}</option>)}
            </select>
          </label>
          <label className="tm-field">
            <span>Strategy</span>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as StrategyId)}>
              {STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="tm-field">
            <span>Units</span>
            <input type="number" min={1} step={1} value={units} onChange={(e) => setUnits(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          </label>
          {strategy === 'strangle'
            ? <>{select('Put strike', putStrike, setPutStrike)}{select('Call strike', callStrike, setCallStrike)}</>
            : select('Strike', strike, setStrike)}
        </div>
        <p className="tm-note">{STRATEGIES.find((s) => s.id === strategy)?.text}</p>

        {isLoading && <div className="tm-empty">Loading option chain…</div>}
        {error && <div className="tm-empty"><b>Option chain unavailable</b>{(error as Error).message}</div>}
        {data && !data.expiries.length && <div className="tm-empty"><b>No open series for {underlying}</b>New weekly expiries are listed by the keeper.</div>}
        {exp && !complete && <div className="tm-empty"><b>No price for every leg right now</b>Pick another strike or expiry.</div>}

        {exp && complete && (
          <>
            <div className="tm-kpis" style={{ marginTop: 14 }}>
              <div className="tm-kpi"><span>Net premium (incl. fee)</span><b>{fmtUsd(cost)}</b></div>
              <div className="tm-kpi"><span>Max profit</span><b className="up">{fmtUsd(maxProfit)}</b></div>
              <div className="tm-kpi"><span>Max loss</span><b className="down">{fmtUsd(maxLoss)}</b></div>
              <div className="tm-kpi"><span>Break-even</span><b>{breakEvens.length ? breakEvens.map((b) => fmtPrice(b)).join(' · ') : '—'}</b></div>
            </div>
            <PayoffChart payoff={payoff} lo={lo} hi={hi} spot={spot} breakEvens={breakEvens} />
            <table className="tm-table" style={{ marginTop: 10 }}>
              <thead><tr><th className="l">Leg</th><th>Strike</th><th>Cap</th><th>Units</th><th>Ask</th><th>IV</th><th>Delta</th><th /></tr></thead>
              <tbody>
                {legs.map((l) => (
                  <tr key={`${l.isCall}-${l.strike}`}>
                    <td className="l"><span className="up">Buy</span> {l.isCall ? 'call' : 'put'}</td>
                    <td>{fmtPrice(l.strike)}</td>
                    <td>{fmtUsd(l.side.cap)}</td>
                    <td>{units}</td>
                    <td>{fmtUsd(l.side.ask)}</td>
                    <td>{(l.side.iv * 100).toFixed(1)}%</td>
                    <td>{l.side.delta.toFixed(2)}</td>
                    <td>
                      <button
                        type="button"
                        className="tm-mini"
                        onClick={() => onTradeLeg({
                          seriesId: l.side.seriesId, symbol: underlying, isCall: l.isCall, strike: l.strike, expiry: exp.expiry,
                          cap: l.side.cap, side: 'buy', bid: l.side.bid, ask: l.side.ask, iv: l.side.iv, delta: l.side.delta,
                        })}
                      >
                        Trade leg
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tm-kpis" style={{ marginTop: 12 }}>
              <div className="tm-kpi"><span>Delta</span><b>{greeks.delta.toFixed(2)}</b></div>
              <div className="tm-kpi"><span>Gamma</span><b>{greeks.gamma.toFixed(4)}</b></div>
              <div className="tm-kpi"><span>Theta / day</span><b>{greeks.theta.toFixed(3)}</b></div>
              <div className="tm-kpi"><span>Vega / vol pt</span><b>{greeks.vega.toFixed(3)}</b></div>
            </div>
            <p className="tm-note">
              At {fmtPrice(spot)} today the strategy would return <span className={payoff(spot) >= 0 ? 'up' : 'down'}>{fmtUsd(payoff(spot))}</span> if it
              expired now. Each leg opens separately from the option ticket (“Trade leg”), at a fresh signed quote. Only bought legs are
              shown: the vault is the only option writer, so a strategy that sells an option you do not hold cannot be traded here.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function PayoffChart({ payoff, lo, hi, spot, breakEvens }: { payoff: (s: number) => number; lo: number; hi: number; spot: number; breakEvens: number[] }) {
  const W = 760, H = 240, P = 28;
  const N = 160;
  const pts = Array.from({ length: N + 1 }, (_, i) => { const s = lo + ((hi - lo) * i) / N; return [s, payoff(s)] as const; });
  const ys = pts.map((p) => p[1]);
  const yMax = Math.max(...ys, 0), yMin = Math.min(...ys, 0);
  const pad = (yMax - yMin) * 0.1 || 1;
  const x = (s: number) => P + ((s - lo) / (hi - lo || 1)) * (W - 2 * P);
  const y = (v: number) => P + ((yMax + pad - v) / (yMax - yMin + 2 * pad)) * (H - 2 * P);
  const line = pts.map(([s, v], i) => `${i ? 'L' : 'M'}${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(hi).toFixed(1)},${y(0).toFixed(1)} L${x(lo).toFixed(1)},${y(0).toFixed(1)} Z`;
  return (
    <svg className="tm-payoff" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Payoff at expiry" preserveAspectRatio="none">
      <defs>
        <clipPath id="tm-pay-up"><rect x="0" y="0" width={W} height={y(0)} /></clipPath>
        <clipPath id="tm-pay-down"><rect x="0" y={y(0)} width={W} height={H - y(0)} /></clipPath>
      </defs>
      <path d={area} className="up-fill" clipPath="url(#tm-pay-up)" />
      <path d={area} className="down-fill" clipPath="url(#tm-pay-down)" />
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} className="axis" />
      <path d={line} className="curve" />
      <line x1={x(spot)} x2={x(spot)} y1={P / 2} y2={H - P / 2} className="spot" />
      <text x={x(spot) + 4} y={P / 2 + 10} className="label">now {fmtPrice(spot)}</text>
      {breakEvens.map((b) => <circle key={b} cx={x(b)} cy={y(0)} r={3.5} className="be" />)}
      <text x={P} y={H - 6} className="label">{fmtPrice(lo)}</text>
      <text x={W - P} y={H - 6} className="label" textAnchor="end">{fmtPrice(hi)}</text>
    </svg>
  );
}
