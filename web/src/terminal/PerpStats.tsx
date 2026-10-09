import { useEffect, useState } from 'react';
import { fmtCompact, fmtPrice, type PerpMarket } from './protocol';
import { useT } from '../i18n';

// Funding & open interest across every perp market: what a position will pay or earn next, and how crowded each side
// is against its cap. Read from the same protocol state as the rest of the terminal (RiskManager + PerpsEngine).

const clock = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, '0')).join(':');

export function PerpStatsTable({ perps, symbol, onPick }: {
  perps?: PerpMarket[];
  /** the market on screen, highlighted */
  symbol: string;
  onPick: (assetSymbol: string) => void;
}) {
  const t = useT();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!perps?.length) return <div className="tm-empty">{t('tm.noPerpsHere')}</div>;

  return (
    <>
      <div className="tm-note" style={{ margin: '10px 16px 0' }}>
        {t('tm.fundingExplain')}
      </div>
      <table className="tm-table">
        <thead>
          <tr>
            <th className="l">{t('tm.market')}</th><th>{t('tm.index')}</th><th>{t('tm.fundingHour')}</th><th>{t('tm.longsPay')}</th><th>{t('tm.nextFundingLc')}</th>
            <th>{t('tm.longOi')}</th><th>{t('tm.shortOi')}</th><th className="l">{t('tm.skew')}</th><th>{t('tm.maxLeverageLc')}</th><th className="l">{t('tm.status')}</th>
          </tr>
        </thead>
        <tbody>
          {perps.map((m) => {
            const cap = Number(m.risk.openInterestCap) / 1e6;
            const total = m.longOi + m.shortOi;
            const longShare = total > 0 ? m.longOi / total : 0.5;
            const perYear = m.fundingRate * (365 * 24 * 3600) / Math.max(1, m.risk.fundingInterval);
            return (
              <tr key={m.id} className={m.assetSymbol === symbol ? 'tm-row-current' : ''} onClick={() => onPick(m.assetSymbol)} style={{ cursor: 'pointer' }}>
                <td className="l"><b>{m.symbol}</b></td>
                <td>{fmtPrice(m.indexPrice)}</td>
                <td className={m.fundingRate > 0 ? 'up' : m.fundingRate < 0 ? 'down' : ''}>{(m.fundingRate * 100).toFixed(4)}%</td>
                <td className="dim">{(perYear * 100).toFixed(2)}%</td>
                <td>{m.nextFunding ? clock(Math.max(0, m.nextFunding - now)) : '—'}</td>
                <td>{fmtCompact(m.longOi)} <span className="dim">/ {fmtCompact(cap)}</span></td>
                <td>{fmtCompact(m.shortOi)} <span className="dim">/ {fmtCompact(cap)}</span></td>
                <td className="l">
                  <span className="tm-skew" title={total > 0 ? t('tm.pctLong', { n: (longShare * 100).toFixed(0) }) : t('tm.noOi')}>
                    <i className="l" style={{ width: `${longShare * 100}%` }} />
                  </span>
                </td>
                <td>{m.risk.maxLeverage}x</td>
                <td className="l"><span className={`tm-pill ${m.tradingOpen ? 'open' : 'closed'}`}>{t(m.tradingOpen ? 'tm.OPEN' : 'tm.CLOSED')}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
