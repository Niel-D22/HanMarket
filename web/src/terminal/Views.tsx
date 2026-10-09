import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { ASSETS } from '../data/assets';
import type { Quote } from '../hooks/usePrices';
import { vaultAbi, erc20Abi } from '../../api/_lib/protocol/abis';
import {
  SOURCE_KEY, fmtCompact, fmtPrice, fmtUsd, priceSource, toUsd6, tone, useCollateralSymbol, useProtocol, useVaultStats,
  type AccountState, type HistoryRow, type OptionHolding, type PerpPosition, type ProtocolState, type Step, type TxState, type useTx,
} from './protocol';
import type { Product } from './Chrome';
import { HistoryTable, OptionPositionsTable, PerpPositionsTable } from './TradeView';
import { useVolumes } from './flowData';
import { useI18n, useT, type MsgKey } from '../i18n';

type Tx = ReturnType<typeof useTx>;
const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);

// ---------------------------------------------------------------- markets

export function MarketsView({ quotes, state, onTrade }: {
  quotes: Record<string, Quote>;
  state?: ProtocolState;
  onTrade: (symbol: string, product: Product) => void;
}) {
  const t = useT();
  const { network } = useProtocol();
  const perpFor = (symbol: string) => state?.perps.find((p) => p.assetSymbol === symbol);
  const { data: volumes } = useVolumes(state);
  return (
    <div className="tm-view">
      <div>
        <h1>{t('tm.view.markets')}</h1>
        <p>{t('tm.marketsLead', { n: ASSETS.length, p: state?.perps.length ?? 0 })}</p>
      </div>
      <div className="tm-panel">
        <div className="tm-scroll">
          <table className="tm-table">
            <thead>
              <tr>
                <th className="l">{t('tm.asset')}</th><th>{t('tm.indexPrice')}</th><th>{t('tm.h24')}</th><th>{t('tm.priceUsd')}</th><th title={t('tm.optVolTitle')}>{t('tm.optVol')}</th><th title={t('tm.perpVolTitle')}>{t('tm.perpVol')}</th><th>{t('tm.perpOi')}</th><th>{t('tm.funding')}</th><th className="l">{t('tm.oracle')}</th><th className="l">{t('tm.status')}</th><th />
              </tr>
            </thead>
            <tbody>
              {ASSETS.map((a) => {
                const q = quotes[a.symbol];
                const perp = perpFor(a.symbol);
                const c = q?.change24h ?? 0;
                return (
                  <tr key={a.symbol}>
                    <td className="l"><b>{a.symbol}</b> <span className="cn muted">{a.cn}</span> <span className="dim">{a.name}</span></td>
                    <td>{fmtPrice(q?.price ?? 0)} <span className="dim">{a.currency}</span></td>
                    <td className={tone(c)}>{q ? `${c >= 0 ? '+' : ''}${c.toFixed(2)}%` : '—'}</td>
                    <td>{fmtPrice(q?.priceUsd ?? 0)}</td>
                    <td className={volumes?.[a.symbol]?.options ? '' : 'dim'}>{fmtUsd(volumes?.[a.symbol]?.options ?? 0, 0)}</td>
                    <td className={volumes?.[a.symbol]?.perps ? '' : 'dim'}>{perp ? fmtUsd(volumes?.[a.symbol]?.perps ?? 0, 0) : '—'}</td>
                    <td>{perp ? `${fmtCompact(perp.longOi)} / ${fmtCompact(perp.shortOi)}` : '—'}</td>
                    <td>{perp ? `${(perp.fundingRate * 100).toFixed(4)}%` : '—'}</td>
                    <td className="l">{perp ? <span className="tm-pill chainlink">{t(SOURCE_KEY[priceSource(network, true)]).toUpperCase()}</span> : <span className="tm-pill">{t('tm.SIGNED')}</span>}</td>
                    <td className="l">{q?.halted ? <span className="tm-pill closed">{t('tm.HALTED')}</span> : <span className="tm-pill open">{t('tm.ACTIVE')}</span>}</td>
                    <td>
                      <button type="button" className="tm-mini" onClick={() => onTrade(a.symbol, 'options')}>{t('tm.tradeOptions')}</button>{' '}
                      {perp && <button type="button" className="tm-mini" onClick={() => onTrade(a.symbol, 'perps')}>{t('tm.tradePerps')}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- portfolio

export function PortfolioView({ address, account, positions, holdings, history, state, busy, explorer, onClosePerp, onSellOption, onRedeem }: {
  address?: Address;
  account?: AccountState;
  positions?: PerpPosition[];
  holdings?: OptionHolding[];
  history?: HistoryRow[];
  state?: ProtocolState;
  busy: boolean;
  explorer?: string;
  onClosePerp: (p: PerpPosition) => void;
  onSellOption: (h: OptionHolding) => void;
  onRedeem: (h: OptionHolding) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<'all' | 'perps' | 'options' | 'history'>('all');
  if (!address) {
    return <div className="tm-view"><h1>{t('tm.portfolioTitle')}</h1><div className="tm-panel"><div className="tm-empty"><b>{t('tm.walletNotConnected')}</b>{t('tm.connectPortfolio')}</div></div></div>;
  }
  const unrealised = (positions ?? []).reduce((s, p) => s + p.pnl - p.fundingOwed, 0);
  const payouts = (holdings ?? []).filter((h) => h.settled).reduce((s, h) => s + h.payoutPerContract * h.contracts, 0);
  const realised = (history ?? []).filter((r) => r.kind === 'Perp close' || r.kind === 'Perp update' || r.kind === 'Liquidated').reduce((s, r) => s + r.amount, 0);
  const value = (account?.free ?? 0) + (account?.locked ?? 0) + unrealised + payouts + (account?.lpValue ?? 0);
  const symbols = state?.assets.map((a) => a.symbol) ?? [];

  return (
    <div className="tm-view">
      <div><h1>{t('tm.portfolioTitle')}</h1><p>{t('tm.portfolioLead')}</p></div>
      <div className="tm-kpis">
        <div className="tm-kpi"><span>{t('tm.portfolioValue')}</span><b>{fmtUsd(value)}</b></div>
        <div className="tm-kpi"><span>{t('tm.availableCollateral')}</span><b>{fmtUsd(account?.free ?? 0)}</b></div>
        <div className="tm-kpi"><span>{t('tm.lockedMargin')}</span><b>{fmtUsd(account?.locked ?? 0)}</b></div>
        <div className="tm-kpi"><span>{t('tm.unrealized')}</span><b className={tone(unrealised)}>{fmtUsd(unrealised)}</b></div>
        <div className="tm-kpi"><span>{t('tm.realized')}</span><b className={tone(realised)}>{fmtUsd(realised)}</b></div>
        <div className="tm-kpi"><span>{t('tm.lpValue')}</span><b>{fmtUsd(account?.lpValue ?? 0)}</b></div>
      </div>
      <div className="tm-panel">
        <div className="tm-tabs" role="tablist">
          {(['all', 'perps', 'options', 'history'] as const).map((k) => (
            <button key={k} type="button" role="tab" className="tm-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {t(({ all: 'tm.allPositions', perps: 'tm.perpetuals', options: 'tm.options', history: 'tm.history' } as const)[k])}
            </button>
          ))}
        </div>
        <div className="tm-scroll">
          {(tab === 'all' || tab === 'perps') && <PerpPositionsTable rows={positions} onClose={onClosePerp} busy={busy} marketOpen={(id) => !!state?.perps.find((m) => m.id === id)?.tradingOpen} />}
          {(tab === 'all' || tab === 'options') && <OptionPositionsTable rows={holdings} symbols={symbols} onSell={onSellOption} onRedeem={onRedeem} busy={busy} />}
          {tab === 'history' && <HistoryTable rows={history} explorer={explorer} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- vault (LPs)

export function VaultView({ address, account, tx, deployed }: { address?: Address; account?: AccountState; tx: Tx; deployed: boolean }) {
  const { t, lang } = useI18n();
  const unit = useCollateralSymbol();
  const { d } = useProtocol();
  const { data: v } = useVaultStats();
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const a = num(amount);
  const busy = tx.state.stage === 'wallet' || tx.state.stage === 'confirming';
  const locked = (account?.lpUnlockAt ?? 0) * 1000 > Date.now();
  const shares = account?.lpShares ?? 0n;
  const max = mode === 'add' ? account?.wallet ?? 0 : account?.lpValue ?? 0;

  const submit = async () => {
    if (!d || !address || a <= 0) return;
    let steps: Step[];
    if (mode === 'add') {
      const value = toUsd6(a);
      steps = [
        ...((account?.allowance ?? 0n) < value
          ? [((w) => w.writeContract({ address: d.collateralToken, abi: erc20Abi, functionName: 'approve', args: [d.vault, value] })) as Step]
          : []),
        (w) => w.writeContract({ address: d.vault, abi: vaultAbi, functionName: 'addLiquidity', args: [value, 0n] }),
      ];
    } else {
      // shares proportional to the USDC asked for, all shares when asking for (almost) everything
      const part = a >= (account?.lpValue ?? 0) * 0.9999 ? shares : (shares * toUsd6(a)) / toUsd6(account?.lpValue || 1);
      steps = [(w) => w.writeContract({ address: d.vault, abi: vaultAbi, functionName: 'removeLiquidity', args: [part, (toUsd6(a) * 99n) / 100n] })];
    }
    const outcome = mode === 'add'
      ? { text: t('tm.outAdd', { amount: fmtUsd(a) }) }
      : { text: t('tm.outRemove', { amount: fmtUsd(a) }) };
    if (await tx.run(t(mode === 'add' ? 'tm.txAdd' : 'tm.txRemove', { amount: fmtUsd(a) }), steps, outcome)) setAmount('');
  };

  return (
    <div className="tm-view">
      <div>
        <h1>{t('tm.vaultTitle')}</h1>
        <p>{t('tm.vaultLead')}</p>
      </div>
      <div className="tm-kpis">
        <div className="tm-kpi"><span>{t('tm.navValue')}</span><b>{v ? fmtUsd(v.nav) : '—'}</b></div>
        <div className="tm-kpi"><span>{t('tm.poolCash')}</span><b>{v ? fmtUsd(v.pool) : '—'}</b></div>
        <div className="tm-kpi"><span>{t('tm.reserved')}</span><b>{v ? fmtUsd(v.reserved) : '—'}</b></div>
        <div className="tm-kpi"><span>{t('tm.utilization')}</span><b>{v ? `${(v.utilization * 100).toFixed(1)}%` : '—'}</b></div>
        <div className="tm-kpi"><span>{t('tm.withdrawable')}</span><b>{v ? fmtUsd(v.free) : '—'}</b></div>
        <div className="tm-kpi"><span>{t('tm.yourPosition')}</span><b>{address ? fmtUsd(account?.lpValue ?? 0) : '—'}</b></div>
      </div>
      <div className="tm-panel" style={{ maxWidth: 520 }}>
        <div className="tm-panel-h">{t('tm.provide')}</div>
        <div style={{ padding: 16 }}>
          <div className="tm-types" role="tablist" style={{ marginTop: 0 }}>
            <button type="button" role="tab" aria-selected={mode === 'add'} onClick={() => setMode('add')}>{t('tm.add')}</button>
            <button type="button" role="tab" aria-selected={mode === 'remove'} onClick={() => setMode('remove')}>{t('tm.remove')}</button>
          </div>
          <div className="tm-label"><span>{t('tm.amountUnit', { unit })}</span><span>{mode === 'add' ? t('tm.walletAmount', { amount: fmtUsd(account?.wallet ?? 0) }) : t('tm.yourLp', { amount: fmtUsd(account?.lpValue ?? 0) })}</span></div>
          <div className="tm-input">
            <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label={t('tm.liquidityAria')} />
            <span role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setAmount(max > 0 ? (Math.floor(max * 100) / 100).toString() : '')}>{t('tm.max')}</span>
          </div>
          <button
            type="button"
            className="tm-cta neutral"
            disabled={!deployed || !address || a <= 0 || a > max + 1e-9 || busy || (mode === 'remove' && locked)}
            onClick={submit}
          >
            {!deployed ? t('tm.notDeployedShort') : !address ? t('tm.connectWallet') : mode === 'remove' && locked ? t('tm.lockedUntil', { date: new Date((account?.lpUnlockAt ?? 0) * 1000).toLocaleString(lang) }) : t(mode === 'add' ? 'tm.addLiquidity' : 'tm.removeLiquidity')}
          </button>
          <div className="tm-note">
            {t('tm.vaultNote')}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tx toast

const STAGES: TxState['stage'][] = ['preparing', 'wallet', 'confirming', 'confirmed'];
const LABEL: Record<Exclude<TxState['stage'], 'idle'>, MsgKey> = {
  preparing: 'tm.stage.preparing', wallet: 'tm.stage.wallet', confirming: 'tm.stage.confirming', confirmed: 'tm.stage.confirmed', failed: 'tm.stage.failed',
};

export function TxToast({ state, explorer, onClose }: { state: TxState; explorer?: string; onClose: () => void }) {
  const t = useT();
  // a confirmation fades out on its own; a failure stays until it is read and closed. One that points at
  // its result stays longer, so there is time to read the sentence and press the button.
  useEffect(() => {
    if (state.stage !== 'confirmed') return;
    const timer = setTimeout(onClose, state.outcome ? 12000 : 6000);
    return () => clearTimeout(timer);
  }, [state.stage, state.hash, state.outcome, onClose]);
  if (state.stage === 'idle') return null;
  const at = STAGES.indexOf(state.stage);
  return (
    <div className={`tm-toast ${state.stage}`} role="status" aria-live="polite">
      <div className="tm-toast-h">
        <span>{state.stage === 'confirmed' ? '✓ ' : ''}{state.label}</span>
        {(state.stage === 'confirmed' || state.stage === 'failed') && <button type="button" className="tm-link" onClick={onClose}>{t('tm.dismiss')}</button>}
      </div>
      <div className="tm-steps">{STAGES.map((s, i) => <i key={s} className={state.stage === 'failed' ? '' : i <= at ? 'on' : ''} />)}</div>
      <div className={state.stage === 'failed' ? 'down' : 'muted'} style={{ fontSize: 12 }}>
        {state.stage === 'failed' ? state.error : t(LABEL[state.stage])}
      </div>
      {state.stage === 'confirmed' && state.outcome && (
        <div className="tm-toast-outcome">
          <span>{state.outcome.text}</span>
          {state.outcome.action && (
            <button
              type="button"
              className="tm-toast-go"
              onClick={() => { state.outcome!.action!.run(); onClose(); }}
            >
              {state.outcome.action.label} →
            </button>
          )}
        </div>
      )}
      {state.hash && explorer && <a className="tm-link" href={`${explorer}/tx/${state.hash}`} target="_blank" rel="noreferrer">{t('tm.viewExplorer')}</a>}
    </div>
  );
}


// ---------------------------------------------------------------- activity

type ActivityFilter = 'all' | 'trades' | 'transfers';

/** Every transaction the connected wallet made with HanMarket: trades, and money moved in and out of the vault. */
export function ActivityView({ address, history, error, explorer }: {
  address?: Address;
  history?: HistoryRow[];
  error?: Error | null;
  explorer?: string;
}) {
  const t = useT();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  if (!address) {
    return <div className="tm-view"><h1>{t('tm.activityTitle')}</h1><div className="tm-panel"><div className="tm-empty"><b>{t('tm.walletNotConnected')}</b>{t('tm.connectActivity')}</div></div></div>;
  }
  const rows = history?.filter((r) => filter === 'all' || (filter === 'transfers') === !!r.transfer);
  const count = (f: ActivityFilter) => history?.filter((r) => f === 'all' || (f === 'transfers') === !!r.transfer).length ?? 0;
  return (
    <div className="tm-view">
      <div>
        <h1>{t('tm.activityTitle')}</h1>
        <p>{t('tm.activityLead')}</p>
      </div>
      <div className="tm-panel">
        <div className="tm-tabs" role="tablist">
          {(['all', 'trades', 'transfers'] as const).map((f) => (
            <button key={f} type="button" role="tab" className="tm-tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {t(({ all: 'tm.all', trades: 'tm.trades', transfers: 'tm.transfers' } as const)[f])} ({count(f)})
            </button>
          ))}
        </div>
        <div className="tm-scroll"><HistoryTable rows={rows} explorer={explorer} error={error} /></div>
        <div className="tm-note" style={{ margin: '0 16px 14px' }}>
          {t('tm.fundingNote')}
        </div>
      </div>
    </div>
  );
}
