import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { useNetwork } from '../contexts/NetworkContext';
import { erc20Abi, optionsAbi, perpsAbi, vaultAbi } from '../../api/_lib/protocol/abis';
import { fetchQuote, useOptionChain, type SelectedOption } from './options';
import {
  fmtPrice, fmtUsd, optionLabel, toUsd6, useProtocol,
  type AccountState, type Fees, type OptionHolding, type PerpMarket, type Step, type useTx,
} from './protocol';
import type { Product } from './Chrome';

type Tx = ReturnType<typeof useTx>;
/** Opens the bottom panel that holds a finished transaction's result. */
export type GoTo = (tab: 'positions' | 'options' | 'history') => void;
const SLIPPAGE = 0.005; // perps fill at the oracle price; this only guards against a price update in between
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 300);
const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);

// ---------------------------------------------------------------- perp ticket

function PerpTicket({ perp, fees, account, address, tx, deployed, goTo }: {
  perp?: PerpMarket;
  fees?: Fees;
  account?: AccountState;
  address?: Address;
  tx: Tx;
  deployed: boolean;
  goTo: GoTo;
}) {
  const { d } = useProtocol();
  const [isLong, setIsLong] = useState(true);
  const [size, setSize] = useState('');
  const maxLev = perp?.risk.maxLeverage ?? 1;
  const [lev, setLev] = useState(Math.min(2, maxLev));
  useEffect(() => setLev((l) => Math.min(Math.max(l, 1), maxLev)), [maxLev]);

  const price = perp?.indexPrice ?? 0;
  const feeRate = (fees?.takerFee ?? 0) / 10_000;
  const shares = num(size);
  const notional = shares * price;
  const margin = lev > 0 ? notional / lev : 0;
  const fee = notional * feeRate;
  const required = margin + fee;
  const free = account?.free ?? 0;
  const maxShares = price > 0 ? (free * lev) / (price * (1 + lev * feeRate)) : 0;
  const mm = (perp?.risk.maintenanceMarginBps ?? 1000) / 10_000;
  const liq = shares > 0 && price > 0
    ? isLong ? Math.max(0, (notional - margin) / (shares * (1 - mm))) : (margin + notional) / (shares * (1 + mm))
    : 0;
  const limitNotional = perp ? Number(perp.risk.maxPositionNotional) / 1e6 : 0;

  const problem = !deployed ? 'Not deployed on this network'
    : !perp ? 'No perpetual for this market'
    : !address ? 'Connect wallet'
    : !perp.tradingOpen ? 'Market closed'
    : shares <= 0 ? 'Enter a size'
    : notional > limitNotional ? `Max position ${fmtUsd(limitNotional, 0)}`
    : required > free + 1e-9 ? 'Deposit USDC to trade'
    : null;

  const submit = async () => {
    if (!perp || !d || problem) return;
    const acceptable = toUsd6(isLong ? price * (1 + SLIPPAGE) : price * (1 - SLIPPAGE));
    const ok = await tx.run(`${isLong ? 'Long' : 'Short'} ${perp.symbol} ${lev}x`, [
      (w) => w.writeContract({
        address: d.perpsEngine, abi: perpsAbi, functionName: 'increasePosition',
        args: [perp.id, isLong, toUsd6(required), toUsd6(notional), acceptable, deadline()],
      }),
    ], {
      text: `Your ${isLong ? 'long' : 'short'} on ${perp.symbol} is open, and its margin is now locked.`,
      action: { label: 'View position', run: () => goTo('positions') },
    });
    if (ok) setSize('');
  };

  const marks = Array.from(new Set([1, 2, 3, 5, 10, 20].filter((m) => m <= maxLev).concat(maxLev))).sort((a, b) => a - b);

  return (
    <>
      <div className="tm-seg" role="group" aria-label="Side">
        <button type="button" className="long" aria-pressed={isLong} onClick={() => setIsLong(true)}>Long</button>
        <button type="button" className="short" aria-pressed={!isLong} onClick={() => setIsLong(false)}>Short</button>
      </div>
      <div className="tm-types" role="tablist">
        <button type="button" role="tab" aria-selected="true">Market</button>
        <button type="button" role="tab" aria-selected="false" disabled title="Limit orders arrive in phase 2">Limit</button>
        <button type="button" role="tab" aria-selected="false" disabled title="Stop loss / take profit arrive in phase 2">Advanced</button>
      </div>

      <div className="tm-label"><span>Order Size ({perp?.assetSymbol ?? '—'})</span><span>≈ {fmtUsd(notional)}</span></div>
      <div className="tm-input">
        <input inputMode="decimal" placeholder="0.00" value={size} onChange={(e) => setSize(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Order size in shares" />
        <span>{perp?.assetSymbol ?? '—'}</span>
      </div>
      <div className="tm-pcts">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <button key={f} type="button" onClick={() => setSize(maxShares > 0 ? (Math.floor(maxShares * f * 1e4) / 1e4).toString() : '')}>{f * 100}%</button>
        ))}
      </div>

      <div className="tm-label"><span>Leverage</span><span className="dim">max {maxLev}x</span></div>
      <div className="tm-lev">
        <input type="range" min={1} max={maxLev} step={0.5} value={lev} onChange={(e) => setLev(Number(e.target.value))} aria-label="Leverage" />
        <b>{lev}x</b>
      </div>
      <div className="tm-lev-marks">{marks.map((m) => <button key={m} type="button" onClick={() => setLev(m)}>{m}x</button>)}</div>

      <div className="tm-summary">
        <div className="tm-kv"><span>Est. Position Value</span><span>{fmtUsd(notional)}</span></div>
        <div className="tm-kv"><span>Est. Entry (index)</span><span>{fmtPrice(price)}</span></div>
        <div className="tm-kv"><span>Req. Collateral</span><span className="gold">{fmtUsd(margin)}</span></div>
        <div className="tm-kv"><span>Liquidation Price</span><span>{liq > 0 ? fmtPrice(liq) : '—'}</span></div>
        <div className="tm-kv"><span>Trading Fee ({(feeRate * 100).toFixed(2)}%)</span><span>{fmtUsd(fee)}</span></div>
        <div className="tm-kv"><span>Funding / {perp ? perp.risk.fundingInterval / 3600 : 1}h</span><span>{perp ? `${(perp.fundingRate * 100).toFixed(4)}%` : '—'}</span></div>
        <div className="tm-kv"><span>Available Collateral</span><span>{fmtUsd(free)}</span></div>
      </div>
      <button type="button" className={`tm-cta ${isLong ? 'long' : 'short'}`} disabled={!!problem || tx.state.stage === 'wallet' || tx.state.stage === 'confirming'} onClick={submit}>
        {problem ?? `${isLong ? 'Buy / Long' : 'Sell / Short'} ${perp?.assetSymbol}`}
      </button>
      <div className="tm-note">
        Filled at the oracle index price (Chainlink on mainnet). Settled onchain in USDC through the HanMarket Vault. Isolated margin: a loss never exceeds this position's collateral.
      </div>
    </>
  );
}

