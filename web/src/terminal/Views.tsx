import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { ASSETS } from '../data/assets';
import type { Quote } from '../hooks/usePrices';
import { vaultAbi, erc20Abi } from '../../api/_lib/protocol/abis';
import {
  fmtCompact, fmtPrice, fmtUsd, toUsd6, tone, useProtocol, useVaultStats,
  type AccountState, type HistoryRow, type OptionHolding, type PerpPosition, type ProtocolState, type Step, type TxState, type useTx,
} from './protocol';
import type { Product } from './Chrome';
import { HistoryTable, OptionPositionsTable, PerpPositionsTable } from './TradeView';

type Tx = ReturnType<typeof useTx>;
const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);

// ---------------------------------------------------------------- markets

export function MarketsView({ quotes, state, onTrade }: {
  quotes: Record<string, Quote>;
  state?: ProtocolState;
  onTrade: (symbol: string, product: Product) => void;
}) {
  const perpFor = (symbol: string) => state?.perps.find((p) => p.assetSymbol === symbol);
  return (
    <div className="tm-view">
      <div>
        <h1>Markets</h1>
        <p>Options on {ASSETS.length} Hong Kong listings and China ADRs. Perpetuals where a trustless onchain price exists.</p>
      </div>
      <div className="tm-panel">
        <div className="tm-scroll">
          <table className="tm-table">
            <thead>
              <tr>
                <th className="l">Asset</th><th>Index Price</th><th>24H</th><th>Price (USD)</th><th>Perp OI (L / S)</th><th>Funding</th><th className="l">Oracle</th><th className="l">Status</th><th />
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
                    <td>{perp ? `${fmtCompact(perp.longOi)} / ${fmtCompact(perp.shortOi)}` : '—'}</td>
                    <td>{perp ? `${(perp.fundingRate * 100).toFixed(4)}%` : '—'}</td>
                    <td className="l">{a.symbol === 'BABA' ? <span className="tm-pill chainlink">CHAINLINK</span> : <span className="tm-pill">SIGNED</span>}</td>
                    <td className="l">{q?.halted ? <span className="tm-pill closed">HALTED</span> : <span className="tm-pill open">ACTIVE</span>}</td>
                    <td>
                      <button type="button" className="tm-mini" onClick={() => onTrade(a.symbol, 'options')}>Trade Options</button>{' '}
                      {perp && <button type="button" className="tm-mini" onClick={() => onTrade(a.symbol, 'perps')}>Trade Perps</button>}
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
  const [tab, setTab] = useState<'all' | 'perps' | 'options' | 'history'>('all');
  if (!address) {
    return <div className="tm-view"><h1>Your Portfolio</h1><div className="tm-panel"><div className="tm-empty"><b>Wallet not connected</b>Connect your wallet to view your portfolio.</div></div></div>;
  }
  const unrealised = (positions ?? []).reduce((s, p) => s + p.pnl - p.fundingOwed, 0);
  const payouts = (holdings ?? []).filter((h) => h.settled).reduce((s, h) => s + h.payoutPerContract * h.contracts, 0);
  const realised = (history ?? []).filter((r) => r.kind === 'Perp close' || r.kind === 'Perp update' || r.kind === 'Liquidated').reduce((s, r) => s + r.amount, 0);
  const value = (account?.free ?? 0) + (account?.locked ?? 0) + unrealised + payouts + (account?.lpValue ?? 0);
  const symbols = state?.assets.map((a) => a.symbol) ?? [];

  return (
    <div className="tm-view">
      <div><h1>Your Portfolio</h1><p>Everything you hold in HanMarket on this network.</p></div>
      <div className="tm-kpis">
        <div className="tm-kpi"><span>PORTFOLIO VALUE</span><b>{fmtUsd(value)}</b></div>
        <div className="tm-kpi"><span>Available Collateral</span><b>{fmtUsd(account?.free ?? 0)}</b></div>
        <div className="tm-kpi"><span>Locked Margin</span><b>{fmtUsd(account?.locked ?? 0)}</b></div>
        <div className="tm-kpi"><span>Unrealized PnL</span><b className={tone(unrealised)}>{fmtUsd(unrealised)}</b></div>
        <div className="tm-kpi"><span>Realized PnL (perps)</span><b className={tone(realised)}>{fmtUsd(realised)}</b></div>
        <div className="tm-kpi"><span>Vault LP Value</span><b>{fmtUsd(account?.lpValue ?? 0)}</b></div>
      </div>
      <div className="tm-panel">
        <div className="tm-tabs" role="tablist">
          {(['all', 'perps', 'options', 'history'] as const).map((t) => (
            <button key={t} type="button" role="tab" className="tm-tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {{ all: 'All Positions', perps: 'Perpetuals', options: 'Options', history: 'History' }[t]}
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
      ? { text: `${fmtUsd(a)} is in the pool and your hmLP shares are locked for 24 hours. Your share value is shown above.` }
      : { text: `${fmtUsd(a)} has left the pool and is back in your wallet.` };
    if (await tx.run(mode === 'add' ? `Add ${fmtUsd(a)} liquidity` : `Remove ${fmtUsd(a)} liquidity`, steps, outcome)) setAmount('');
  };

  return (
    <div className="tm-view">
      <div>
        <h1>HanMarket Vault</h1>
        <p>The vault is the counterparty to every option and perp. LPs earn 70% of trading fees, option premiums and trader losses, and pay trader profits.</p>
      </div>
      <div className="tm-kpis">
        <div className="tm-kpi"><span>Vault Value (NAV)</span><b>{v ? fmtUsd(v.nav) : '—'}</b></div>
        <div className="tm-kpi"><span>Pool Cash</span><b>{v ? fmtUsd(v.pool) : '—'}</b></div>
        <div className="tm-kpi"><span>Reserved for Payouts</span><b>{v ? fmtUsd(v.reserved) : '—'}</b></div>
        <div className="tm-kpi"><span>Utilization</span><b>{v ? `${(v.utilization * 100).toFixed(1)}%` : '—'}</b></div>
        <div className="tm-kpi"><span>Withdrawable Now</span><b>{v ? fmtUsd(v.free) : '—'}</b></div>
        <div className="tm-kpi"><span>Your Position</span><b>{address ? fmtUsd(account?.lpValue ?? 0) : '—'}</b></div>
      </div>
      <div className="tm-panel" style={{ maxWidth: 520 }}>
        <div className="tm-panel-h">Provide liquidity</div>
        <div style={{ padding: 16 }}>
          <div className="tm-types" role="tablist" style={{ marginTop: 0 }}>
            <button type="button" role="tab" aria-selected={mode === 'add'} onClick={() => setMode('add')}>Add</button>
            <button type="button" role="tab" aria-selected={mode === 'remove'} onClick={() => setMode('remove')}>Remove</button>
          </div>
          <div className="tm-label"><span>Amount (USDC)</span><span>{mode === 'add' ? `Wallet ${fmtUsd(account?.wallet ?? 0)}` : `Your LP ${fmtUsd(account?.lpValue ?? 0)}`}</span></div>
          <div className="tm-input">
            <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Liquidity amount" />
            <span role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setAmount(max > 0 ? (Math.floor(max * 100) / 100).toString() : '')}>MAX</span>
          </div>
          <button
            type="button"
            className="tm-cta neutral"
            disabled={!deployed || !address || a <= 0 || a > max + 1e-9 || busy || (mode === 'remove' && locked)}
            onClick={submit}
          >
            {!deployed ? 'Not deployed' : !address ? 'Connect wallet' : mode === 'remove' && locked ? `Locked until ${new Date((account?.lpUnlockAt ?? 0) * 1000).toLocaleString()}` : mode === 'add' ? 'Add Liquidity' : 'Remove Liquidity'}
          </button>
          <div className="tm-note">
            New liquidity is locked for 24 hours. Withdrawals are limited to funds not reserved for open positions. LPs carry the risk of traders winning; the protocol is not yet audited.
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tx toast

const STAGES: TxState['stage'][] = ['preparing', 'wallet', 'confirming', 'confirmed'];
const LABEL: Record<TxState['stage'], string> = {
  idle: '', preparing: 'Preparing', wallet: 'Awaiting wallet', confirming: 'Confirming', confirmed: 'Confirmed', failed: 'Failed',
};

export function TxToast({ state, explorer, onClose }: { state: TxState; explorer?: string; onClose: () => void }) {
  // a confirmation fades out on its own; a failure stays until it is read and closed. One that points at
  // its result stays longer, so there is time to read the sentence and press the button.
  useEffect(() => {
    if (state.stage !== 'confirmed') return;
    const t = setTimeout(onClose, state.outcome ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [state.stage, state.hash, state.outcome, onClose]);
  if (state.stage === 'idle') return null;
  const at = STAGES.indexOf(state.stage);
  return (
    <div className={`tm-toast ${state.stage}`} role="status" aria-live="polite">
      <div className="tm-toast-h">
        <span>{state.stage === 'confirmed' ? '✓ ' : ''}{state.label}</span>
        {(state.stage === 'confirmed' || state.stage === 'failed') && <button type="button" className="tm-link" onClick={onClose}>Close</button>}
      </div>
      <div className="tm-steps">{STAGES.map((s, i) => <i key={s} className={state.stage === 'failed' ? '' : i <= at ? 'on' : ''} />)}</div>
      <div className={state.stage === 'failed' ? 'down' : 'muted'} style={{ fontSize: 12 }}>
        {state.stage === 'failed' ? state.error : LABEL[state.stage]}
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
      {state.hash && explorer && <a className="tm-link" href={`${explorer}/tx/${state.hash}`} target="_blank" rel="noreferrer">View on Explorer ↗</a>}
    </div>
  );
}

