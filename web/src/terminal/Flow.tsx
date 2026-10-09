import { useMemo, useState } from 'react';
import type { Address } from 'viem';
import { fmtCompact, fmtExpiry, fmtPrice, fmtUsd, type ProtocolState } from './protocol';
import { SHOWN, useOptionsFlow } from './flowData';
import { useI18n, type MsgKey, type Vars } from '../i18n';

const ago = (time: number, t: (key: MsgKey, vars?: Vars) => string) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - time));
  if (s < 60) return t('tm.agoS', { n: s });
  if (s < 3600) return t('tm.agoM', { n: Math.floor(s / 60) });
  if (s < 86_400) return t('tm.agoH', { n: Math.floor(s / 3600) });
  return t('tm.agoD', { n: Math.floor(s / 86_400) });
};

export function OptionsFlow({ state, symbol, account, explorer, deployed }: {
  state?: ProtocolState;
  symbol: string;
  account?: Address;
  explorer?: string;
  deployed: boolean;
}) {
  const { t, lang } = useI18n();
  const { data, error } = useOptionsFlow(state);
  const [scope, setScope] = useState<'all' | 'market'>('all');
  const rows = useMemo(() => (scope === 'market' ? data?.filter((r) => r.symbol === symbol) : data) ?? [], [data, scope, symbol]);

  // What the tape adds up to: how much premium moved, and which way it leaned
  const sum = useMemo(() => {
    const calls = rows.filter((r) => r.isCall).reduce((a, r) => a + r.notional, 0);
    const puts = rows.filter((r) => !r.isCall).reduce((a, r) => a + r.notional, 0);
    const total = calls + puts;
    return {
      total, calls, puts,
      callShare: total > 0 ? (calls / total) * 100 : 0,
      buys: rows.filter((r) => r.side === 'buy').length,
      sells: rows.filter((r) => r.side === 'sell').length,
    };
  }, [rows]);

  if (!deployed) return <div className="tm-empty"><b>{t('tm.notDeployedYet')}</b>{t('tm.flowLater')}</div>;
  // not `isLoading`: the read waits on the market list and the series, and until it starts it is neither loading nor empty
  if (!data && !error) return <div className="tm-empty">{t('tm.loadingFlow')}</div>;
  if (error) return <div className="tm-empty"><b>{t('tm.flowUnavailable')}</b>{(error as Error).message.split('\n')[0]}</div>;

  return (
    <>
      <div className="tm-expiries">
        <span>{t('tm.show')}</span>
        <button type="button" className="tm-chip" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>{t('tm.allMarkets')}</button>
        <button type="button" className="tm-chip" aria-pressed={scope === 'market'} onClick={() => setScope('market')}>{t('tm.onlySymbol', { symbol })}</button>
        <span className="muted" style={{ marginLeft: 'auto' }}>{t('tm.latestFlow', { n: SHOWN })}</span>
      </div>
      <div className="tm-flow-sum">
        <div className="tm-stat"><span>{t('tm.premiumTraded')}</span><span>{fmtUsd(sum.total)}</span></div>
        <div className="tm-stat"><span>{t('tm.callsLc')}</span><span className="up">{fmtCompact(sum.calls)} · {sum.callShare.toFixed(0)}%</span></div>
        <div className="tm-stat"><span>{t('tm.putsLc')}</span><span className="down">{fmtCompact(sum.puts)} · {sum.total > 0 ? (100 - sum.callShare).toFixed(0) : 0}%</span></div>
        <div className="tm-stat"><span>{t('tm.buysSells')}</span><span>{sum.buys} / {sum.sells}</span></div>
      </div>
      {!rows.length
        ? <div className="tm-empty"><b>{scope === 'market' ? t('tm.noFlowOn', { symbol }) : t('tm.noFlow')}</b>{t('tm.noFlowBody')}</div>
        : (
          <table className="tm-table">
            <thead>
              <tr>
                <th className="l">{t('tm.time')}</th><th className="l">{t('tm.market')}</th><th className="l">{t('tm.contract')}</th><th className="l">{t('tm.side')}</th>
                <th>{t('tm.contracts')}</th><th>{t('tm.premium')}</th><th>{t('tm.notional')}</th><th className="l">{t('tm.trader')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="l dim" title={r.time ? new Date(r.time * 1000).toLocaleString(lang) : undefined}>
                    {explorer
                      ? <a className="tm-link" href={`${explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer">{r.time ? ago(r.time, t) : `#${r.block}`}</a>
                      : r.time ? ago(r.time, t) : `#${r.block}`}
                  </td>
                  <td className="l"><b>{r.symbol}</b></td>
                  <td className="l">
                    <span className={r.isCall ? 'up' : 'down'}>{+r.strike.toFixed(2)}{r.isCall ? 'C' : 'P'}</span>{' '}
                    <span className="muted">{fmtExpiry(r.expiry)}</span>
                  </td>
                  <td className={`l ${r.side === 'buy' ? 'up' : 'down'}`}>{t(r.side === 'buy' ? 'tm.BUY' : 'tm.SELL')}</td>
                  <td>{r.contracts}</td>
                  <td>{fmtPrice(r.premium)}</td>
                  <td>{fmtUsd(r.notional)}</td>
                  <td className="l muted">
                    {account && r.trader.toLowerCase() === account.toLowerCase()
                      ? <span className="gold">{t('tm.you')}</span>
                      : explorer
                        ? <a className="tm-link" style={{ color: 'inherit' }} href={`${explorer}/address/${r.trader}`} target="_blank" rel="noreferrer">{r.trader.slice(0, 6)}…{r.trader.slice(-4)}</a>
                        : `${r.trader.slice(0, 6)}…${r.trader.slice(-4)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </>
  );
}