// ---------------------------------------------------------------- option ticket

function OptionTicket({ option, holding, fees, account, address, tx, deployed, goTo, onClear, onSide }: {
  option: SelectedOption | null;
  onSide: (side: 'buy' | 'sell') => void;
  holding?: OptionHolding;
  fees?: Fees;
  account?: AccountState;
  address?: Address;
  tx: Tx;
  deployed: boolean;
  goTo: GoTo;
  onClear: () => void;
}) {
  const { d, network } = useProtocol();
  const { apiUrl } = useNetwork();
  const [contracts, setContracts] = useState('1');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  useEffect(() => { setQuoteError(null); }, [option?.seriesId, option?.side]);
  // live bid / ask / greeks for the selected series (also fills them in when it was picked from the positions list)
  const { data: chain } = useOptionChain(option?.symbol);
  const live = chain?.expiries.flatMap((e) => e.rows).flatMap((r) => [r.call, r.put]).find((x) => x?.seriesId === option?.seriesId);

  if (!option) {
    return (
      <div className="tm-empty">
        <b>Pick an option</b>
        Click a <span className="up">Call/Put Ask</span> in the chain to buy, or a <span className="down">Bid</span> to sell one you hold.
      </div>
    );
  }
  const buying = option.side === 'buy';
  const n = num(contracts);
  const bid = live?.bid ?? option.bid;
  const ask = live?.ask ?? option.ask;
  const iv = live?.iv ?? option.iv;
  const delta = live?.delta ?? option.delta;
  const premium = buying ? ask : bid;
  const total = premium * n;
  const feeRate = ((buying ? fees?.optionOpenFee : fees?.optionCloseFee) ?? 0) / 10_000;
  const fee = total * feeRate;
  const breakEven = option.isCall ? option.strike + premium : option.strike - premium;
  const held = holding?.contracts ?? 0;
  const problem = !deployed ? 'Not deployed on this network'
    : !address ? 'Connect wallet'
    : n <= 0 ? 'Enter contracts'
    : !premium ? 'No price right now'
    : buying && total + fee > (account?.free ?? 0) + 1e-9 ? 'Deposit USDC to trade'
    : !buying && n > held + 1e-9 ? `You hold ${held} contracts`
    : null;

  const submit = async () => {
    if (!d || problem) return;
    setQuoteError(null);
    let q;
    try {
      q = await fetchQuote(apiUrl, network, option.seriesId, option.side, n);
    } catch (e) {
      setQuoteError((e as Error).message);
      return;
    }
    const quote = {
      seriesId: BigInt(q.quote.seriesId), isBuy: q.quote.isBuy, premium: BigInt(q.quote.premium),
      maxQty: BigInt(q.quote.maxQty), deadline: BigInt(q.quote.deadline),
    };
    const qty = toUsd6(n);
    const held = optionLabel(option.symbol, option.expiry, option.strike, option.isCall);
    await tx.run(`${buying ? 'Buy' : 'Sell'} ${held}`, [
      (w) => w.writeContract({
        address: d.optionsEngine, abi: optionsAbi, functionName: buying ? 'buy' : 'sell',
        args: [qty, quote.premium, quote, q.signature],
      }),
    ], buying
      ? {
          text: `${n} ${n === 1 ? 'contract' : 'contracts'} of ${held} now sits in your Options tab.`,
          action: { label: 'View it', run: () => goTo('options') },
        }
      : {
          text: 'Sold. The premium is back in your available collateral.',
          action: { label: 'See it in History', run: () => goTo('history') },
        });
  };

  return (
    <>
      <div className="tm-card-h" style={{ marginBottom: 6 }}>
        <span className="tm-ticket-title">{optionLabel(option.symbol, option.expiry, option.strike, option.isCall)}</span>
        <button type="button" className="tm-link" onClick={onClear}>Clear</button>
      </div>
      <div className="tm-seg" role="group" aria-label="Side">
        <button type="button" className="long" aria-pressed={buying} onClick={() => onSide('buy')}>Buy {option.isCall ? 'Call' : 'Put'}</button>
        <button type="button" className="short" aria-pressed={!buying} disabled={!held} title={held ? '' : 'You hold none of this option'} onClick={() => onSide('sell')}>Sell</button>
      </div>

      <div className="tm-label"><span>Contracts</span><span className="dim">{held ? `holding ${held}` : '1 contract = 1 share'}</span></div>
      <div className="tm-input">
        <input inputMode="decimal" value={contracts} onChange={(e) => setContracts(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Contracts" />
        <span>CONTRACTS</span>
      </div>

      <div className="tm-summary">
        <div className="tm-kv"><span>Premium / Contract</span><span className={buying ? 'up' : 'down'}>{premium ? fmtUsd(premium) : '—'}</span></div>
        <div className="tm-kv"><span>{buying ? 'Estimated Cost' : 'Estimated Proceeds'}</span><span>{fmtUsd(total)}</span></div>
        <div className="tm-kv"><span>Fee ({(feeRate * 100).toFixed(1)}% of premium)</span><span>{fmtUsd(fee)}</span></div>
        <div className="tm-kv"><span>Break Even</span><span>{fmtPrice(breakEven)}</span></div>
        {buying && <div className="tm-kv"><span>Max Loss</span><span className="down">{fmtUsd(total + fee)}</span></div>}
        {buying && <div className="tm-kv"><span>Max Profit (cap {fmtUsd(option.cap)})</span><span className="up">{fmtUsd((option.cap - premium) * n)}</span></div>}
        <div className="tm-kv"><span>IV · Delta</span><span>{(iv * 100).toFixed(1)}% · {delta.toFixed(2)}</span></div>
        <div className="tm-kv"><span>Settlement</span><span>{option.symbol === 'BABA' ? 'Chainlink' : 'Signed price'}</span></div>
      </div>
      <button type="button" className={`tm-cta ${buying ? 'long' : 'short'}`} disabled={!!problem || tx.state.stage === 'wallet' || tx.state.stage === 'confirming'} onClick={submit}>
        {problem ?? `${buying ? 'Buy' : 'Sell'} ${option.isCall ? 'Call' : 'Put'}`}
      </button>
      {quoteError && <div className="tm-note warn">{quoteError}</div>}
      <div className="tm-note">
        A fresh signed quote is fetched when you submit; the wallet shows the exact premium. Cash-settled in USDC at expiry; each contract pays at most its cap.
      </div>
    </>
  );
}

// ---------------------------------------------------------------- account

function AccountCard({ account, address, tx, deployed }: { account?: AccountState; address?: Address; tx: Tx; deployed: boolean }) {
  const { d, network } = useProtocol();
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const a = num(amount);
  const max = mode === 'deposit' ? account?.wallet ?? 0 : account?.free ?? 0;
  const busy = tx.state.stage === 'wallet' || tx.state.stage === 'confirming';

  const submit = async () => {
    if (!d || !address || a <= 0) return;
    const value = toUsd6(a);
    const approve: Step = (w) => w.writeContract({ address: d.collateralToken, abi: erc20Abi, functionName: 'approve', args: [d.vault, value] });
    const steps: Step[] = mode === 'deposit'
      ? [
          ...((account?.allowance ?? 0n) < value ? [approve] : []),
          (w) => w.writeContract({ address: d.vault, abi: vaultAbi, functionName: 'deposit', args: [value] }),
        ]
      : [(w) => w.writeContract({ address: d.vault, abi: vaultAbi, functionName: 'withdraw', args: [value] })];
    const outcome = mode === 'deposit'
      ? { text: `${fmtUsd(a)} is now available collateral. You can buy an option or open a position with it.` }
      : { text: `${fmtUsd(a)} is back in your wallet, outside the vault.` };
    if (await tx.run(`${mode === 'deposit' ? 'Deposit' : 'Withdraw'} ${fmtUsd(a)}`, steps, outcome)) setAmount('');
  };

  const faucet = () => {
    if (!d || !address) return;
    tx.run('Get 10,000 test USDC', [
      (w) => w.writeContract({ address: d.collateralToken, abi: erc20Abi, functionName: 'mint', args: [address, 10_000_000_000n] }),
    ], { text: 'Test USDC is in your wallet. Deposit some into the vault to start trading.' });
  };

  return (
    <div className="tm-card">
      <div className="tm-card-h"><span>Account</span><span className="dim" style={{ fontWeight: 500, fontSize: 12 }}>USDC</span></div>
      <div className="tm-kv"><span className="muted">Available collateral</span><span className="num">{address ? fmtUsd(account?.free ?? 0) : '—'}</span></div>
      <div className="tm-kv"><span className="muted">Locked margin</span><span className="num">{address ? fmtUsd(account?.locked ?? 0) : '—'}</span></div>
      <div className="tm-kv"><span className="muted">Wallet</span><span className="num">{address ? fmtUsd(account?.wallet ?? 0) : '—'}</span></div>
      <div className="tm-types" role="tablist" style={{ marginTop: 12 }}>
        <button type="button" role="tab" aria-selected={mode === 'deposit'} onClick={() => setMode('deposit')}>Deposit</button>
        <button type="button" role="tab" aria-selected={mode === 'withdraw'} onClick={() => setMode('withdraw')}>Withdraw</button>
      </div>
      <div className="tm-input">
        <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label={`${mode} amount`} />
        <span role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setAmount(max > 0 ? (Math.floor(max * 100) / 100).toString() : '')}>MAX</span>
      </div>
      <button type="button" className="tm-cta neutral" disabled={!deployed || !address || a <= 0 || a > max + 1e-9 || busy} onClick={submit}>
        {!deployed ? 'Not deployed' : !address ? 'Connect wallet' : a > max + 1e-9 ? 'Amount too high' : mode === 'deposit' ? 'Deposit to Vault' : 'Withdraw'}
      </button>
      {network === 'testnet' && deployed && address && (
        <button type="button" className="tm-link" style={{ marginTop: 10 }} disabled={busy} onClick={faucet}>+ Get 10,000 test USDC</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- panel

export function OrderTerminal({ symbol, product, setProduct, perp, fees, account, address, option, holding, onClearOption, onOptionSide, tx, deployed, goTo }: {
  symbol: string;
  product: Product;
  setProduct: (p: Product) => void;
  perp?: PerpMarket;
  fees?: Fees;
  account?: AccountState;
  address?: Address;
  option: SelectedOption | null;
  holding?: OptionHolding;
  onClearOption: () => void;
  onOptionSide: (side: 'buy' | 'sell') => void;
  tx: Tx;
  deployed: boolean;
  goTo: GoTo;
}) {
  return (
    <aside className="tm-right tm-col" aria-label="Order terminal">
      <div className="tm-card">
        <div className="tm-card-h"><span>Order Terminal</span><span className="dim" style={{ fontWeight: 500, fontSize: 12 }}>{symbol}</span></div>
        <div className="tm-tabs" role="tablist" style={{ padding: 0, marginBottom: 14 }}>
          <button type="button" role="tab" className="tm-tab" aria-selected={product === 'perps'} onClick={() => setProduct('perps')}>Perpetual</button>
          <button type="button" role="tab" className="tm-tab" aria-selected={product === 'options'} onClick={() => setProduct('options')}>Option</button>
        </div>
        {product === 'perps'
          ? (perp
            ? <PerpTicket perp={perp} fees={fees} account={account} address={address} tx={tx} deployed={deployed} goTo={goTo} />
            : <div className="tm-empty"><b>No perpetual for {symbol}</b>Perps need a trustless onchain price. On Robinhood Chain only BABA has one (Chainlink), so BABA-PERP is the only perpetual. Every stock still has options.</div>)
          : <OptionTicket option={option} holding={holding} fees={fees} account={account} address={address} tx={tx} deployed={deployed} goTo={goTo} onClear={onClearOption} onSide={onOptionSide} />}
      </div>
      <AccountCard account={account} address={address} tx={tx} deployed={deployed} />
    </aside>
  );
}
