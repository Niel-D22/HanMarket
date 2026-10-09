import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { PriceChart } from '../components/PriceChart';
import { useTheme } from '../theme/ThemeProvider';
import { findAsset } from '../data/assets';
import type { Quote } from '../hooks/usePrices';
import { closedMessage } from '../utils/marketHours';
import { optionsEventsAbi, perpsAbi } from '../../api/_lib/protocol/abis';
import { useOptionChain, type ChainRow, type ChainSide, type SelectedOption } from './options';
import {
  KIND_KEY, SOURCE_KEY, fmtCompact, fmtExpiry, fmtPrice, fmtUsd, historyDetail, optionLabel, priceSource, tone, useAllSeries,
  useCollateralSymbol, useProtocol, usd, type HistoryRow, type OptionHolding, type PerpMarket, type PerpPosition, type ProtocolState,
} from './protocol';
import type { Product } from './Chrome';
import { OptionsFlow } from './Flow';
import { PerpStatsTable } from './PerpStats';
import { IconChevron } from './icons';
import type { PanelKey, Panels } from './panels';
import type { NetworkKey } from '../contexts/NetworkContext';
import { useI18n, useT, type MsgKey } from '../i18n';

/** The tabs of the bottom panel. */
export type BottomTab = 'chain' | 'flow' | 'funding' | 'positions' | 'options' | 'history';

