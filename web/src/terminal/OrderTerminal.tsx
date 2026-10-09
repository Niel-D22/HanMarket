import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { useNetwork } from '../contexts/NetworkContext';
import { erc20Abi, optionsAbi, perpsAbi, vaultAbi } from '../../api/_lib/protocol/abis';
import { fetchQuote, useOptionChain, type SelectedOption } from './options';
import {
  SOURCE_KEY, fmtPrice, fmtUsd, optionLabel, priceSource, toUsd6, useCollateralSymbol, useProtocol,
  type AccountState, type Fees, type OptionHolding, type PerpMarket, type Step, type useTx,
} from './protocol';
import type { Product } from './Chrome';
import { rich, useT } from '../i18n';

type Tx = ReturnType<typeof useTx>;
/** Opens the bottom panel that holds a finished transaction's result. */
export type GoTo = (tab: 'positions' | 'options' | 'history') => void;
const SLIPPAGE = 0.005; // perps fill at the oracle price; this only guards against a price update in between
const MARGIN_BUFFER = 0.001; // USDC added to a perp order's margin so rounding cannot land it below max leverage's requirement
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
  const t = useT();
  const unit = useCollateralSymbol();
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
  // The order is sized in floating point and rounded to micro-USDC, while the contract floors its fee and needs
  // notional <= margin x maxLeverage. At exactly max leverage that leaves the margin a micro-USDC short in about
  // 4 orders out of 10 (measured in Perps.t.sol), so a tenth of a cent goes on top of it. It stays in the position.
  const required = margin + fee + (shares > 0 ? MARGIN_BUFFER : 0);
  const free = account?.free ?? 0;
  const maxShares = price > 0 ? (Math.max(0, free - MARGIN_BUFFER) * lev) / (price * (1 + lev * feeRate)) : 0;
  const mm = (perp?.risk.maintenanceMarginBps ?? 1000) / 10_000;
  const liq = shares > 0 && price > 0
    ? isLong ? Math.max(0, (notional - margin) / (shares * (1 - mm))) : (margin + notional) / (shares * (1 + mm))
    : 0;
  const limitNotional = perp ? Number(perp.risk.maxPositionNotional) / 1e6 : 0;

  const problem = !deployed ? t('tm.notDeployed')
    : !perp ? t('tm.noPerpMarket')
    : !address ? t('tm.connectWallet')
    : !perp.tradingOpen ? t('tm.marketClosed')
    : shares <= 0 ? t('tm.enterSize')
    : notional > limitNotional ? t('tm.maxPosition', { amount: fmtUsd(limitNotional, 0) })
    : required > free + 1e-9 ? t('tm.depositToTrade', { unit })
    : null;

  const submit = async () => {
    if (!perp || !d || problem) return;
    const acceptable = toUsd6(isLong ? price * (1 + SLIPPAGE) : price * (1 - SLIPPAGE));
    const ok = await tx.run(t('tm.txPerp', { side: t(isLong ? 'tm.long' : 'tm.short'), symbol: perp.symbol, lev }), [
      (w) => w.writeContract({
        address: d.perpsEngine, abi: perpsAbi, functionName: 'increasePosition',
        args: [perp.id, isLong, toUsd6(required), toUsd6(notional), acceptable, deadline()],
      }),
    ], {
      text: t('tm.outPerp', { side: t(isLong ? 'tm.longLc' : 'tm.shortLc'), symbol: perp.symbol }),
      action: { label: t('tm.viewPosition'), run: () => goTo('positions') },
    });
    if (ok) setSize('');
  };

  const marks = Array.from(new Set([1, 2, 3, 5, 10, 20].filter((m) => m <= maxLev).concat(maxLev))).sort((a, b) => a - b);

  return (
    <>
      <div className="tm-seg" role="group" aria-label={t('tm.side')}>
        <button type="button" className="long" aria-pressed={isLong} onClick={() => setIsLong(true)}>{t('tm.long')}</button>
        <button type="button" className="short" aria-pressed={!isLong} onClick={() => setIsLong(false)}>{t('tm.short')}</button>
      </div>
      <div className="tm-types" role="tablist">
        <button type="button" role="tab" aria-selected="true">{t('tm.marketOrder')}</button>
        <button type="button" role="tab" aria-selected="false" disabled title={t('tm.limitSoon')}>{t('tm.limit')}</button>
        <button type="button" role="tab" aria-selected="false" disabled title={t('tm.advancedSoon')}>{t('tm.advanced')}</button>
      </div>

      <div className="tm-label"><span>{t('tm.orderSize', { asset: perp?.assetSymbol ?? '—' })}</span><span>≈ {fmtUsd(notional)}</span></div>
      <div className="tm-input">
        <input inputMode="decimal" placeholder="0.00" value={size} onChange={(e) => setSize(e.target.value.replace(/[^0-9.]/g, ''))} aria-label={t('tm.orderSizeAria')} />
        <span>{perp?.assetSymbol ?? '—'}</span>
      </div>
      <div className="tm-pcts">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <button key={f} type="button" onClick={() => setSize(maxShares > 0 ? (Math.floor(maxShares * f * 1e4) / 1e4).toString() : '')}>{f * 100}%</button>
        ))}
      </div>

      <div className="tm-label"><span>{t('tm.leverage')}</span><span className="dim">{t('tm.maxX', { x: maxLev })}</span></div>
      <div className="tm-lev">
        <input type="range" min={1} max={maxLev} step={0.5} value={lev} onChange={(e) => setLev(Number(e.target.value))} aria-label={t('tm.leverage')} />
        <b>{lev}x</b>
      </div>
      <div className="tm-lev-marks">{marks.map((m) => <button key={m} type="button" onClick={() => setLev(m)}>{m}x</button>)}</div>

      <div className="tm-summary">
        <div className="tm-kv"><span>{t('tm.estValue')}</span><span>{fmtUsd(notional)}</span></div>
        <div className="tm-kv"><span>{t('tm.estEntry')}</span><span>{fmtPrice(price)}</span></div>
        <div className="tm-kv"><span>{t('tm.reqCollateral')}</span><span className="gold">{fmtUsd(margin)}</span></div>
        <div className="tm-kv"><span>{t('tm.liquidationPrice')}</span><span>{liq > 0 ? fmtPrice(liq) : '—'}</span></div>
        <div className="tm-kv"><span>{t('tm.tradingFee', { pct: (feeRate * 100).toFixed(2) })}</span><span>{fmtUsd(fee)}</span></div>
        <div className="tm-kv"><span>{t('tm.fundingPer', { h: perp ? perp.risk.fundingInterval / 3600 : 1 })}</span><span>{perp ? `${(perp.fundingRate * 100).toFixed(4)}%` : '—'}</span></div>
        <div className="tm-kv"><span>{t('tm.availableCollateral')}</span><span>{fmtUsd(free)}</span></div>
      </div>
      <button type="button" className={`tm-cta ${isLong ? 'long' : 'short'}`} disabled={!!problem || tx.state.stage === 'wallet' || tx.state.stage === 'confirming'} onClick={submit}>
        {/* a perpetual is opened long or short, never "bought". That word belongs to the options ticket,
            where "Buy Call / Buy Put" means something specific. Mixing them here ("Buy / Long") reads as
            if a perpetual position is purchased like an option, which it isn't. */}
        {problem ?? t('tm.openSide', { side: t(isLong ? 'tm.long' : 'tm.short'), asset: perp?.assetSymbol ?? '' })}
      </button>
      <div className="tm-note">
        {t('tm.perpNote', { unit })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- option ticket

function OptionTicket({ option, holding, fees, account, address, tx, deployed, goTo, onClear, onSide, hasFeed }: {
  option: SelectedOption | null;
  /** the asset has a live onchain feed (it has a perp market), so its options settle from that feed */
  hasFeed: boolean;
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
  const t = useT();
  const unit = useCollateralSymbol();
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
        <b>{t('tm.pickOption')}</b>
        {rich(t('tm.pickOptionBody'), { up: (s) => <span className="up">{s}</span>, down: (s) => <span className="down">{s}</span> })}
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
  const problem = !deployed ? t('tm.notDeployed')
    : !address ? t('tm.connectWallet')
    : n <= 0 ? t('tm.enterContracts')
    : !premium ? t('tm.noPrice')
    : buying && total + fee > (account?.free ?? 0) + 1e-9 ? t('tm.depositToTrade', { unit })
    : !buying && n > held + 1e-9 ? t('tm.youHold', { n: held })
    : null;
  const type = t(option.isCall ? 'tm.call' : 'tm.put');

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
    await tx.run(t('tm.txOption', { action: t(buying ? 'tm.buy' : 'tm.sell'), label: held }), [
      (w) => w.writeContract({
        address: d.optionsEngine, abi: optionsAbi, functionName: buying ? 'buy' : 'sell',
        args: [qty, quote.premium, quote, q.signature],
      }),
    ], buying
      ? {
          text: t('tm.outBuy', { label: held, n }),
          action: { label: t('tm.viewIt'), run: () => goTo('options') },
        }
      : {
          text: t('tm.outSell'),
          action: { label: t('tm.seeHistory'), run: () => goTo('history') },
        });
  };

  return (
    <>
      <div className="tm-card-h" style={{ marginBottom: 6 }}>
        <span className="tm-ticket-title">{optionLabel(option.symbol, option.expiry, option.strike, option.isCall)}</span>
        <button type="button" className="tm-link" onClick={onClear}>{t('tm.clear')}</button>
      </div>
      <div className="tm-seg" role="group" aria-label={t('tm.side')}>
        <button type="button" className="long" aria-pressed={buying} onClick={() => onSide('buy')}>{t('tm.buyType', { type })}</button>
        <button type="button" className="short" aria-pressed={!buying} disabled={!held} title={held ? '' : t('tm.holdNone')} onClick={() => onSide('sell')}>{t('tm.sell')}</button>
      </div>

      <div className="tm-label"><span>{t('tm.contracts')}</span><span className="dim">{held ? t('tm.holding', { n: held }) : t('tm.oneContract')}</span></div>
      <div className="tm-input">
        <input inputMode="decimal" value={contracts} onChange={(e) => setContracts(e.target.value.replace(/[^0-9.]/g, ''))} aria-label={t('tm.contracts')} />
        <span>{t('tm.CONTRACTS')}</span>
      </div>

      <div className="tm-summary">
        <div className="tm-kv"><span>{t('tm.premiumPer')}</span><span className={buying ? 'up' : 'down'}>{premium ? fmtUsd(premium) : '—'}</span></div>
        <div className="tm-kv"><span>{t(buying ? 'tm.estCost' : 'tm.estProceeds')}</span><span>{fmtUsd(total)}</span></div>
        <div className="tm-kv"><span>{t('tm.feeOfPremium', { pct: (feeRate * 100).toFixed(1) })}</span><span>{fmtUsd(fee)}</span></div>
        <div className="tm-kv"><span>{t('tm.breakEven')}</span><span>{fmtPrice(breakEven)}</span></div>
        {buying && <div className="tm-kv"><span>{t('tm.maxLoss')}</span><span className="down">{fmtUsd(total + fee)}</span></div>}
        {buying && <div className="tm-kv"><span>{t('tm.maxProfitCap', { cap: fmtUsd(option.cap) })}</span><span className="up">{fmtUsd((option.cap - premium) * n)}</span></div>}
        <div className="tm-kv"><span>{t('tm.ivDelta')}</span><span>{(iv * 100).toFixed(1)}% · {delta.toFixed(2)}</span></div>
        <div className="tm-kv"><span>{t('tm.settlement')}</span><span>{t(SOURCE_KEY[priceSource(network, hasFeed)])}</span></div>
      </div>
      <button type="button" className={`tm-cta ${buying ? 'long' : 'short'}`} disabled={!!problem || tx.state.stage === 'wallet' || tx.state.stage === 'confirming'} onClick={submit}>
        {problem ?? t(buying ? 'tm.buyType' : 'tm.sellType', { type })}
      </button>
      {quoteError && <div className="tm-note warn">{quoteError}</div>}
      <div className="tm-note">
        {t('tm.optionNote', { unit })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- account

function AccountCard({ account, address, tx, deployed }: { account?: AccountState; address?: Address; tx: Tx; deployed: boolean }) {
  const t = useT();
  const unit = useCollateralSymbol();
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
      ? { text: t('tm.outDeposit', { amount: fmtUsd(a) }) }
      : { text: t('tm.outWithdraw', { amount: fmtUsd(a) }) };
    if (await tx.run(t(mode === 'deposit' ? 'tm.txDeposit' : 'tm.txWithdraw', { amount: fmtUsd(a) }), steps, outcome)) setAmount('');
  };

  const faucet = () => {
    if (!d || !address) return;
    tx.run(t('tm.faucetTx'), [
      (w) => w.writeContract({ address: d.collateralToken, abi: erc20Abi, functionName: 'mint', args: [address, 10_000_000_000n] }),
    ], { text: t('tm.faucetOut') });
  };

  return (
    <div className="tm-card">
      <div className="tm-card-h"><span>{t('tm.account')}</span><span className="dim" style={{ fontWeight: 500, fontSize: 12 }}>{unit}</span></div>
      <div className="tm-kv"><span className="muted">{t('tm.availableLc')}</span><span className="num">{address ? fmtUsd(account?.free ?? 0) : '—'}</span></div>
      <div className="tm-kv"><span className="muted">{t('tm.lockedLc')}</span><span className="num">{address ? fmtUsd(account?.locked ?? 0) : '—'}</span></div>
      <div className="tm-kv"><span className="muted">{t('tm.wallet')}</span><span className="num">{address ? fmtUsd(account?.wallet ?? 0) : '—'}</span></div>
      <div className="tm-types" role="tablist" style={{ marginTop: 12 }}>
        <button type="button" role="tab" aria-selected={mode === 'deposit'} onClick={() => setMode('deposit')}>{t('tm.deposit')}</button>
        <button type="button" role="tab" aria-selected={mode === 'withdraw'} onClick={() => setMode('withdraw')}>{t('tm.withdraw')}</button>
      </div>
      <div className="tm-input">
        <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label={t(mode === 'deposit' ? 'tm.depositAmount' : 'tm.withdrawAmount')} />
        <span role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setAmount(max > 0 ? (Math.floor(max * 100) / 100).toString() : '')}>{t('tm.max')}</span>
      </div>
      <button type="button" className="tm-cta neutral" disabled={!deployed || !address || a <= 0 || a > max + 1e-9 || busy} onClick={submit}>
        {t(!deployed ? 'tm.notDeployedShort' : !address ? 'tm.connectWallet' : a > max + 1e-9 ? 'tm.amountTooHigh' : mode === 'deposit' ? 'tm.depositToVault' : 'tm.withdraw')}
      </button>
      {network === 'testnet' && deployed && (address
        ? <button type="button" className="tm-link" style={{ marginTop: 10 }} disabled={busy} onClick={faucet}>{t('tm.faucetBtn')}</button>
        : <div className="tm-note">{t('tm.faucetConnect')}</div>)}
    </div>
  );
}

// ---------------------------------------------------------------- panel

export function OrderTerminal({ symbol, product, setProduct, perp, perpsLoaded, fees, account, address, option, holding, onClearOption, onOptionSide, tx, deployed, goTo }: {
  symbol: string;
  /** the perp market list has arrived; until then a missing `perp` means "not loaded yet", not "none" */
  perpsLoaded: boolean;
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
  const t = useT();
  return (
    <aside className="tm-right tm-col" aria-label={t('tm.orderTerminal')}>
      <div className="tm-card">
        <div className="tm-card-h"><span>{t('tm.orderTerminal')}</span><span className="dim" style={{ fontWeight: 500, fontSize: 12 }}>{symbol}</span></div>
        <div className="tm-tabs" role="tablist" style={{ padding: 0, marginBottom: 14 }}>
          <button type="button" role="tab" className="tm-tab" aria-selected={product === 'perps'} onClick={() => setProduct('perps')}>{t('tm.perpetual')}</button>
          <button type="button" role="tab" className="tm-tab" aria-selected={product === 'options'} onClick={() => setProduct('options')}>{t('tm.option')}</button>
        </div>
        {product === 'perps'
          ? (perp
            ? <PerpTicket perp={perp} fees={fees} account={account} address={address} tx={tx} deployed={deployed} goTo={goTo} />
            : !perpsLoaded && deployed
            ? <div className="tm-empty"><b>{t('tm.loadingMarkets')}</b></div>
            : <div className="tm-empty"><b>{t('tm.noPerpFor', { symbol })}</b>{t('tm.noPerpBody')}</div>)
          : <OptionTicket option={option} holding={holding} fees={fees} account={account} address={address} tx={tx} deployed={deployed} goTo={goTo} onClear={onClearOption} onSide={onOptionSide} hasFeed={!!perp} />}
      </div>
      <AccountCard account={account} address={address} tx={tx} deployed={deployed} />
    </aside>
  );
}
