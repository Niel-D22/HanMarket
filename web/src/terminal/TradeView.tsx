import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { PriceChart } from '../components/PriceChart';
import { useTheme } from '../theme/ThemeProvider';
import { findAsset } from '../data/assets';
import type { Quote } from '../hooks/usePrices';
import { closedMessage } from '../utils/marketHours';
import { optionsEventsAbi, perpsAbi } from '../../api/_lib/protocol/abis';
import { useOptionChain, type ChainSide, type SelectedOption } from './options';
import {
  fmtCompact, fmtExpiry, fmtPrice, fmtUsd, optionLabel, tone, useAllSeries, useProtocol, usd,
  type HistoryRow, type OptionHolding, type PerpMarket, type PerpPosition, type ProtocolState,
} from './protocol';
import type { Product } from './Chrome';

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

export function StatsBar({ symbol, product, quote, perp, chainIv }: {
  symbol: string;
  product: Product;
  quote?: Quote;
  perp?: PerpMarket;
  chainIv?: number;
}) {
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
      {isPerp ? (
        <>
          <div className="tm-stat"><span>Index (Chainlink)</span><span>{fmtPrice(perp.indexPrice)} USDC</span></div>
          <div className="tm-stat"><span>Mark</span><span>{fmtPrice(perp.indexPrice)} USDC</span></div>
          <div className="tm-stat"><span>Open Interest L / S</span><span>{fmtCompact(perp.longOi)} / {fmtCompact(perp.shortOi)}</span></div>
          <div className="tm-stat"><span>Funding / {perp.risk.fundingInterval / 3600}h</span><span className={perp.fundingRate > 0 ? 'up' : perp.fundingRate < 0 ? 'down' : ''}>{(perp.fundingRate * 100).toFixed(4)}%</span></div>
          <div className="tm-stat"><span>Next Funding</span><span>{countdown}</span></div>
          <div className="tm-stat"><span>Max Leverage</span><span>{perp.risk.maxLeverage}x</span></div>
          <span className={`tm-pill ${perp.tradingOpen ? 'open' : 'closed'}`}>{perp.tradingOpen ? 'OPEN' : 'CLOSED'}</span>
        </>
      ) : (
        <>
          <div className="tm-stat"><span>Index (USD)</span><span>{fmtPrice(quote?.priceUsd ?? 0)} USDC</span></div>
          <div className="tm-stat"><span>Implied Vol</span><span>{chainIv ? `${(chainIv * 100).toFixed(1)}%` : '—'}</span></div>
          <div className="tm-stat"><span>Settlement</span><span>{symbol === 'BABA' ? 'Chainlink' : 'Signed price'}</span></div>
          <span className={`tm-pill ${symbol === 'BABA' ? 'chainlink' : ''}`}>{asset?.board === 'HK' ? 'HKEX' : 'US ADR'}</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- recent trades

interface TradeRow { key: string; price: number; size: string; side: 'buy' | 'sell'; label: string }

function useRecentTrades(symbol: string, product: Product, perp: PerpMarket | undefined, state: ProtocolState | undefined) {
  const { network, d, client } = useProtocol();
  const { data: series } = useAllSeries();
  return useQuery({
    queryKey: ['hm', network, 'trades', symbol, product, series?.length],
    enabled: !!d && !!client && !!state && (product === 'perps' || !!series),
    refetchInterval: 20_000,
    queryFn: async (): Promise<TradeRow[]> => {
      const head = await client!.getBlockNumber();
      const from = head > 50_000n ? head - 50_000n : BigInt(d!.startBlock);
      if (product === 'perps' && perp) {
        const logs = await client!.getLogs({
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
      const logs = await client!.getLogs({ address: d!.optionsEngine, events: optionsEventsAbi, fromBlock: from }).catch(() => []);
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

export function RecentTrades({ symbol, product, perp, state }: { symbol: string; product: Product; perp?: PerpMarket; state?: ProtocolState }) {
  const { data } = useRecentTrades(symbol, product, perp, state);
  return (
    <div className="tm-trades">
      <div className="tm-tabs"><span className="tm-tab" aria-selected="true">Trades</span></div>
      <div className="tm-trades-h"><span>{product === 'perps' ? 'Price (USDC)' : 'Premium'}</span><span>Size</span><span>Side</span></div>
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

export function OptionChainTable({ symbol, selected, onPick }: {
  symbol: string;
  selected: SelectedOption | null;
  onPick: (o: SelectedOption) => void;
}) {
  const { data, isLoading, error } = useOptionChain(symbol);
  const [expiry, setExpiry] = useState<number | null>(null);
  const exp = data?.expiries.find((e) => e.expiry === expiry) ?? data?.expiries[0];
  useEffect(() => setExpiry(null), [symbol]);

  const atmStrike = useMemo(() => {
    if (!exp?.rows.length || !data?.spot) return null;
    return exp.rows.reduce((best, r) => (Math.abs(r.strike - data.spot!) < Math.abs(best - data.spot!) ? r.strike : best), exp.rows[0].strike);
  }, [exp, data?.spot]);

  if (isLoading) return <div className="tm-empty">Loading option chain…</div>;
  if (error) return <div className="tm-empty"><b>Option chain unavailable</b>{(error as Error).message}</div>;
  if (!data?.deployed) return <div className="tm-empty"><b>Not deployed on this network yet</b>Options open once the HanMarket contracts are live here.</div>;
  if (!exp) return <div className="tm-empty"><b>No open series for {symbol}</b>New weekly expiries are listed every week by the keeper.</div>;

  const pick = (side: ChainSide | undefined, isCall: boolean, strike: number, action: 'buy' | 'sell') => {
    if (!side) return;
    onPick({
      seriesId: side.seriesId, symbol, isCall, strike, expiry: exp.expiry, cap: side.cap, side: action,
      bid: side.bid, ask: side.ask, iv: side.iv, delta: side.delta,
    });
  };
  const quoteBtn = (side: ChainSide | undefined, isCall: boolean, strike: number, action: 'buy' | 'sell') => {
    const value = action === 'buy' ? side?.ask : side?.bid;
    const active = selected?.seriesId === side?.seriesId && selected?.side === action;
    return (
      <button
        type="button"
        className={`tm-q ${action === 'buy' ? 'ask' : 'bid'}`}
        disabled={!side || !value}
        aria-pressed={active}
        title={action === 'buy' ? 'Buy at the ask' : 'Sell back at the bid'}
        onClick={() => pick(side, isCall, strike, action)}
      >
        {value ? `$${value.toFixed(2)}` : '—'}
      </button>
    );
  };

  return (
    <>
      <div className="tm-expiries">
        <span>Expiry:</span>
        {data.expiries.map((e) => (
          <button key={e.expiry} type="button" className="tm-chip" aria-pressed={e.expiry === exp.expiry} onClick={() => setExpiry(e.expiry)}>
            {fmtExpiry(e.expiry)} ({daysTo(e.expiry)}d)
          </button>
        ))}
        <span className="muted" style={{ marginLeft: 'auto' }}>Index: <span className="num gold">{fmtPrice(data.spot ?? 0)} USDC</span>{!data.sessionOpen && ' · exchange closed, wider spreads'}</span>
      </div>
      <div className="tm-scroll">
        <table className="tm-table">
          <thead>
            <tr className="tm-chain-group">
              <th colSpan={4} className="up">CALLS (USDC)</th>
              <th className="c" />
              <th colSpan={4} className="down">PUTS (USDC)</th>
            </tr>
            <tr>
              <th>Call Bid</th><th>Call Ask</th><th>IV</th><th>Delta</th>
              <th className="c">Strike</th>
              <th className="l">Put Bid</th><th className="l">Put Ask</th><th>IV</th><th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {exp.rows.map((r) => {
              const callItm = (data.spot ?? 0) > r.strike;
              return (
                <tr key={r.strike}>
                  <td className={callItm ? 'tm-itm' : ''}>{quoteBtn(r.call, true, r.strike, 'sell')}</td>
                  <td className={callItm ? 'tm-itm' : ''}>{quoteBtn(r.call, true, r.strike, 'buy')}</td>
                  <td className={callItm ? 'tm-itm' : ''}>{r.call ? `${(r.call.iv * 100).toFixed(1)}%` : '—'}</td>
                  <td className={callItm ? 'tm-itm' : ''}>{r.call ? r.call.delta.toFixed(2) : '—'}</td>
                  <td className={`tm-strike ${r.strike === atmStrike ? 'atm' : ''}`}>${+r.strike.toFixed(4)}</td>
                  <td className={`l ${!callItm ? 'tm-itm' : ''}`}>{quoteBtn(r.put, false, r.strike, 'sell')}</td>
                  <td className={`l ${!callItm ? 'tm-itm' : ''}`}>{quoteBtn(r.put, false, r.strike, 'buy')}</td>
                  <td className={!callItm ? 'tm-itm' : ''}>{r.put ? `${(r.put.iv * 100).toFixed(1)}%` : '—'}</td>
                  <td className={!callItm ? 'tm-itm' : ''}>{r.put ? r.put.delta.toFixed(2) : '—'}</td>
                </tr>
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

export function HistoryTable({ rows, explorer }: { rows: HistoryRow[] | undefined; explorer?: string }) {
  if (!rows?.length) return <div className="tm-empty">No activity yet.</div>;
  return (
    <table className="tm-table">
      <thead><tr><th className="l">Type</th><th className="l">Market</th><th className="l">Detail</th><th>USDC</th><th>Block</th><th>Tx</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.hash}-${r.kind}-${r.market}`}>
            <td className="l">{r.kind}</td>
            <td className="l"><b>{r.market}</b></td>
            <td className="l muted">{r.detail}</td>
            <td className={tone(r.amount)}>{fmtUsd(r.amount)}</td>
            <td className="dim">{r.block.toString()}</td>
            <td>{explorer ? <a className="tm-link" href={`${explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer">View ↗</a> : r.hash.slice(0, 10)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------- composed trade view

export function TradeCenter({ symbol, product, quote, perp, state, selected, onPick, bottom, setBottom, account, positions, holdings, history, onClosePerp, onSellOption, onRedeem, busy, explorer, deployed, onSwitchTestnet, network }: {
  symbol: string;
  product: Product;
  quote?: Quote;
  perp?: PerpMarket;
  state?: ProtocolState;
  selected: SelectedOption | null;
  onPick: (o: SelectedOption) => void;
  bottom: 'chain' | 'positions' | 'options' | 'history';
  setBottom: (b: 'chain' | 'positions' | 'options' | 'history') => void;
  account?: Address;
  positions?: PerpPosition[];
  holdings?: OptionHolding[];
  history?: HistoryRow[];
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
      <StatsBar symbol={symbol} product={product} quote={quote} perp={perp} chainIv={chain?.iv} />
      {!deployed && (
        <div className="tm-banner">
          HanMarket is not deployed on {network === 'mainnet' ? 'Robinhood Chain mainnet' : 'Robinhood Chain testnet'} yet, so trading is disabled. Prices and charts are live.
          {network === 'mainnet' && <button type="button" onClick={onSwitchTestnet}>Switch to Testnet</button>}
        </div>
      )}
      {deployed && product === 'perps' && perp && !perp.tradingOpen && (
        <div className="tm-banner info">{perp.symbol} is closed until the next US session (Mon 04:00 – Fri 20:00 New York). Margin can still be added.</div>
      )}
      {deployed && product === 'options' && !exchangeOpen && <div className="tm-banner info">{sessionOpenMsg}</div>}

      <div className="tm-mid">
        <div className="tm-chart"><PriceChart symbol={symbol} dark={theme === 'dark'} /></div>
        <RecentTrades symbol={symbol} product={product} perp={perp} state={state} />
      </div>

      <div className="tm-bottom">
        <div className="tm-bottom-h">
          <div className="tm-tabs" role="tablist">
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'chain'} onClick={() => setBottom('chain')}>{symbol} · Options Chain</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'positions'} onClick={() => setBottom('positions')}>Positions{positions?.length ? ` (${positions.length})` : ''}</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'options'} onClick={() => setBottom('options')}>Options{holdings?.length ? ` (${holdings.length})` : ''}</button>
            <button type="button" role="tab" className="tm-tab" aria-selected={bottom === 'history'} onClick={() => setBottom('history')}>History</button>
          </div>
        </div>
        <div className="tm-scroll" style={{ flex: 1 }}>
          {bottom === 'chain' && <OptionChainTable symbol={symbol} selected={selected} onPick={onPick} />}
          {bottom !== 'chain' && !account && <div className="tm-empty"><b>Wallet not connected</b>Connect your wallet to see your positions and history.</div>}
          {bottom === 'positions' && account && <PerpPositionsTable rows={positions} onClose={onClosePerp} busy={busy} marketOpen={(id) => !!state?.perps.find((m) => m.id === id)?.tradingOpen} />}
          {bottom === 'options' && account && <OptionPositionsTable rows={holdings} symbols={symbols} onSell={onSellOption} onRedeem={onRedeem} busy={busy} />}
          {bottom === 'history' && account && <HistoryTable rows={history} explorer={explorer} />}
        </div>
      </div>
    </section>
  );
}
