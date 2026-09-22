import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { usePrices } from '../hooks/usePrices';
import { optionsAbi, perpsAbi } from '../../api/_lib/protocol/abis';
import { Sidebar, TopBar, type Product, type View } from './Chrome';
import { TradeCenter } from './TradeView';
import { OrderTerminal } from './OrderTerminal';
import { MarketsView, PortfolioView, TxToast, VaultView } from './Views';
import type { SelectedOption } from './options';
import {
  optionLabel, toUsd6, useAccountState, useAllSeries, useHistory, useOptionHoldings, usePerpPositions,
  useProtocol, useProtocolState, useTx, type OptionHolding, type PerpPosition,
} from './protocol';
import './terminal.css';

const SLIPPAGE = 0.005;
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 300);

/** The HanMarket trading terminal: options and perpetuals on China equities, in the Orionis layout. */
export function TerminalPage() {
  const { network, setNetwork, d } = useProtocol();
  const { address } = useAccount();
  const quotes = usePrices();
  const [view, setView] = useState<View>('trade');
  const [symbol, setSymbol] = useState('BABA');
  const [product, setProduct] = useState<Product>('perps');
  const [bottom, setBottom] = useState<'chain' | 'positions' | 'options' | 'history'>('chain');
  const [selected, setSelected] = useState<SelectedOption | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: state } = useProtocolState();
  const { data: account } = useAccountState(address);
  const { data: series } = useAllSeries();
  const { data: positions } = usePerpPositions(address, state?.perps);
  const { data: holdings } = useOptionHoldings(address, series);
  const symbols = state?.assets.map((a) => a.symbol) ?? [];
  const { data: history } = useHistory(address, state?.perps, series, symbols);
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
    if (p) setProduct(p);
  }, []);

  /** Opens the panel a finished transaction left its result in, so the toast can take the trader there. */
  const goTo = useCallback((tab: 'positions' | 'options' | 'history') => {
    setView('trade');
    setBottom(tab);
  }, []);

  const closePerp = (p: PerpPosition) => {
    if (!d) return;
    const acceptable = toUsd6(p.isLong ? p.markPrice * (1 - SLIPPAGE) : p.markPrice * (1 + SLIPPAGE));
    tx.run(`Close ${p.isLong ? 'long' : 'short'} ${p.symbol}`, [
      (w) => w.writeContract({ address: d.perpsEngine, abi: perpsAbi, functionName: 'closePosition', args: [p.marketId, p.isLong, acceptable, deadline()] }),
    ], {
      text: 'Position closed. The margin and any profit are back in your available collateral.',
      action: { label: 'See it in History', run: () => goTo('history') },
    });
  };

  const sellOption = (h: OptionHolding) => {
    const assetSymbol = symbols[h.assetId];
    if (!assetSymbol) return;
    setView('trade');
    setSymbol(assetSymbol);
    setProduct('options');
    setBottom('chain');
    setSelected({
      seriesId: h.id, symbol: assetSymbol, isCall: h.isCall, strike: h.strike, expiry: h.expiry, cap: h.cap,
      side: 'sell', bid: 0, ask: 0, iv: 0, delta: 0,
    });
  };

  const redeem = (h: OptionHolding) => {
    if (!d) return;
    tx.run(`Redeem ${optionLabel(symbols[h.assetId] ?? '?', h.expiry, h.strike, h.isCall)}`, [
      (w) => w.writeContract({ address: d.optionsEngine, abi: optionsAbi, functionName: 'redeem', args: [BigInt(h.id), toUsd6(h.contracts)] }),
    ], {
      text: 'Settled. The payout is in your available collateral, and the contracts have left your Options tab.',
      action: { label: 'See it in History', run: () => goTo('history') },
    });
  };

  return (
    <div className="tm">
      <TopBar network={network} setNetwork={setNetwork} onSelect={(s) => select(s)} onMenu={() => setMenuOpen((o) => !o)} />
      <div className="tm-body">
        <Sidebar
          view={view} setView={setView} symbol={symbol} product={product} onSelect={select}
          quotes={quotes} perps={state?.perps} open={menuOpen} onClose={() => setMenuOpen(false)}
        />

        {view === 'trade' && (
          <>
            <TradeCenter
              symbol={symbol} product={product} quote={quotes[symbol]} perp={perp} state={state}
              selected={selected}
              onPick={(o) => { setSelected(o); setProduct('options'); }}
              bottom={bottom} setBottom={setBottom}
              account={address} positions={positions} holdings={holdings} history={history}
              onClosePerp={closePerp} onSellOption={sellOption} onRedeem={redeem}
              busy={busy} explorer={tx.explorer} deployed={deployed}
              onSwitchTestnet={() => setNetwork('testnet')} network={network}
            />
            <OrderTerminal
              symbol={symbol} product={product} setProduct={setProduct} perp={perp} fees={state?.fees}
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
            {view === 'vault' && <VaultView address={address} account={account} tx={tx} deployed={deployed} />}
          </main>
        )}
      </div>
      <TxToast state={tx.state} explorer={tx.explorer} onClose={tx.reset} />
    </div>
  );
}
