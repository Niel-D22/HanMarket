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
  fmtCompact, fmtExpiry, fmtPrice, fmtUsd, optionLabel, priceSource, tone, useAllSeries, useCollateralSymbol, useProtocol, usd,
  type HistoryRow, type OptionHolding, type PerpMarket, type PerpPosition, type ProtocolState,
} from './protocol';
import type { Product } from './Chrome';
import { OptionsFlow } from './Flow';
import { PerpStatsTable } from './PerpStats';
import { IconChevron } from './icons';
import type { PanelKey, Panels } from './panels';
import type { NetworkKey } from '../contexts/NetworkContext';

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
  source: string;
}) {
  const unit = useCollateralSymbol();
  const asset = findAsset(symbol);
  const countdown = useCountdown(perp?.nextFunding);
  const c = quote?.change24h ?? 0;
  const isPerp = product === 'perps' && perp;
  return (
    <div className="tm-stats">
      <div className="sym">
        <b>{isPerp ? perp.symbol : symbol}</b>
        <span className="muted">· {isPerp ? 'Perpetual' : 'Options'}{asset ? <> · <span className="cn">{asset.cn}</span></> : null}</span>
      </div>
      <div>
        <span className="price">{fmtPrice(quote?.price ?? 0)}</span>{' '}
        <span className="muted">{asset?.currency}</span>{' '}
        <span className={`num ${tone(c)}`}>{pct(c)}</span>
      </div>
      {/* the underlying's own session, which the option and perp are priced off */}
      <div className="tm-stat"><span>24h High</span><span>{quote?.high ? fmtPrice(quote.high) : '—'}</span></div>
      <div className="tm-stat"><span>24h Low</span><span>{quote?.low ? fmtPrice(quote.low) : '—'}</span></div>
      <div className="tm-stat"><span>24h Volume</span><span>{quote?.volume ? fmtCompact(quote.volume) : '—'}</span></div>
      {isPerp ? (
        <>
          <div className="tm-stat"><span>Index ({source})</span><span>{fmtPrice(perp.indexPrice)} {unit}</span></div>
          <div className="tm-stat"><span>Mark</span><span>{fmtPrice(perp.indexPrice)} {unit}</span></div>
          <div className="tm-stat"><span>Open Interest L / S</span><span>{fmtCompact(perp.longOi)} / {fmtCompact(perp.shortOi)}</span></div>
          <div className="tm-stat"><span>Funding / {perp.risk.fundingInterval / 3600}h</span><span className={perp.fundingRate > 0 ? 'up' : perp.fundingRate < 0 ? 'down' : ''}>{(perp.fundingRate * 100).toFixed(4)}%</span></div>
          <div className="tm-stat"><span>Next Funding</span><span>{countdown}</span></div>
          <div className="tm-stat"><span>Max Leverage</span><span>{perp.risk.maxLeverage}x</span></div>
          <span className={`tm-pill ${perp.tradingOpen ? 'open' : 'closed'}`}>{perp.tradingOpen ? 'OPEN' : 'CLOSED'}</span>
        </>
      ) : (
        <>
          <div className="tm-stat"><span>Index (USD)</span><span>{fmtPrice(quote?.priceUsd ?? 0)} {unit}</span></div>
          <div className="tm-stat"><span>Implied Vol</span><span>{chainIv ? `${(chainIv * 100).toFixed(1)}%` : '—'}</span></div>
          <div className="tm-stat"><span>Settlement</span><span>{source}</span></div>
          <div className="tm-stat"><span>Settlement Token</span><span>{unit}</span></div>
          <span className={`tm-pill ${source !== 'Signed price' ? 'chainlink' : ''}`}>{asset?.board === 'HK' ? 'HKEX' : 'US ADR'}</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- recent trades

interface TradeRow { key: string; price: number; size: string; side: 'buy' | 'sell'; label: string }

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
              size: opening ? fmtCompact(usd(l.args.sizeUsd as bigint)) : 'close',
              side: opening === long ? 'buy' : 'sell',
              label: opening ? (long ? 'Long' : 'Short') : 'Close',
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
  const unit = useCollateralSymbol();
  const { data } = useRecentTrades(symbol, product, perp, state);
  if (!open) {
    return (
      <div className="tm-trades tm-rail">
        <button type="button" onClick={onToggle} aria-expanded="false" aria-label="Show recent trades" title="Show recent trades ( T )">Trades</button>
      </div>
    );
  }
  return (
    <div className="tm-trades">
      <div className="tm-tabs">
        <span className="tm-tab" aria-selected="true">Trades</span>
        <button type="button" className="tm-fold" onClick={onToggle} aria-expanded="true" aria-label="Hide recent trades" title="Hide recent trades ( T )">›</button>
      </div>
      <div className="tm-trades-h"><span>{product === 'perps' ? `Price (${unit})` : 'Premium'}</span><span>Size</span><span>Side</span></div>
      <div className="tm-scroll" style={{ flex: 1 }}>
        {!data?.length && <div className="tm-empty">No trades yet on this market.</div>}
        {data?.map((t) => (
          <div key={t.key} className="tm-trades-row">
            <span className={t.side === 'buy' ? 'up' : 'down'}>{fmtPrice(t.price)}</span>
            <span>{t.size}</span>
            <span className="muted">{t.label}</span>
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

export function OptionChainTable({ symbol, selected, onPick }: {
  symbol: string;
  selected: SelectedOption | null;
  onPick: (o: SelectedOption) => void;
}) {
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

  if (isLoading) return <div className="tm-empty">Loading option chain…</div>;
  if (error) return <div className="tm-empty"><b>Option chain unavailable</b>{(error as Error).message}</div>;
  if (!data?.deployed) return <div className="tm-empty"><b>Not deployed on this network yet</b>Options open once the HanMarket contracts are live here.</div>;
  if (!data.expiries.length) return <div className="tm-empty"><b>No open series for {symbol}</b>New weekly expiries are listed every week by the keeper.</div>;

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
        title={action === 'buy' ? 'Buy at the ask' : 'Sell back at the bid'}
        onClick={() => pick(expiryTs, side, isCall, strike, action)}
      >
        {value ? `$${value.toFixed(2)}` : '—'}
      </button>
    );
  };

  return (
    <>
      <div className="tm-expiries">
        <span>Expiry:</span>
        <button type="button" className="tm-chip" aria-pressed={showAll} title="Every expiry in one table" onClick={() => setExpiry('all')}>
          All ({data.expiries.length})
        </button>
        {data.expiries.map((e) => (
          <button key={e.expiry} type="button" className="tm-chip" aria-pressed={!showAll && e.expiry === exp?.expiry} onClick={() => setExpiry(e.expiry)}>
            {fmtExpiry(e.expiry)} ({daysTo(e.expiry)}d)
          </button>
        ))}
        <span className="tm-chip-group" role="group" aria-label="Columns">
          {(['market', 'greeks'] as const).map((c) => (
            <button key={c} type="button" className="tm-chip" aria-pressed={cols === c} onClick={() => setCols(c)}>{c === 'market' ? 'Market' : 'Greeks'}</button>
          ))}
        </span>
        <span className="muted" style={{ marginLeft: 'auto' }}>Index: <span className="num gold">{fmtPrice(data.spot ?? 0)} {unit}</span>{!data.sessionOpen && ' · exchange closed, wider spreads'}</span>
      </div>
      <div className="tm-scroll">
        <table className="tm-table">
          <thead>
            <tr className="tm-chain-group">
              <th colSpan={2 + extra.length} className="up">CALLS ({unit})</th>
              <th className="c" />
              <th colSpan={2 + extra.length} className="down">PUTS ({unit})</th>
            </tr>
            <tr>
              <th>Call Bid</th><th>Call Ask</th>{extra.map((c) => <th key={`c-${c.label}`}>{c.label}</th>)}
              <th className="c">Strike</th>
              <th className="l">Put Bid</th><th className="l">Put Ask</th>{extra.map((c) => <th key={`p-${c.label}`}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const atmStrike = atmOf(e.rows);
              return (
                <Fragment key={e.expiry}>
                  {showAll && (
                    <tr className="tm-exp-row">
                      <td colSpan={5 + extra.length * 2}>{fmtExpiry(e.expiry)} · {daysTo(e.expiry)} days to expiry</td>
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
  if (!rows?.length) return <div className="tm-empty">No open perpetual positions.</div>;
  return (
    <table className="tm-table">
      <thead>
        <tr>
          <th className="l">Market</th><th className="l">Side</th><th>Size</th><th>Notional</th><th>Entry</th><th>Mark</th>
          <th>Liq. Price</th><th>Margin</th><th>Leverage</th><th>Funding</th><th>PnL</th><th />
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={`${p.marketId}-${p.isLong}`}>
            <td className="l"><b>{p.symbol}</b></td>
            <td className={`l ${p.isLong ? 'up' : 'down'}`}>{p.isLong ? 'LONG' : 'SHORT'}</td>
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
                ? <span className="tm-pill closed">LIQUIDATING</span>
                : <button type="button" className="tm-mini" disabled={busy || !marketOpen(p.marketId)} title={marketOpen(p.marketId) ? '' : 'Market closed'} onClick={() => onClose(p)}>Close</button>}
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
  if (!rows?.length) return <div className="tm-empty">No option positions.</div>;
  const now = Date.now() / 1000;
  return (
    <table className="tm-table">
      <thead>
        <tr><th className="l">Contract</th><th>Contracts</th><th>Strike</th><th>Cap</th><th>Expiry</th><th>Status</th><th>Payout</th><th /></tr>
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
              <td className={h.settled ? 'gold' : expired ? 'muted' : ''}>{h.settled ? `Settled @ ${fmtPrice(h.settlementPrice)}` : expired ? 'Awaiting settlement' : 'Open'}</td>
              <td className={payout > 0 ? 'up' : ''}>{h.settled ? fmtUsd(payout) : '—'}</td>
              <td>
                {h.settled
                  ? <button type="button" className="tm-mini" disabled={busy} onClick={() => onRedeem(h)}>Redeem</button>
                  : !expired && <button type="button" className="tm-mini danger" disabled={busy} onClick={() => onSell(h)}>Sell</button>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function HistoryTable({ rows, explorer, error }: { rows: HistoryRow[] | undefined; explorer?: string; error?: Error | null }) {
  const unit = useCollateralSymbol();
  if (error && !rows) return <div className="tm-empty"><b>History unavailable</b>{error.message.split('\n')[0]}</div>;
  if (!rows) return <div className="tm-empty">Loading history…</div>;
  if (!rows.length) return <div className="tm-empty">No activity yet.</div>;
  return (
    <table className="tm-table">
      <thead><tr><th className="l">Type</th><th className="l">Market</th><th className="l">Detail</th><th>{unit}</th><th>Block</th><th>Tx</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.hash}-${r.kind}-${r.market}`}>
            <td className="l">{r.kind}</td>
            <td className="l"><b>{r.market}</b></td>
            <td className="l muted">{r.detail}</td>
            <td className={r.transfer ? '' : tone(r.amount)}>{r.amount > 0 ? '+' : ''}{fmtUsd(r.amount)}</td>
            <td className="dim">{r.block.toString()}</td>
            <td>{explorer ? <a className="tm-link" href={`${explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer">View ↗</a> : r.hash.slice(0, 10)}</td>
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
  const asset = findAsset(symbol);
  const { data: chain } = useOptionChain(product === 'options' ? symbol : undefined);
  const symbols = state?.assets.map((a) => a.symbol) ?? [];
  const sessionOpenMsg = asset ? closedMessage(asset.board) : '';
  const exchangeOpen = chain?.sessionOpen ?? true;
  const { theme } = useTheme();

  return (
    <section className="tm-center tm-col" aria-label="Market">
      <StatsBar symbol={symbol} product={product} quote={quote} perp={perp} chainIv={chain?.iv} source={priceSource(network as NetworkKey, state ? !!state.perps.some((m) => m.assetSymbol === symbol) : symbol === 'BABA')} />
      {!deployed && (
        <div className="tm-banner">
          {network === 'mainnet'
            ? 'HanMarket opens on Robinhood Chain mainnet at launch. Prices and charts are live; trading runs on testnet.'
            : 'HanMarket is not deployed on Robinhood Chain testnet yet, so trading is disabled. Prices and charts are live.'}
          {network === 'mainnet' && <button type="button" onClick={onSwitchTestnet}>Switch to Testnet</button>}
        </div>
      )}
      {deployed && product === 'perps' && perp && !perp.tradingOpen && (
        <div className="tm-banner info">{perp.symbol} is closed until the next US session (Mon 04:00 – Fri 20:00 New York). Margin can still be added.</div>
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
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'chain'} title="Options chain ( C )" onClick={() => { setBottom('chain'); setPanel('bottom', true); }}>{symbol} · Options Chain</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'flow'} title="Options flow ( F )" onClick={() => { setBottom('flow'); setPanel('bottom', true); }}>Options Flow</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'funding'} title="Funding and open interest ( U )" onClick={() => { setBottom('funding'); setPanel('bottom', true); }}>Funding &amp; OI</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'positions'} title="Perpetual positions ( P )" onClick={() => { setBottom('positions'); setPanel('bottom', true); }}>Positions{positions?.length ? ` (${positions.length})` : ''}</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'options'} title="Option positions ( O )" onClick={() => { setBottom('options'); setPanel('bottom', true); }}>Options{holdings?.length ? ` (${holdings.length})` : ''}</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'history'} title="History ( H )" onClick={() => { setBottom('history'); setPanel('bottom', true); }}>History</button>
          </div>
          <button
            type="button"
            className="tm-fold"
            aria-expanded={panels.bottom}
            aria-label={panels.bottom ? 'Collapse the bottom panel' : 'Expand the bottom panel'}
            title={`${panels.bottom ? 'Collapse' : 'Expand'} the bottom panel ( B )`}
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
            {(bottom === 'positions' || bottom === 'options' || bottom === 'history') && !account && <div className="tm-empty"><b>Wallet not connected</b>Connect your wallet to see your positions and history.</div>}
            {bottom === 'positions' && account && <PerpPositionsTable rows={positions} onClose={onClosePerp} busy={busy} marketOpen={(id) => !!state?.perps.find((m) => m.id === id)?.tradingOpen} />}
            {bottom === 'options' && account && <OptionPositionsTable rows={holdings} symbols={symbols} onSell={onSellOption} onRedeem={onRedeem} busy={busy} />}
            {bottom === 'history' && account && <HistoryTable rows={history} explorer={explorer} error={historyError} />}
          </div>
        )}
      </div>
    </section>
  );
}
