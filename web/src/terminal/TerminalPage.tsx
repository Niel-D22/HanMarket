import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { usePrices } from '../hooks/usePrices';
import { optionsAbi, perpsAbi } from '../../api/_lib/protocol/abis';
import { Sidebar, Ticker, TopBar, type Product, type View } from './Chrome';
import { TradeCenter, type BottomTab } from './TradeView';
import { OrderTerminal } from './OrderTerminal';
import { useOptionsFlow } from './flowData';
import { ActivityView, MarketsView, PortfolioView, TxToast, VaultView } from './Views';
import { StrategiesView } from './Strategies';
import type { SelectedOption } from './options';
import { usePanels } from './panels';
import { useShortcuts } from './keys';
import { ShortcutsHelp } from './Shortcuts';
import {
  optionLabel, toUsd6, useAccountState, useAllSeries, useHistory, useOptionHoldings, usePerpPositions,
  useProtocol, useProtocolState, useTx, type OptionHolding, type PerpPosition,
} from './protocol';
import { useT } from '../i18n';
import './terminal.css';

const SLIPPAGE = 0.005;
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 300);

/** The HanMarket trading terminal: options and perpetuals on China equities, in the Orionis layout. */
export function TerminalPage() {
  const t = useT();
  const { network, setNetwork, d } = useProtocol();
  const { address } = useAccount();
  const quotes = usePrices();
  const [view, setView] = useState<View>('trade');
  const [symbol, setSymbol] = useState('BABA');
  const [product, setProduct] = useState<Product>('perps');
  const [bottom, setBottom] = useState<BottomTab>('chain');
  const [selected, setSelected] = useState<SelectedOption | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { panels, setPanel } = usePanels();

  const { data: state } = useProtocolState();
  const { data: account } = useAccountState(address);
  const { data: series } = useAllSeries();
  const { data: positions } = usePerpPositions(address, state?.perps);
  const { data: holdings } = useOptionHoldings(address, series);
  const symbols = state?.assets.map((a) => a.symbol) ?? [];
  const { data: history, error: historyError } = useHistory(address, state?.perps, series, symbols);
  // Warm the Options Flow read as soon as the terminal opens: its first pass over the chain's history is
  // slow on a free RPC, and this way it is usually done by the time the tab is opened (same query, shared).
  useOptionsFlow(state);
  const tx = useTx();
  const busy = tx.state.stage === 'wallet' || tx.state.stage === 'confirming' || tx.state.stage === 'preparing';

  const perp = state?.perps.find((m) => m.assetSymbol === symbol);
  const deployed = !!d;
  const holding = selected ? holdings?.find((h) => h.id === selected.seriesId) : undefined;

  useEffect(() => { document.title = `${symbol} · HanMarket Terminal`; }, [symbol]);

  const select = useCallback((s: string, p?: Product) => {
    setSymbol(s);
    setSelected(null);
    setView('trade');
    if (p) {
      setProduct(p);
    } else {
      // No explicit product: the top search bar and a watchlist row both select this way. Every
      // market has options, but only some have a perpetual; staying on the Perpetuals tab
      // for anything else would land on "No perpetual for X" instead of the trade the symbol can
      // actually do, so fall back to Options whenever the new symbol has no perp market.
      // Before the market list has loaded nothing is known yet, so the tab stays as it is.
      const perps = state?.perps;
      setProduct((prev) => (prev === 'perps' && perps && !perps.some((m) => m.assetSymbol === s) ? 'options' : prev));
    }
  }, [state?.perps]);

  /** Opens a tab of the bottom panel, unfolding the panel if it was collapsed. */
  const openBottom = useCallback((tab: BottomTab) => {
    setView('trade');
    setBottom(tab);
    setPanel('bottom', true);
  }, [setPanel]);
  /** Opens the panel a finished transaction left its result in, so the toast can take the trader there. */
  const goTo = openBottom;

  // Keyboard navigation; the keys are listed in the help dialog (?)
  useShortcuts({
    c: () => openBottom('chain'),
    f: () => openBottom('flow'),
    u: () => openBottom('funding'),
    p: () => openBottom('positions'),
    o: () => openBottom('options'),
    h: () => openBottom('history'),
    '1': () => setView('trade'),
    '2': () => setView('markets'),
    '3': () => setView('portfolio'),
    '4': () => setView('vault'),
    '5': () => setView('strategies'),
    '6': () => setView('activity'),
    '/': () => document.getElementById('tm-search')?.focus(),
    '[': () => setPanel('side'),
    ']': () => setPanel('right'),
    b: () => setPanel('bottom'),
    t: () => setPanel('trades'),
    '?': () => setHelpOpen(true),
  });

  const closePerp = (p: PerpPosition) => {
    if (!d) return;
    const acceptable = toUsd6(p.isLong ? p.markPrice * (1 - SLIPPAGE) : p.markPrice * (1 + SLIPPAGE));
    tx.run(t('tm.txClose', { side: t(p.isLong ? 'tm.longLc' : 'tm.shortLc'), symbol: p.symbol }), [
      (w) => w.writeContract({ address: d.perpsEngine, abi: perpsAbi, functionName: 'closePosition', args: [p.marketId, p.isLong, acceptable, deadline()] }),
    ], {
      text: t('tm.outClose'),
      action: { label: t('tm.seeHistory'), run: () => goTo('history') },
    });
  };

  const sellOption = (h: OptionHolding) => {
    const assetSymbol = symbols[h.assetId];
    if (!assetSymbol) return;
    setView('trade');
    setSymbol(assetSymbol);
    setProduct('options');
    setBottom('chain');
    setPanel('right', true); // the ticket that sells it lives in the order terminal
    setSelected({
      seriesId: h.id, symbol: assetSymbol, isCall: h.isCall, strike: h.strike, expiry: h.expiry, cap: h.cap,
      side: 'sell', bid: 0, ask: 0, iv: 0, delta: 0,
    });
  };

  const redeem = (h: OptionHolding) => {
    if (!d) return;
    tx.run(t('tm.txRedeem', { label: optionLabel(symbols[h.assetId] ?? '?', h.expiry, h.strike, h.isCall) }), [
      (w) => w.writeContract({ address: d.optionsEngine, abi: optionsAbi, functionName: 'redeem', args: [BigInt(h.id), toUsd6(h.contracts)] }),
    ], {
      text: t('tm.outRedeem'),
      action: { label: t('tm.seeHistory'), run: () => goTo('history') },
    });
  };

  return (
    <div className="tm">
      <Ticker quotes={quotes} onSelect={(s) => select(s)} />
      <TopBar
        network={network} setNetwork={setNetwork} onSelect={(s) => select(s)} onMenu={() => setMenuOpen((o) => !o)}
        panels={panels} onPanel={setPanel} onHelp={() => setHelpOpen(true)}
      />
      <div className={`tm-body ${panels.side ? '' : 'no-side'} ${panels.right ? '' : 'no-right'}`}>
        <Sidebar
          view={view} setView={setView} symbol={symbol} product={product} onSelect={select}
          quotes={quotes} perps={state?.perps} network={network} deployed={deployed} onSwitchTestnet={() => setNetwork('testnet')}
          open={menuOpen} onClose={() => setMenuOpen(false)}
        />

        {view === 'trade' && (
          <>
            <TradeCenter
              symbol={symbol} product={product} quote={quotes[symbol]} perp={perp} state={state}
              selected={selected}
              onPick={(o) => { setSelected(o); setProduct('options'); setPanel('right', true); }}
              onPickPerp={(s) => select(s, 'perps')}
              bottom={bottom} setBottom={setBottom} panels={panels} setPanel={setPanel}
              account={address} positions={positions} holdings={holdings} history={history} historyError={historyError}
              onClosePerp={closePerp} onSellOption={sellOption} onRedeem={redeem}
              busy={busy} explorer={tx.explorer} deployed={deployed}
              onSwitchTestnet={() => setNetwork('testnet')} network={network}
            />
            <OrderTerminal
              symbol={symbol} product={product} setProduct={setProduct} perp={perp} perpsLoaded={!!state} fees={state?.fees}
              account={account} address={address} option={selected} holding={holding}
              onClearOption={() => setSelected(null)}
              onOptionSide={(side) => setSelected((o) => (o ? { ...o, side } : o))}
              tx={tx} deployed={deployed} goTo={goTo}
            />
          </>
        )}
        {view !== 'trade' && (
          <main className="tm-col" style={{ gridColumn: '2 / 4' }}>
            {view === 'markets' && <MarketsView quotes={quotes} state={state} onTrade={(s, p) => select(s, p)} />}
            {view === 'portfolio' && (
              <PortfolioView
                address={address} account={account} positions={positions} holdings={holdings} history={history} state={state}
                busy={busy} explorer={tx.explorer} onClosePerp={closePerp} onSellOption={sellOption} onRedeem={redeem}
              />
            )}
            {view === 'strategies' && (
              <StrategiesView
                key={symbol}
                symbol={symbol}
                fees={state?.fees}
                onTradeLeg={(o) => {
                  setSymbol(o.symbol);
                  setSelected(o);
                  setProduct('options');
                  setView('trade');
                  setBottom('chain');
                  setPanel('right', true);
                }}
              />
            )}
            {view === 'activity' && <ActivityView address={address} history={history} error={historyError} explorer={tx.explorer} />}
            {view === 'vault' && <VaultView address={address} account={account} tx={tx} deployed={deployed} />}
          </main>
        )}
      </div>
      <TxToast state={tx.state} explorer={tx.explorer} onClose={tx.reset} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