const pct = (n: number, digits = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
const daysTo = (ts: number) => Math.max(0, Math.round((ts * 1000 - Date.now()) / 86_400_000));

function useCountdown(target: number | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return '—';
  const s = Math.max(0, Math.floor(target - now / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, '0')).join(':');
}

// ---------------------------------------------------------------- stats bar

export function StatsBar({ symbol, product, quote, perp, chainIv, source }: {
  symbol: string;
  product: Product;
  quote?: Quote;
  perp?: PerpMarket;
  chainIv?: number;
  /** from priceSource(): Chainlink, Testnet feed or Signed price */
  source: ReturnType<typeof priceSource>;
}) {
  const t = useT();
  const unit = useCollateralSymbol();
  const asset = findAsset(symbol);
  const countdown = useCountdown(perp?.nextFunding);
  const c = quote?.change24h ?? 0;
  const isPerp = product === 'perps' && perp;
  return (
    <div className="tm-stats">
      <div className="sym">
        <b>{isPerp ? perp.symbol : symbol}</b>
        <span className="muted">· {t(isPerp ? 'tm.perpetual' : 'tm.options')}{asset ? <> · <span className="cn">{asset.cn}</span></> : null}</span>
      </div>
      <div>
        <span className="price">{fmtPrice(quote?.price ?? 0)}</span>{' '}
        <span className="muted">{asset?.currency}</span>{' '}
        <span className={`num ${tone(c)}`}>{pct(c)}</span>
      </div>
      {/* the underlying's own session, which the option and perp are priced off */}
      <div className="tm-stat"><span>{t('tm.high24')}</span><span>{quote?.high ? fmtPrice(quote.high) : '—'}</span></div>
      <div className="tm-stat"><span>{t('tm.low24')}</span><span>{quote?.low ? fmtPrice(quote.low) : '—'}</span></div>
      <div className="tm-stat"><span>{t('tm.volume24')}</span><span>{quote?.volume ? fmtCompact(quote.volume) : '—'}</span></div>
      {isPerp ? (
        <>
          <div className="tm-stat"><span>{t('tm.indexFrom', { source: t(SOURCE_KEY[source]) })}</span><span>{fmtPrice(perp.indexPrice)} {unit}</span></div>
          <div className="tm-stat"><span>{t('tm.mark')}</span><span>{fmtPrice(perp.indexPrice)} {unit}</span></div>
          <div className="tm-stat"><span>{t('tm.oiLS')}</span><span>{fmtCompact(perp.longOi)} / {fmtCompact(perp.shortOi)}</span></div>
          <div className="tm-stat"><span>{t('tm.fundingPer', { h: perp.risk.fundingInterval / 3600 })}</span><span className={perp.fundingRate > 0 ? 'up' : perp.fundingRate < 0 ? 'down' : ''}>{(perp.fundingRate * 100).toFixed(4)}%</span></div>
          <div className="tm-stat"><span>{t('tm.nextFunding')}</span><span>{countdown}</span></div>
          <div className="tm-stat"><span>{t('tm.maxLeverage')}</span><span>{perp.risk.maxLeverage}x</span></div>
          <span className={`tm-pill ${perp.tradingOpen ? 'open' : 'closed'}`}>{t(perp.tradingOpen ? 'tm.OPEN' : 'tm.CLOSED')}</span>
        </>
      ) : (
        <>
          <div className="tm-stat"><span>{t('tm.indexUsd')}</span><span>{fmtPrice(quote?.priceUsd ?? 0)} {unit}</span></div>
          <div className="tm-stat"><span>{t('tm.impliedVol')}</span><span>{chainIv ? `${(chainIv * 100).toFixed(1)}%` : '—'}</span></div>
          <div className="tm-stat"><span>{t('tm.settlement')}</span><span>{t(SOURCE_KEY[source])}</span></div>
          <div className="tm-stat"><span>{t('tm.settlementToken')}</span><span>{unit}</span></div>
          <span className={`tm-pill ${source !== 'Signed price' ? 'chainlink' : ''}`}>{asset?.board === 'HK' ? 'HKEX' : 'US ADR'}</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- recent trades

/** `perp` is a perp trade's side or a close, worded at render; an option trade carries its strike as `label` */
interface TradeRow { key: string; price: number; size: string; side: 'buy' | 'sell'; label: string; perp?: 'long' | 'short' | 'close' }

function useRecentTrades(symbol: string, product: Product, perp: PerpMarket | undefined, state: ProtocolState | undefined) {
  const { network, d, client, logClient } = useProtocol();
  const { data: series } = useAllSeries();
  return useQuery({
    queryKey: ['hm', network, 'trades', symbol, product, series?.length],
    enabled: !!d && !!client && !!state && (product === 'perps' || !!series),
    refetchInterval: 20_000,
    queryFn: async (): Promise<TradeRow[]> => {
      const head = await logClient.getBlockNumber();
      // the RPC's window is 50,000 blocks and the head can move between the two calls, so stay under it
      const from = head > 45_000n ? head - 45_000n : BigInt(d!.startBlock);
      if (product === 'perps' && perp) {
        const logs = await logClient.getLogs({
          address: d!.perpsEngine, events: perpsAbi.filter((x) => x.type === 'event'), args: { marketId: perp.id } as never, fromBlock: from,
        }).catch(() => []);
        return (logs as unknown as { eventName: string; args: Record<string, bigint | boolean>; transactionHash: string; logIndex: number }[])
          .filter((l) => l.eventName === 'PerpPositionOpened' || l.eventName === 'PerpPositionClosed')
          .slice(-40).reverse()
          .map((l) => {
            const opening = l.eventName === 'PerpPositionOpened';
            const long = !!l.args.isLong;
            return {
              key: `${l.transactionHash}-${l.logIndex}`,
              price: usd(l.args.price as bigint),
              size: opening ? fmtCompact(usd(l.args.sizeUsd as bigint)) : '',
              side: opening === long ? 'buy' : 'sell',
              label: '',
              perp: opening ? (long ? 'long' : 'short') : 'close',
            } satisfies TradeRow;
          });
      }
      const assetId = state!.assets.find((a) => a.symbol === symbol)?.id;
      const logs = await logClient.getLogs({ address: d!.optionsEngine, events: optionsEventsAbi, fromBlock: from }).catch(() => []);
      return (logs as unknown as { eventName: string; args: Record<string, bigint>; transactionHash: string; logIndex: number }[])
        .filter((l) => l.eventName !== 'OptionExercised' && series![Number(l.args.seriesId)]?.assetId === assetId)
        .slice(-40).reverse()
        .map((l) => {
          const s = series![Number(l.args.seriesId)];
          return {
            key: `${l.transactionHash}-${l.logIndex}`,
            price: usd(l.args.premium),
            size: `${usd(l.args.qty)}`,
            side: (l.eventName === 'OptionPositionOpened' ? 'buy' : 'sell') as 'buy' | 'sell',
            label: `${+s.strike.toFixed(2)}${s.isCall ? 'C' : 'P'}`,
          };
        });
    },
  });
}

export function RecentTrades({ symbol, product, perp, state, open, onToggle }: {
  symbol: string;
  product: Product;
  perp?: PerpMarket;
  state?: ProtocolState;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const unit = useCollateralSymbol();
  const { data } = useRecentTrades(symbol, product, perp, state);
  const perpLabel: Record<NonNullable<TradeRow['perp']>, MsgKey> = { long: 'tm.long', short: 'tm.short', close: 'tm.close' };
  if (!open) {
    return (
      <div className="tm-trades tm-rail">
        <button type="button" onClick={onToggle} aria-expanded="false" aria-label={t('tm.showTrades')} title={`${t('tm.showTrades')} ( T )`}>{t('tm.trades')}</button>
      </div>
    );
  }
  return (
    <div className="tm-trades">
      <div className="tm-tabs">
        <span className="tm-tab" aria-selected="true">{t('tm.trades')}</span>
        <button type="button" className="tm-fold" onClick={onToggle} aria-expanded="true" aria-label={t('tm.hideTrades')} title={`${t('tm.hideTrades')} ( T )`}>›</button>
      </div>
      <div className="tm-trades-h"><span>{product === 'perps' ? t('tm.priceIn', { unit }) : t('tm.premium')}</span><span>{t('tm.size')}</span><span>{t('tm.side')}</span></div>
      <div className="tm-scroll" style={{ flex: 1 }}>
        {!data?.length && <div className="tm-empty">{t('tm.noTrades')}</div>}
        {data?.map((row) => (
          <div key={row.key} className="tm-trades-row">
            <span className={row.side === 'buy' ? 'up' : 'down'}>{fmtPrice(row.price)}</span>
            <span>{row.size || t('tm.closeLc')}</span>
            <span className="muted">{row.perp ? t(perpLabel[row.perp]) : row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- option chain

/** The columns beside each side's bid and ask. Theta is per day, vega per vol point; open interest counts contracts. */
const CHAIN_COLUMNS = {
  market: [
    { label: 'IV', cell: (x: ChainSide) => `${(x.iv * 100).toFixed(1)}%` },
    { label: 'Delta', cell: (x: ChainSide) => x.delta.toFixed(2) },
    { label: 'Open Int.', cell: (x: ChainSide) => (x.open ? fmtCompact(x.open) : '0') },
  ],
  greeks: [
    { label: 'Delta', cell: (x: ChainSide) => x.delta.toFixed(2) },
    { label: 'Gamma', cell: (x: ChainSide) => x.gamma.toFixed(4) },
    { label: 'Theta/d', cell: (x: ChainSide) => x.theta.toFixed(3) },
    { label: 'Vega', cell: (x: ChainSide) => x.vega.toFixed(3) },
  ],
} as const;
type ChainColumns = keyof typeof CHAIN_COLUMNS;
/** the column names that are words rather than Greek letters */
const COLUMN_KEY: Partial<Record<string, MsgKey>> = { 'Open Int.': 'tm.openInt', 'Theta/d': 'tm.thetaD' };

export function OptionChainTable({ symbol, selected, onPick }: {
  symbol: string;
  selected: SelectedOption | null;
  onPick: (o: SelectedOption) => void;
}) {
  const t = useT();
  const colName = (label: string) => { const key = COLUMN_KEY[label]; return key ? t(key) : label; };
  const unit = useCollateralSymbol();
  const { data, isLoading, error } = useOptionChain(symbol);
  // null = the nearest expiry; 'all' = every expiry stacked in one table
  const [expiry, setExpiry] = useState<number | 'all' | null>(null);
  const [cols, setCols] = useState<ChainColumns>('market');
  const extra = CHAIN_COLUMNS[cols];
  const showAll = expiry === 'all';
  const exp = showAll ? undefined : data?.expiries.find((e) => e.expiry === expiry) ?? data?.expiries[0];
  const shown = showAll ? data?.expiries ?? [] : exp ? [exp] : [];
  useEffect(() => setExpiry(null), [symbol]);

  /** the strike nearest the index; each expiry has its own ladder, so it is worked out per expiry */
  const atmOf = (rows: ChainRow[]) => {
    if (!rows.length || !data?.spot) return null;
    return rows.reduce((best, r) => (Math.abs(r.strike - data.spot!) < Math.abs(best - data.spot!) ? r.strike : best), rows[0].strike);
  };

  if (isLoading) return <div className="tm-empty">{t('tm.loadingChain')}</div>;
  if (error) return <div className="tm-empty"><b>{t('tm.chainUnavailable')}</b>{(error as Error).message}</div>;
  if (!data?.deployed) return <div className="tm-empty"><b>{t('tm.notDeployedYet')}</b>{t('tm.optionsOpenLater')}</div>;
  if (!data.expiries.length) return <div className="tm-empty"><b>{t('tm.noSeries', { symbol })}</b>{t('tm.weeklyKeeper')}</div>;

  const pick = (expiryTs: number, side: ChainSide | undefined, isCall: boolean, strike: number, action: 'buy' | 'sell') => {
    if (!side) return;
    onPick({
      seriesId: side.seriesId, symbol, isCall, strike, expiry: expiryTs, cap: side.cap, side: action,
      bid: side.bid, ask: side.ask, iv: side.iv, delta: side.delta,
    });
  };
  const quoteBtn = (expiryTs: number, side: ChainSide | undefined, isCall: boolean, strike: number, action: 'buy' | 'sell') => {
    const value = action === 'buy' ? side?.ask : side?.bid;
    const active = selected?.seriesId === side?.seriesId && selected?.side === action;
    return (
      <button
        type="button"
        className={`tm-q ${action === 'buy' ? 'ask' : 'bid'}`}
        disabled={!side || !value}
        aria-pressed={active}
        title={t(action === 'buy' ? 'tm.buyAtAsk' : 'tm.sellAtBid')}
        onClick={() => pick(expiryTs, side, isCall, strike, action)}
      >
        {value ? `$${value.toFixed(2)}` : '—'}
      </button>
    );
  };

  return (
    <>
      <div className="tm-expiries">
        <span>{t('tm.expiryColon')}</span>
        <button type="button" className="tm-chip" aria-pressed={showAll} title={t('tm.allTitle')} onClick={() => setExpiry('all')}>
          {t('tm.allN', { n: data.expiries.length })}
        </button>
        {data.expiries.map((e) => (
          <button key={e.expiry} type="button" className="tm-chip" aria-pressed={!showAll && e.expiry === exp?.expiry} onClick={() => setExpiry(e.expiry)}>
            {fmtExpiry(e.expiry)} ({t('tm.daysShort', { n: daysTo(e.expiry) })})
          </button>
        ))}
        <span className="tm-chip-group" role="group" aria-label={t('tm.columns')}>
          {(['market', 'greeks'] as const).map((c) => (
            <button key={c} type="button" className="tm-chip" aria-pressed={cols === c} onClick={() => setCols(c)}>{t(c === 'market' ? 'tm.marketCols' : 'tm.greeks')}</button>
          ))}
        </span>
        <span className="muted" style={{ marginLeft: 'auto' }}>{t('tm.indexColon')} <span className="num gold">{fmtPrice(data.spot ?? 0)} {unit}</span>{!data.sessionOpen && t('tm.exchangeClosedWide')}</span>
      </div>
      <div className="tm-scroll">
        <table className="tm-table">
          <thead>
            <tr className="tm-chain-group">
              <th colSpan={2 + extra.length} className="up">{t('tm.calls', { unit })}</th>
              <th className="c" />
              <th colSpan={2 + extra.length} className="down">{t('tm.puts', { unit })}</th>
            </tr>
            <tr>
              <th>{t('tm.callBid')}</th><th>{t('tm.callAsk')}</th>{extra.map((c) => <th key={`c-${c.label}`}>{colName(c.label)}</th>)}
              <th className="c">{t('tm.strike')}</th>
              <th className="l">{t('tm.putBid')}</th><th className="l">{t('tm.putAsk')}</th>{extra.map((c) => <th key={`p-${c.label}`}>{colName(c.label)}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const atmStrike = atmOf(e.rows);
              return (
                <Fragment key={e.expiry}>
                  {showAll && (
                    <tr className="tm-exp-row">
                      <td colSpan={5 + extra.length * 2}>{t('tm.daysToExpiry', { date: fmtExpiry(e.expiry), n: daysTo(e.expiry) })}</td>
                    </tr>
                  )}
                  {e.rows.map((r) => {
                    const callItm = (data.spot ?? 0) > r.strike;
                    return (
                      <tr key={`${e.expiry}-${r.strike}`}>
                        <td className={callItm ? 'tm-itm' : ''}>{quoteBtn(e.expiry, r.call, true, r.strike, 'sell')}</td>
                        <td className={callItm ? 'tm-itm' : ''}>{quoteBtn(e.expiry, r.call, true, r.strike, 'buy')}</td>
                        {extra.map((c) => <td key={`c-${c.label}`} className={callItm ? 'tm-itm' : ''}>{r.call ? c.cell(r.call) : '—'}</td>)}
                        <td className={`tm-strike ${r.strike === atmStrike ? 'atm' : ''}`}>${+r.strike.toFixed(4)}</td>
                        <td className={`l ${!callItm ? 'tm-itm' : ''}`}>{quoteBtn(e.expiry, r.put, false, r.strike, 'sell')}</td>
                        <td className={`l ${!callItm ? 'tm-itm' : ''}`}>{quoteBtn(e.expiry, r.put, false, r.strike, 'buy')}</td>
                        {extra.map((c) => <td key={`p-${c.label}`} className={!callItm ? 'tm-itm' : ''}>{r.put ? c.cell(r.put) : '—'}</td>)}
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- positions

export function PerpPositionsTable({ rows, onClose, busy, marketOpen }: {
  rows: PerpPosition[] | undefined;
  onClose: (p: PerpPosition) => void;
  busy: boolean;
  marketOpen: (marketId: number) => boolean;
}) {
  const t = useT();
  if (!rows?.length) return <div className="tm-empty">{t('tm.noPerpPositions')}</div>;
  return (
    <table className="tm-table">
      <thead>
        <tr>
          <th className="l">{t('tm.market')}</th><th className="l">{t('tm.side')}</th><th>{t('tm.size')}</th><th>{t('tm.notional')}</th><th>{t('tm.entry')}</th><th>{t('tm.mark')}</th>
          <th>{t('tm.liqPrice')}</th><th>{t('tm.margin')}</th><th>{t('tm.leverage')}</th><th>{t('tm.funding')}</th><th>{t('tm.pnl')}</th><th />
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={`${p.marketId}-${p.isLong}`}>
            <td className="l"><b>{p.symbol}</b></td>
            <td className={`l ${p.isLong ? 'up' : 'down'}`}>{t(p.isLong ? 'tm.LONG' : 'tm.SHORT')}</td>
            <td>{p.size.toFixed(4)}</td>
            <td>{fmtUsd(p.notional)}</td>
            <td>{fmtPrice(p.entryPrice)}</td>
            <td>{fmtPrice(p.markPrice)}</td>
            <td className="gold">{Number.isFinite(p.liquidationPrice) && p.liquidationPrice > 0 ? fmtPrice(p.liquidationPrice) : '—'}</td>
            <td>{fmtUsd(p.collateral)}</td>
            <td>{Number.isFinite(p.leverage) ? `${p.leverage.toFixed(2)}x` : '—'}</td>
            <td className={p.fundingOwed > 0 ? 'down' : ''}>{p.fundingOwed > 0 ? `-${fmtUsd(p.fundingOwed)}` : '$0.00'}</td>
            <td className={tone(p.pnl)}>{fmtUsd(p.pnl)} <span className="dim">({pct((p.pnl / Math.max(p.collateral, 1e-9)) * 100, 1)})</span></td>
            <td>
              {p.liquidatable
                ? <span className="tm-pill closed">{t('tm.liquidating')}</span>
                : <button type="button" className="tm-mini" disabled={busy || !marketOpen(p.marketId)} title={marketOpen(p.marketId) ? '' : t('tm.marketClosed')} onClick={() => onClose(p)}>{t('tm.close')}</button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OptionPositionsTable({ rows, symbols, onSell, onRedeem, busy }: {
  rows: OptionHolding[] | undefined;
  symbols: string[];
  onSell: (h: OptionHolding) => void;
  onRedeem: (h: OptionHolding) => void;
  busy: boolean;
}) {
  const t = useT();
  if (!rows?.length) return <div className="tm-empty">{t('tm.noOptionPositions')}</div>;
  const now = Date.now() / 1000;
  return (
    <table className="tm-table">
      <thead>
        <tr><th className="l">{t('tm.contract')}</th><th>{t('tm.contracts')}</th><th>{t('tm.strike')}</th><th>{t('tm.cap')}</th><th>{t('tm.expiry')}</th><th>{t('tm.status')}</th><th>{t('tm.payout')}</th><th /></tr>
      </thead>
      <tbody>
        {rows.map((h) => {
          const payout = h.payoutPerContract * h.contracts;
          const expired = h.expiry <= now;
          return (
            <tr key={h.id}>
              <td className="l"><b>{optionLabel(symbols[h.assetId] ?? '?', h.expiry, h.strike, h.isCall)}</b></td>
              <td>{h.contracts}</td>
              <td>{fmtPrice(h.strike)}</td>
              <td>{fmtUsd(h.cap)}</td>
              <td>{fmtExpiry(h.expiry)}</td>
              <td className={h.settled ? 'gold' : expired ? 'muted' : ''}>{h.settled ? t('tm.settledAt', { price: fmtPrice(h.settlementPrice) }) : t(expired ? 'tm.awaitingSettlement' : 'tm.openStatus')}</td>
              <td className={payout > 0 ? 'up' : ''}>{h.settled ? fmtUsd(payout) : '—'}</td>
              <td>
                {h.settled
                  ? <button type="button" className="tm-mini" disabled={busy} onClick={() => onRedeem(h)}>{t('tm.redeem')}</button>
                  : !expired && <button type="button" className="tm-mini danger" disabled={busy} onClick={() => onSell(h)}>{t('tm.sell')}</button>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function HistoryTable({ rows, explorer, error }: { rows: HistoryRow[] | undefined; explorer?: string; error?: Error | null }) {
  const t = useT();
  const unit = useCollateralSymbol();
  if (error && !rows) return <div className="tm-empty"><b>{t('tm.historyUnavailable')}</b>{error.message.split('\n')[0]}</div>;
  if (!rows) return <div className="tm-empty">{t('tm.loadingHistory')}</div>;
  if (!rows.length) return <div className="tm-empty">{t('tm.noActivity')}</div>;
  return (
    <table className="tm-table">
      <thead><tr><th className="l">{t('tm.type')}</th><th className="l">{t('tm.market')}</th><th className="l">{t('tm.detail')}</th><th>{unit}</th><th>{t('tm.block')}</th><th>{t('tm.tx')}</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.hash}-${r.kind}-${r.market}`}>
            <td className="l">{t(KIND_KEY[r.kind])}</td>
            <td className="l"><b>{r.market === 'Vault' ? t('tm.view.vault') : r.market}</b></td>
            <td className="l muted">{historyDetail(t, r.detail)}</td>
            <td className={r.transfer ? '' : tone(r.amount)}>{r.amount > 0 ? '+' : ''}{fmtUsd(r.amount)}</td>
            <td className="dim">{r.block.toString()}</td>
            <td>{explorer ? <a className="tm-link" href={`${explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer">{t('tm.viewLink')}</a> : r.hash.slice(0, 10)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------- composed trade view

export function TradeCenter({ symbol, product, quote, perp, state, selected, onPick, onPickPerp, bottom, setBottom, panels, setPanel, account, positions, holdings, history, historyError, onClosePerp, onSellOption, onRedeem, busy, explorer, deployed, onSwitchTestnet, network }: {
  symbol: string;
  product: Product;
  quote?: Quote;
  perp?: PerpMarket;
  state?: ProtocolState;
  selected: SelectedOption | null;
  onPick: (o: SelectedOption) => void;
  /** opens a perp market (from the Funding & OI table) */
  onPickPerp: (assetSymbol: string) => void;
  bottom: BottomTab;
  setBottom: (b: BottomTab) => void;
  panels: Panels;
  setPanel: (key: PanelKey, open?: boolean) => void;
  account?: Address;
  positions?: PerpPosition[];
  holdings?: OptionHolding[];
  history?: HistoryRow[];
  historyError?: Error | null;
  onClosePerp: (p: PerpPosition) => void;
  onSellOption: (h: OptionHolding) => void;
  onRedeem: (h: OptionHolding) => void;
  busy: boolean;
  explorer?: string;
  deployed: boolean;
  onSwitchTestnet: () => void;
  network: string;
}) {
  const { t, lang } = useI18n();
  const asset = findAsset(symbol);
  const { data: chain } = useOptionChain(product === 'options' ? symbol : undefined);
  const symbols = state?.assets.map((a) => a.symbol) ?? [];
  const sessionOpenMsg = asset ? closedMessage(asset.board, t, lang) : '';
  const exchangeOpen = chain?.sessionOpen ?? true;
  const { theme } = useTheme();

  return (
    <section className="tm-center tm-col" aria-label={t('tm.marketSection')}>
      <StatsBar symbol={symbol} product={product} quote={quote} perp={perp} chainIv={chain?.iv} source={priceSource(network as NetworkKey, state ? !!state.perps.some((m) => m.assetSymbol === symbol) : symbol === 'BABA')} />
      {!deployed && (
        <div className="tm-banner">
          {network === 'mainnet'
            ? t('tm.bannerMainnet')
            : t('tm.bannerTestnet')}
          {network === 'mainnet' && <button type="button" onClick={onSwitchTestnet}>{t('tm.switchTestnet')}</button>}
        </div>
      )}
      {deployed && product === 'perps' && perp && !perp.tradingOpen && (
        <div className="tm-banner info">{t('tm.perpClosedBanner', { symbol: perp.symbol })}</div>
      )}
      {deployed && product === 'options' && !exchangeOpen && <div className="tm-banner info">{sessionOpenMsg}</div>}

      <div className={`tm-mid ${panels.trades ? '' : 'trades-collapsed'}`}>
        <div className="tm-chart"><PriceChart symbol={symbol} dark={theme === 'dark'} /></div>
        <RecentTrades symbol={symbol} product={product} perp={perp} state={state} open={panels.trades} onToggle={() => setPanel('trades')} />
      </div>

      <div className={`tm-bottom ${panels.bottom ? '' : 'is-collapsed'}`}>
        <div className="tm-bottom-h">
          {/* choosing a tab also opens the panel, so a folded panel never swallows a click */}
          <div className="tm-tabs" role="tablist">
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'chain'} title={`${t('tm.tab.chainTitle')} ( C )`} onClick={() => { setBottom('chain'); setPanel('bottom', true); }}>{t('tm.tab.chain', { symbol })}</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'flow'} title={`${t('tm.tab.flowTitle')} ( F )`} onClick={() => { setBottom('flow'); setPanel('bottom', true); }}>{t('tm.tab.flow')}</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'funding'} title={`${t('tm.tab.fundingTitle')} ( U )`} onClick={() => { setBottom('funding'); setPanel('bottom', true); }}>{t('tm.tab.funding')}</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'positions'} title={`${t('tm.tab.positionsTitle')} ( P )`} onClick={() => { setBottom('positions'); setPanel('bottom', true); }}>{t('tm.tab.positions')}{positions?.length ? ` (${positions.length})` : ''}</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'options'} title={`${t('tm.tab.optionsTitle')} ( O )`} onClick={() => { setBottom('options'); setPanel('bottom', true); }}>{t('tm.tab.options')}{holdings?.length ? ` (${holdings.length})` : ''}</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'history'} title={`${t('tm.history')} ( H )`} onClick={() => { setBottom('history'); setPanel('bottom', true); }}>{t('tm.history')}</button>
          </div>
          <button
            type="button"
            className="tm-fold"
            aria-expanded={panels.bottom}
            aria-label={t(panels.bottom ? 'tm.collapseBottom' : 'tm.expandBottom')}
            title={`${t(panels.bottom ? 'tm.collapseBottom' : 'tm.expandBottom')} ( B )`}
            onClick={() => setPanel('bottom')}
          >
            <span className="tm-fold-icon"><IconChevron /></span>
          </button>
        </div>
        {panels.bottom && (
          <div className="tm-scroll" style={{ flex: 1 }}>
            {bottom === 'chain' && <OptionChainTable symbol={symbol} selected={selected} onPick={onPick} />}
            {bottom === 'funding' && <PerpStatsTable perps={state?.perps} symbol={symbol} onPick={onPickPerp} />}
            {bottom === 'flow' && <OptionsFlow state={state} symbol={symbol} account={account} explorer={explorer} deployed={deployed} />}
            {(bottom === 'positions' || bottom === 'options' || bottom === 'history') && !account && <div className="tm-empty"><b>{t('tm.walletNotConnected')}</b>{t('tm.connectToSee')}</div>}
            {bottom === 'positions' && account && <PerpPositionsTable rows={positions} onClose={onClosePerp} busy={busy} marketOpen={(id) => !!state?.perps.find((m) => m.id === id)?.tradingOpen} />}
            {bottom === 'options' && account && <OptionPositionsTable rows={holdings} symbols={symbols} onSell={onSellOption} onRedeem={onRedeem} busy={busy} />}
            {bottom === 'history' && account && <HistoryTable rows={history} explorer={explorer} error={historyError} />}
          </div>
        )}
      </div>
    </section>
  );
}
