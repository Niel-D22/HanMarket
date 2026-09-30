import { useMemo, useState } from 'react';
import type { Address } from 'viem';
import { fmtCompact, fmtExpiry, fmtPrice, fmtUsd, type ProtocolState } from './protocol';
import { SHOWN, useOptionsFlow } from './flowData';

const ago = (t: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
};

export function OptionsFlow({ state, symbol, account, explorer, deployed }: {
  state?: ProtocolState;
  symbol: string;
  account?: Address;
  explorer?: string;
  deployed: boolean;
}) {
  const { data, error } = useOptionsFlow(state);
  const [scope, setScope] = useState<'all' | 'market'>('all');
  const rows = useMemo(() => (scope === 'market' ? data?.filter((t) => t.symbol === symbol) : data) ?? [], [data, scope, symbol]);

  // What the tape adds up to: how much premium moved, and which way it leaned
  const sum = useMemo(() => {
    const calls = rows.filter((t) => t.isCall).reduce((a, t) => a + t.notional, 0);
    const puts = rows.filter((t) => !t.isCall).reduce((a, t) => a + t.notional, 0);
    const total = calls + puts;
    return {
      total, calls, puts,
      callShare: total > 0 ? (calls / total) * 100 : 0,
      buys: rows.filter((t) => t.side === 'buy').length,
      sells: rows.filter((t) => t.side === 'sell').length,
    };
  }, [rows]);

  if (!deployed) return <div className="tm-empty"><b>Not deployed on this network yet</b>Option flow appears once the HanMarket contracts are live here.</div>;
  // not `isLoading`: the read waits on the market list and the series, and until it starts it is neither loading nor empty
  if (!data && !error) return <div className="tm-empty">Loading option flow…</div>;
  if (error) return <div className="tm-empty"><b>Option flow unavailable</b>{(error as Error).message.split('\n')[0]}</div>;

  return (
    <>
      <div className="tm-expiries">
        <span>Show:</span>
        <button type="button" className="tm-chip" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All markets</button>
        <button type="button" className="tm-chip" aria-pressed={scope === 'market'} onClick={() => setScope('market')}>{symbol} only</button>
        <span className="muted" style={{ marginLeft: 'auto' }}>Latest {SHOWN} option trades, straight from the OptionsEngine</span>
      </div>
      <div className="tm-flow-sum">
        <div className="tm-stat"><span>Premium traded</span><span>{fmtUsd(sum.total)}</span></div>
        <div className="tm-stat"><span>Calls</span><span className="up">{fmtCompact(sum.calls)} · {sum.callShare.toFixed(0)}%</span></div>
        <div className="tm-stat"><span>Puts</span><span className="down">{fmtCompact(sum.puts)} · {sum.total > 0 ? (100 - sum.callShare).toFixed(0) : 0}%</span></div>
        <div className="tm-stat"><span>Buys / Sells</span><span>{sum.buys} / {sum.sells}</span></div>
      </div>
      {!rows.length
        ? <div className="tm-empty"><b>No option trades yet{scope === 'market' ? ` on ${symbol}` : ''}</b>Buy or sell an option from the chain and it shows up here.</div>
        : (
          <table className="tm-table">
            <thead>
              <tr>
                <th className="l">Time</th><th className="l">Market</th><th className="l">Contract</th><th className="l">Side</th>
                <th>Contracts</th><th>Premium</th><th>Notional</th><th className="l">Trader</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.key}>
                  <td className="l dim" title={t.time ? new Date(t.time * 1000).toLocaleString() : undefined}>
                    {explorer
                      ? <a className="tm-link" href={`${explorer}/tx/${t.hash}`} target="_blank" rel="noreferrer">{t.time ? ago(t.time) : `#${t.block}`}</a>
                      : t.time ? ago(t.time) : `#${t.block}`}
                  </td>
                  <td className="l"><b>{t.symbol}</b></td>
                  <td className="l">
                    <span className={t.isCall ? 'up' : 'down'}>{+t.strike.toFixed(2)}{t.isCall ? 'C' : 'P'}</span>{' '}
                    <span className="muted">{fmtExpiry(t.expiry)}</span>
                  </td>
                  <td className={`l ${t.side === 'buy' ? 'up' : 'down'}`}>{t.side === 'buy' ? 'BUY' : 'SELL'}</td>
                  <td>{t.contracts}</td>
                  <td>{fmtPrice(t.premium)}</td>
                  <td>{fmtUsd(t.notional)}</td>
                  <td className="l muted">
                    {account && t.trader.toLowerCase() === account.toLowerCase()
                      ? <span className="gold">You</span>
                      : explorer
                        ? <a className="tm-link" style={{ color: 'inherit' }} href={`${explorer}/address/${t.trader}`} target="_blank" rel="noreferrer">{t.trader.slice(0, 6)}…{t.trader.slice(-4)}</a>
                        : `${t.trader.slice(0, 6)}…${t.trader.slice(-4)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </>
  );
}
