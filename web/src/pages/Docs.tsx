import type { FC, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ASSETS, BOARDS, type Board } from '../data/assets';
import './Docs.css';

/* HanMarket documentation: a reading layout rather than a marketing page.
   Left: a sticky contents rail that tracks the section in view. Centre: the text.
   Every section carries its Chinese label, the way the terminal panels do. */

const SECTIONS = [
  { id: 'overview', title: 'Overview', cn: '概览' },
  { id: 'lifecycle', title: 'Option lifecycle', cn: '流程' },
  { id: 'markets', title: 'Markets & hours', cn: '市场' },
  { id: 'buying', title: 'Buying options', cn: '买入' },
  { id: 'perps', title: 'Perpetuals', cn: '永续' },
  { id: 'buying-perps', title: 'Buying perps', cn: '开仓' },
  { id: 'vault', title: 'The vault', cn: '金库' },
  { id: 'contracts', title: 'Contract addresses', cn: '合约' },
  { id: 'settlement', title: 'Settlement & liquidation', cn: '结算' },
  { id: 'fees', title: 'Fees & limits', cn: '费用' },
  { id: 'risks', title: 'Risks', cn: '风险' },
  { id: 'glossary', title: 'Glossary', cn: '术语' },
] as const;

const EASE = [0.22, 1, 0.36, 1] as const;

function Section({ id, children }: { id: string; children: ReactNode }) {
  const meta = SECTIONS.find((x) => x.id === id)!;
  return (
    <motion.section
      id={id}
      className="dx-section"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      <header className="dx-section-head">
        <span className="dx-cn" aria-hidden="true">{meta.cn}</span>
        <h2>{meta.title}</h2>
      </header>
      {children}
    </motion.section>
  );
}

const LIFECYCLE = [
  { step: 'Create', cn: '开设', who: 'Keeper', text: 'A series is opened for one asset, call or put, strike, cap and expiry. There is no order book: the vault is the counterparty from the first trade.' },
  { step: 'Buy', cn: '买入', who: 'Trader', text: 'Pays the premium in USDC to the vault, at a price it signs on request, and receives option tokens in their wallet.' },
  { step: 'Sell (optional)', cn: '卖出', who: 'Trader', text: 'Before expiry, a holder can sell tokens back to the vault at its current signed bid to exit early.' },
  { step: 'Expire', cn: '到期', who: 'Market', text: 'Trading stops at expiry, set to the exchange close.' },
  { step: 'Settle', cn: '结算', who: 'Anyone', text: 'The price at expiry, from Chainlink or the HanMarket signer, fixes the payout per contract.' },
  { step: 'Redeem', cn: '兑付', who: 'Holder', text: 'Holders redeem their payout from the vault. Unexercised value simply stays in the pool.' },
];

const GLOSSARY: [string, string][] = [
  ['Strike', 'The reference price in USD. A call pays above it, a put pays below it.'],
  ['Cap', 'The most one contract can ever pay out. The vault reserves this amount, per contract, the moment it is bought.'],
  ['Premium', 'The price a buyer pays per contract, in USDC, set by the vault’s signed quote.'],
  ['Contract', 'One option token. It gives exposure to one share of the underlying.'],
  ['Settlement price', 'The USD price used at expiry. HK prices are converted from HKD with the USD/HKD rate.'],
  ['Settlement window', 'How close to expiry an oracle price must be published to be accepted.'],
  ['Oracle grace period', 'Time after expiry before the admin may settle manually if no valid oracle price arrived.'],
  ['Leverage', 'Position size divided by the margin backing it. HanMarket perpetuals cap this per market. Every testnet market allows up to 10x today.'],
  ['Long / Short', 'A long gains when the price rises and loses when it falls; a short is the opposite. Buying a perp means opening one of the two.'],
  ['Margin', 'The USDC you post to back a perpetual position: its size divided by the leverage. It is the most that position can lose.'],
  ['Initial margin', 'The minimum equity, as a share of notional, required to open or grow a position.'],
  ['Maintenance margin', 'The equity floor below which a position becomes liquidatable.'],
  ['Funding rate', 'Paid between longs and shorts every funding interval, sized by which side has more open interest. It never leaves the vault.'],
  ['Liquidation', 'Forced closing of a position whose equity has fallen to the maintenance margin, so the vault is repaid before losses reach it.'],
  ['Max profit', 'A perpetual position’s profit is capped as a share of its entry notional, the same reasoning as an option’s cap.'],
];

/* The perp markets' live risk parameters, read from RiskManager; every testnet market uses the same ones.
   Mainnet runs perps only where Chainlink has a feed, which among China equities is BABA alone. */
const TESTNET_PERPS = ['BABA', 'PDD', 'JD', 'BIDU', 'NIO', '0700.HK', '1810.HK'];
const PERP_RISK = {
  maxLeverage: '10x', initialMargin: '10%', maintenanceMargin: '5%', maxProfit: '100% of notional',
  funding: 'Hourly, by open-interest skew', maxPositionNotional: '50,000 USDC', openInterestCap: '500,000 USDC per side',
};

/* The same parameters as numbers, for the calculator: RiskManager (maintenance margin) and FeeManager (fees) on testnet. */
const PERP_NUM = { maxLeverage: 10, maintenance: 0.05, takerFee: 0.0008, liquidationFee: 0.005, maxProfit: 1 };

const BUY_PERP_STEPS = [
  { step: 'Deposit', cn: '存入', text: 'Move USDC from your wallet into the vault. On testnet, the Account card in the terminal has a “Get 10,000 test USDC” link.' },
  { step: 'Pick a side', cn: '方向', text: 'Pick a market on the Perpetual tab (BABA-PERP, PDD-PERP, 0700.HK-PERP…). Choose Long to gain when the price rises, or Short to gain when it falls.' },
  { step: 'Size and leverage', cn: '仓位', text: 'Enter a size in shares, or 25–100% of what your collateral allows, and set the leverage. Margin is the size divided by it.' },
  { step: 'Review', cn: '核对', text: 'The ticket shows the margin, the liquidation price and the fee before you sign. The worst price you accept is set 0.5% from the index.' },
  { step: 'Sign', cn: '签名', text: 'Confirm in your wallet. The position appears under Positions (press P in the terminal), and you can close it whenever you like.' },
];

const PERP_STEPS = [
  { step: 'Open', cn: '开仓', text: 'Post margin and pick a side. Size is capped by the market’s max position and the initial margin requirement.' },
  { step: 'Add or reduce', cn: '加仓 / 减仓', text: 'Increase a position (more margin, same side) or partially close it at the current mark price at any time.' },
  { step: 'Funding', cn: '资金费', text: 'Every hour, the side with more open interest pays the other. It settles into each position’s equity, not a separate payment.' },
  { step: 'Close', cn: '平仓', text: 'Close the rest of the position whenever you choose. There is no expiry.' },
  { step: 'Liquidation', cn: '强平', text: 'If equity falls to the maintenance margin first, the keeper closes the position to repay the vault before it does.' },
];

/* Every contract HanMarket has deployed on Robinhood Chain testnet. Addresses are exactly as printed by
   contracts/script/Deploy.s.sol, and checked against the live chain before writing this page. Anyone can
   paste one into the explorer and read the same state the terminal does. */
const EXPLORER = 'https://explorer.testnet.chain.robinhood.com/address/';
const CONTRACTS: { name: string; address: `0x${string}`; text: string }[] = [
  { name: 'Vault', address: '0xD2EAEf238dC7fd327df37ec336d706D7dA18eEDC', text: 'Holds every dollar of collateral. Counterparty to every option and every perpetual.' },
  { name: 'OptionsEngine', address: '0xC99F41a39a014E4b799E3183BF5f8eD2ECE8C036', text: 'Cash-settled European calls and puts, ERC-1155 series, capped payout.' },
  { name: 'PerpsEngine', address: '0xE256Ac034dbF78460ba951b155031200d6478654', text: 'Isolated-margin perpetuals: seven markets on testnet (BABA, PDD, JD, BIDU, NIO, Tencent, Xiaomi).' },
  // One price feed per perp market. On testnet Chainlink has no equity feeds, so each is a TestnetPriceFeed the keeper
  // updates from market data; on mainnet BABA uses Chainlink's own feed.
  { name: 'Price feed · BABA', address: '0xd3C68f5aFC3e8046179e75E247fC18d92e75a5DE', text: 'Testnet feed for BABA-PERP and BABA options, updated by the keeper.' },
  { name: 'Price feed · PDD', address: '0x085D4f205dE14cb2f59da37417DD682EDEb55373', text: 'Testnet feed for PDD-PERP and PDD options.' },
  { name: 'Price feed · JD', address: '0x6E98A94691165a8F3705A5f005e4675ff0cc213b', text: 'Testnet feed for JD-PERP and JD options.' },
  { name: 'Price feed · BIDU', address: '0xF09781e074Ea67469A84b6BAf2d7bA62d5B134ac', text: 'Testnet feed for BIDU-PERP and BIDU options.' },
  { name: 'Price feed · NIO', address: '0x2C52f94f6E40f0D7116341d1A11Ae936d54217a5', text: 'Testnet feed for NIO-PERP and NIO options.' },
  { name: 'Price feed · 0700.HK', address: '0xaBDbaEf6184A8B8CF52e5A08AaecA4cfe94ff925', text: 'Testnet feed for Tencent (0700.HK-PERP and its options), in USD.' },
  { name: 'Price feed · 1810.HK', address: '0x34E74F8b3FaE45683bFe28bc949a7564E8fA2d83', text: 'Testnet feed for Xiaomi (1810.HK-PERP and its options), in USD.' },
  { name: 'OracleRouter', address: '0xBE2cb42686E78A2E6c21f77C5f10e71c5394C097', text: 'Chainlink for BABA, an EIP-712 signed price for every other listing.' },
  { name: 'MarketRegistry', address: '0x2e523c27c4686929D8F25176C2B7d934EFf959F9', text: 'Registers every tradable asset and every perpetual market.' },
  { name: 'RiskManager', address: '0x1b4bf0748F3323839a61e71fAcC4547166b32Cf6', text: 'Per-market leverage, margin, position and open-interest limits.' },
  { name: 'FeeManager', address: '0x698e84A0454182C7FD48325Ad11D67B2C35f64c8', text: 'The trading, settlement and liquidation fee schedule.' },
  { name: 'Collateral token', address: '0x2848aB87bDA098bb58CF70D1747839D95108E1f4', text: 'Testnet stand-in for USDC. Anyone can mint it, and it has no real value. Mainnet will use USDG, not this.' },
];

function ContractRow({ c }: { c: (typeof CONTRACTS)[number] }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (e.g. no permission): the address is still selectable text
    }
  };
  return (
    <div className="dx-contract">
      <div className="dx-contract-head">
        <span className="dx-contract-name">{c.name}</span>
        <div className="dx-contract-actions">
          <button type="button" onClick={copy} aria-label={`Copy ${c.name} address`}>{copied ? 'Copied' : 'Copy'}</button>
          <a href={`${EXPLORER}${c.address}`} target="_blank" rel="noreferrer">Explorer ↗</a>
        </div>
      </div>
      <code className="dx-mono dx-contract-addr">{c.address}</code>
      <p className="dx-small">{c.text}</p>
    </div>
  );
}

/* Worked payoff example. Everything in USD per contract, like the contract itself. */
function PayoffCalculator() {
  const [isCall, setIsCall] = useState(true);
  const [strike, setStrike] = useState(55);
  const [cap, setCap] = useState(10);
  const [premium, setPremium] = useState(1.8);
  const [settle, setSettle] = useState(60);

  const effCap = isCall ? cap : Math.min(cap, strike);
  const intrinsic = isCall ? Math.max(settle - strike, 0) : Math.max(strike - settle, 0);
  const payout = Math.min(intrinsic, effCap);
  const buyerPnl = payout - premium;
  const vaultPnl = premium - payout;
  const fmt = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`;

  const num = (id: string, label: string, value: number, set: (n: number) => void, step = 0.5) => (
    <label className="dx-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="number" min={0} step={step} value={value} onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))} />
    </label>
  );

  return (
    <div className="dx-calc">
      <div className="dx-calc-head">
        <span className="dx-kicker">Payoff calculator · per contract</span>
        <div className="dx-toggle" role="group" aria-label="Option type">
          <button type="button" aria-pressed={isCall} onClick={() => setIsCall(true)}>Call</button>
          <button type="button" aria-pressed={!isCall} onClick={() => setIsCall(false)}>Put</button>
        </div>
      </div>
      <div className="dx-calc-grid">
        {num('calc-strike', 'Strike (USD)', strike, setStrike)}
        {num('calc-cap', 'Cap (USD)', cap, setCap)}
        {num('calc-premium', 'Premium paid', premium, setPremium, 0.1)}
        {num('calc-settle', 'Price at expiry', settle, setSettle)}
      </div>
      <dl className="dx-calc-out">
        <div><dt>Payout</dt><dd>{fmt(payout)}</dd></div>
        <div><dt>Buyer P&amp;L</dt><dd className={buyerPnl >= 0 ? 'is-up' : 'is-down'}>{fmt(buyerPnl)}</dd></div>
        <div><dt>Vault P&amp;L</dt><dd className={vaultPnl >= 0 ? 'is-up' : 'is-down'}>{fmt(vaultPnl)}</dd></div>
        <div><dt>Vault reserves</dt><dd>{fmt(effCap)}</dd></div>
      </dl>
      {!isCall && cap > strike && <p className="dx-note">A put can never pay more than its strike, so its cap is limited to {fmt(strike)}.</p>}
    </div>
  );
}

/* Worked example of one perpetual position: the maths of the contract (MarginMath, PerpsEngine) and of the terminal's
   order ticket, so the liquidation price here is the one the ticket would show. Funding is left out: it can go either way. */
function PerpCalculator() {
  const [isLong, setIsLong] = useState(true);
  const [margin, setMargin] = useState(500);
  const [leverage, setLeverage] = useState(5);
  const [entry, setEntry] = useState(112);
  const [exit, setExit] = useState(118);

  const { maxLeverage, maintenance, takerFee, liquidationFee, maxProfit } = PERP_NUM;
  const lev = Math.min(Math.max(Math.round(leverage) || 1, 1), maxLeverage);
  const notional = margin * lev;
  const shares = entry > 0 ? notional / entry : 0;
  // equity falls to the maintenance margin at this price; a 1x long has no such price
  const liq = shares > 0
    ? isLong ? Math.max(0, (notional - margin) / (shares * (1 - maintenance))) : (notional + margin) / (shares * (1 + maintenance))
    : 0;
  const liquidated = liq > 0 && (isLong ? exit <= liq : exit >= liq);

  const openFee = notional * takerFee;
  const closeFee = shares * exit * takerFee;
  const gain = shares * (isLong ? exit - entry : entry - exit);
  // liquidated: the keeper closes at the liquidation price, so what comes back is the maintenance margin less its reward
  const liqNotional = shares * liq;
  const pnl = liquidated
    ? liqNotional * (maintenance - liquidationFee) - margin - openFee
    : Math.min(gain, notional * maxProfit) - openFee - closeFee;
  const roe = margin > 0 ? (pnl / margin) * 100 : 0;
  const fmt = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`;

  const num = (id: string, label: string, value: number, set: (n: number) => void, step = 1, max?: number) => (
    <label className="dx-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="number" min={0} max={max} step={step} value={value} onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))} />
    </label>
  );

  return (
    <div className="dx-calc">
      <div className="dx-calc-head">
        <span className="dx-kicker">Position calculator · BABA-PERP</span>
        <div className="dx-toggle" role="group" aria-label="Side">
          <button type="button" aria-pressed={isLong} onClick={() => setIsLong(true)}>Long</button>
          <button type="button" aria-pressed={!isLong} onClick={() => setIsLong(false)}>Short</button>
        </div>
      </div>
      <div className="dx-calc-grid">
        {num('perp-margin', 'Margin (USDC)', margin, setMargin, 50)}
        {num('perp-lev', `Leverage (1–${maxLeverage}x)`, leverage, (n) => setLeverage(Math.min(n, maxLeverage)), 1, maxLeverage)}
        {num('perp-entry', 'Entry price (USD)', entry, setEntry)}
        {num('perp-exit', 'Price at exit (USD)', exit, setExit)}
      </div>
      <dl className="dx-calc-out">
        <div><dt>Position size</dt><dd>{fmt(notional)}</dd></div>
        <div><dt>Liquidation price</dt><dd>{liq > 0 ? fmt(liq) : '—'}</dd></div>
        <div><dt>P&amp;L at exit</dt><dd className={pnl >= 0 ? 'is-up' : 'is-down'}>{fmt(pnl)}</dd></div>
        <div><dt>Return on margin</dt><dd className={roe >= 0 ? 'is-up' : 'is-down'}>{`${roe >= 0 ? '+' : '−'}${Math.abs(roe).toFixed(1)}%`}</dd></div>
      </dl>
      {liquidated
        ? <p className="dx-note">The price reaches {fmt(liq)} before {fmt(exit)}, so the keeper closes the position there and you keep only what is left of the margin. A price that gaps through it can cost the whole margin.</p>
        : <p className="dx-note">Includes {fmt(openFee)} to open and {fmt(closeFee)} to close (0.08% of the size each). {gain > notional * maxProfit ? 'Profit is capped at 100% of the position size. ' : ''}Funding is left out: it can be paid or received.</p>}
    </div>
  );
}

function AssetTable() {
  const [board, setBoard] = useState<Board>('HK');
  const rows = useMemo(() => ASSETS.filter((a) => a.board === board), [board]);
  return (
    <div className="dx-table-wrap">
      <div className="dx-table-tabs" role="tablist" aria-label="Exchange">
        {BOARDS.map((b) => (
          <button key={b.id} role="tab" aria-selected={board === b.id} onClick={() => setBoard(b.id)}>
            {b.id === 'HK' ? 'Hong Kong' : 'China ADR'} <span className="dx-cn-inline">{b.cn}</span>
          </button>
        ))}
      </div>
      <div className="dx-table-scroll">
        <table className="dx-table">
          <thead>
            <tr><th>Symbol</th><th>Company</th><th>Quoted in</th><th>Settlement price</th></tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.symbol}>
                <td className="dx-mono">{a.symbol}</td>
                <td><span className="dx-cn-cell">{a.cn}</span> {a.name}</td>
                <td className="dx-mono">{a.currency}</td>
                <td className="dx-mono dx-feed">{a.symbol === 'BABA' ? 'Chainlink' : TESTNET_PERPS.includes(a.symbol) ? 'Testnet feed' : 'HanMarket signer'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const Docs: FC = () => {
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Contents rail follows the section nearest the top of the viewport
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -65% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
  };

  return (
    <div className="dx-page">
      <header className="dx-hero">
        <motion.div
          className="dx-hero-inner"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <p className="dx-kicker">Documentation <span className="dx-cn-inline">文档</span></p>
          <h1>How HanMarket works</h1>
          <p className="dx-lead">
            Options and perpetuals on Hong Kong and China equities, collateralised and paid out in USDC on Robinhood
            Chain, against a single onchain vault. This guide covers the full life of a trade, from buying or
            opening a position to redeeming or closing it.
          </p>
          <ul className="dx-meta">
            <li>Protocol v0.2</li>
            <li>Robinhood Chain testnet</li>
            <li>Not yet audited</li>
          </ul>
        </motion.div>
        <motion.div
          className="dx-seal"
          aria-hidden="true"
          initial={{ opacity: 0, scale: 1.8, rotate: -14 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.45, delay: 0.5, ease: [0.5, 0, 0.75, 0] }}
        >
          漢
        </motion.div>
      </header>

      <div className="dx-layout">
        <nav className="dx-rail" aria-label="On this page">
          <p className="dx-rail-title">On this page</p>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} onClick={jump(s.id)} aria-current={active === s.id ? 'location' : undefined}>
                  <span>{s.title}</span>
                  <span className="dx-rail-cn">{s.cn}</span>
                </a>
              </li>
            ))}
          </ol>
          <Link to="/terminal" className="dx-rail-cta">Open the terminal →</Link>
        </nav>

        <main className="dx-content">
          <Section id="overview">
            <p>
              HanMarket lets you take a view on companies like Tencent, Alibaba or BYD without holding the shares,
              two ways: <strong>options</strong> (a call or a put on one stock, with a strike, a cap and an expiry)
              and, on seven of them on testnet, a <strong>perpetual</strong> (leveraged long or short, no expiry).
            </p>
            <p>
              There is no order book and no counterparty to find. A single USDC vault is the other side of every
              trade: it quotes the price, reserves the most it could ever owe before accepting the trade, and pays
              out from that same pool. Nothing is ever delivered. Options settle in cash at expiry, and perpetuals mark
              to the oracle price and can be closed at any time.
            </p>
            <div className="dx-callouts">
              <div><span className="dx-callout-k">Collateral</span><span>USDC only</span></div>
              <div><span className="dx-callout-k">Counterparty</span><span>The vault, always</span></div>
              <div><span className="dx-callout-k">Oracle</span><span>Chainlink + HanMarket signer</span></div>
              <div><span className="dx-callout-k">Options</span><span>European, capped payout</span></div>
            </div>
          </Section>

          <Section id="lifecycle">
            <p>Every option goes through the same steps. Only buying (and, optionally, selling early) need you to act before expiry.</p>
            <ol className="dx-steps">
              {LIFECYCLE.map((s, i) => (
                <motion.li
                  key={s.step}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.55, delay: i * 0.07, ease: EASE }}
                >
                  <span className="dx-step-cn" aria-hidden="true">{s.cn}</span>
                  <span className="dx-step-name">{s.step}</span>
                  <span className="dx-step-who">{s.who}</span>
                  <span className="dx-step-text">{s.text}</span>
                </motion.li>
              ))}
            </ol>
          </Section>

          <Section id="markets">
            <p>
              Two kinds of listing are supported. <strong>Hong Kong</strong> shares trade on HKEX and quote in Hong Kong
              dollars. <strong>China ADRs</strong> are the same companies listed in New York, quoting in US dollars.
              Strikes, premiums and payouts are always in USD, so HK prices are converted at the live USD/HKD rate.
            </p>
            <div className="dx-hours">
              <div>
                <span className="dx-callout-k">HKEX · Hong Kong time</span>
                <strong>09:30 – 12:00 · 13:00 – 16:00</strong>
                <span>Monday to Friday, closed for lunch</span>
              </div>
              <div>
                <span className="dx-callout-k">NYSE / NASDAQ · New York time</span>
                <strong>09:30 – 16:00</strong>
                <span>Monday to Friday</span>
              </div>
            </div>
            <p className="dx-small">Rows in the option chain are greyed out while their exchange is closed. Exchange holidays are not modelled yet.</p>
            <AssetTable />
          </Section>

          <Section id="buying">
            <p>
              Buying an option costs the premium and nothing more. You receive option tokens straight into your wallet,
              and you can hold them to expiry or send them to another wallet.
            </p>
            <ul className="dx-list">
              <li><strong>Call</strong> pays <span className="dx-formula">min(price − strike, cap)</span> when the price at expiry is above the strike.</li>
              <li><strong>Put</strong> pays <span className="dx-formula">min(strike − price, cap)</span> when the price at expiry is below the strike.</li>
              <li><strong>Maximum loss</strong> is the premium you paid. <strong>Maximum gain</strong> is the cap minus the premium.</li>
              <li>Every order sets the worst premium you accept, so the vault’s quote cannot move against you while your transaction is in flight.</li>
              <li>You can exit before expiry by selling your tokens back to the vault at its current signed bid, at any liquid strike.</li>
            </ul>
            <PayoffCalculator />
          </Section>

          <Section id="perps">
            <p>
              A perpetual needs a live onchain price. On <strong>testnet</strong> seven markets run: BABA, PDD, JD, BIDU,
              NIO, Tencent (0700.HK) and Xiaomi (1810.HK), each on a price feed the HanMarket keeper updates from market
              data. On <strong>mainnet</strong> a perp needs a Chainlink feed, and among China equities only BABA has one,
              so BABA-PERP is the one market planned for launch. Every other listing has options only.
            </p>
            <ol className="dx-steps">
              {PERP_STEPS.map((s, i) => (
                <motion.li
                  key={s.step}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.55, delay: i * 0.07, ease: EASE }}
                >
                  <span className="dx-step-cn" aria-hidden="true">{s.cn}</span>
                  <span className="dx-step-name">{s.step}</span>
                  <span className="dx-step-who">Trader</span>
                  <span className="dx-step-text">{s.text}</span>
                </motion.li>
              ))}
            </ol>
            <div className="dx-callouts">
              <div><span className="dx-callout-k">Max leverage</span><span>{PERP_RISK.maxLeverage}</span></div>
              <div><span className="dx-callout-k">Initial margin</span><span>{PERP_RISK.initialMargin} of notional</span></div>
              <div><span className="dx-callout-k">Maintenance margin</span><span>{PERP_RISK.maintenanceMargin} of notional</span></div>
              <div><span className="dx-callout-k">Max profit</span><span>{PERP_RISK.maxProfit}</span></div>
              <div><span className="dx-callout-k">Funding</span><span>{PERP_RISK.funding}</span></div>
              <div><span className="dx-callout-k">Max position</span><span>{PERP_RISK.maxPositionNotional}</span></div>
            </div>
            <p className="dx-small">
              Funding is not fixed: the side with more open interest pays the other, so it can run either
              direction. It is credited or debited to each position’s equity every interval, not sent as a
              separate transaction.
            </p>
          </Section>

          <Section id="buying-perps">
            <p>
              Buying a perp means opening a position on a perp market such as <strong>BABA-PERP</strong>: a <strong>long</strong> if you expect the
              price to rise, a <strong>short</strong> if you expect it to fall. The terminal’s button reads <em>Open Long</em> or{' '}
              <em>Open Short</em>. Unlike an option there is no premium to pay: you post margin, and the position gains or
              loses with the oracle price until you close it.
            </p>
            <ol className="dx-steps">
              {BUY_PERP_STEPS.map((s, i) => (
                <motion.li
                  key={s.step}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.55, delay: i * 0.07, ease: EASE }}
                >
                  <span className="dx-step-cn" aria-hidden="true">{s.cn}</span>
                  <span className="dx-step-name">{s.step}</span>
                  <span className="dx-step-who">Trader</span>
                  <span className="dx-step-text">{s.text}</span>
                </motion.li>
              ))}
            </ol>
            <ul className="dx-list">
              <li><strong>Long</strong> gains <span className="dx-formula">size × (price − entry)</span>; <strong>short</strong> gains <span className="dx-formula">size × (entry − price)</span>.</li>
              <li><strong>Margin</strong> is the position’s size divided by the leverage, up to {PERP_RISK.maxLeverage}. It is isolated: <strong>the most you can lose on a position is its margin</strong>, and nothing else in your account is touched.</li>
              <li><strong>Liquidation.</strong> At {PERP_RISK.maxLeverage} a long is liquidated after a fall of roughly 5% and a short after a rise of roughly 5%, a little sooner once fees and funding are counted. Lower leverage moves the liquidation price further away.</li>
              <li><strong>Maximum gain</strong> is capped at {PERP_RISK.maxProfit} at entry, the same reasoning as an option’s cap.</li>
              <li>You are filled at the <strong>oracle index price</strong>, with no order book and no spread, and the fee is {PERP_NUM.takerFee * 100}% of the size on opening and again on closing.</li>
              <li>Trading follows the New York session (Monday 04:00 to Friday 20:00). While it is closed you can add margin but not open or close.</li>
              <li>Only <strong>market</strong> orders exist today. Limit orders, stop-loss and take-profit are planned for a later phase, which is why those tabs in the ticket are greyed out.</li>
            </ul>
            <PerpCalculator />
          </Section>

          <Section id="vault">
            <p>
              There is no writer to find and no order to fill: <strong>the vault itself</strong> is the counterparty
              to every option and every perpetual, and anyone can fund it. Deposit USDC to receive <strong>hmLP</strong>,
              a share of the pool that grows as the vault collects premiums, trading fees and funding.
            </p>
            <ul className="dx-list">
              <li><strong>Deposit</strong> USDC at any time to mint hmLP at the pool’s current share price.</li>
              <li><strong>New deposits lock for 24 hours</strong> before they can be withdrawn, so a deposit cannot dodge a loss already in motion.</li>
              <li><strong>Withdrawals are capped by free liquidity</strong>, not by the pool’s total size. Free liquidity is the pool minus whatever is reserved for open options and perpetuals.</li>
              <li><strong>hmLP is not principal-protected.</strong> Its share price falls if traders are net profitable over a period, the same way it rises when the vault collects more in premiums and fees than it pays out.</li>
            </ul>
          </Section>

          <Section id="contracts">
            <p>
              Every contract above is deployed and verifiable. Paste an address into the explorer to read the
              same state the terminal does. This is <strong>testnet</strong>: the addresses below will change once
              the audited version deploys to mainnet.
            </p>
            <div className="dx-contracts">
              {CONTRACTS.map((c) => <ContractRow key={c.address} c={c} />)}
            </div>
          </Section>

          <Section id="settlement">
            <p>
              Expiry is set to the exchange close. A HanMarket keeper settles every expired option market automatically,
              so you normally only need to redeem. How the price is fixed depends on the stock:
            </p>
            <ul className="dx-list">
              <li><strong>Alibaba (BABA)</strong> uses Chainlink’s <em>Robinhood BABA / USD</em> feed. The contract only accepts the last feed round published before expiry, so the price cannot be picked or changed. Anyone can submit it.</li>
              <li><strong>On testnet</strong>, the six other stocks with a perp market (PDD, JD, BIDU, NIO, Tencent, Xiaomi) settle from their testnet feed in the same way, and so does BABA, since Chainlink has no testnet equity feeds.</li>
              <li><strong>Every other stock</strong> has no onchain feed on Robinhood Chain yet. It settles with a price signed by the HanMarket price signer, taken from market data at the exchange close (HK prices converted at USD/HKD). The contract checks the signature and the timing, but you are trusting that price.</li>
              <li>Each market in the terminal is labelled <strong>Chainlink</strong> or <strong>HanMarket</strong> so you know which applies before you trade.</li>
              <li>If no valid price exists (a feed outage or an exchange holiday), the admin may settle manually, but only after the market’s <strong>oracle grace period</strong>. Manual settlements are marked on-chain.</li>
              <li>Settlement is final and happens once. Redeeming has no deadline.</li>
            </ul>
            <p>
              A perpetual has no settlement or expiry. It has <strong>liquidation</strong> instead. The keeper checks
              every open position against the oracle price; once equity reaches the maintenance margin, it force-closes
              the position at the current price so the loss stops before it can exceed the margin posted.
            </p>
          </Section>

          <Section id="fees">
            <div className="dx-table-scroll">
              <table className="dx-table">
                <tbody>
                  <tr><th scope="row">Opening an option</th><td>1% of the premium, paid to the treasury and the vault.</td></tr>
                  <tr><th scope="row">Closing an option</th><td>1% of the premium, whether by selling early or redeeming at settlement.</td></tr>
                  <tr><th scope="row">Perpetual trading</th><td>0.08% of notional per trade, on every perp market.</td></tr>
                  <tr><th scope="row">Liquidation</th><td>0.5% of notional, to whoever calls the liquidation.</td></tr>
                  <tr><th scope="row">Depositing to the vault</th><td>No fee. You only pay gas, plus a one-time USDC approval the first time you trade.</td></tr>
                  <tr><th scope="row">Network fees</th><td>Paid in ETH on Robinhood Chain, usually a fraction of a cent per transaction.</td></tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="risks">
            <ul className="dx-list dx-risks">
              <li><strong>Unaudited code.</strong> The contract has not had an external audit. Use testnet funds only.</li>
              <li><strong>Price risk.</strong> Alibaba relies on Chainlink; every other stock relies on the HanMarket price signer. A wrong or missing price affects every holder of that market.</li>
              <li><strong>Admin fallback.</strong> If the oracle fails, a manual settlement price is trusted after the grace period.</li>
              <li><strong>Leverage and liquidation.</strong> A leveraged perpetual can be liquidated for its full margin if the price moves against it far enough, even briefly.</li>
              <li><strong>Vault risk, for depositors.</strong> hmLP’s value falls if traders are net profitable over a period, because a liquidity provider is the counterparty to every winning trade.</li>
              <li><strong>Not shares.</strong> Options and perpetuals give no ownership, dividends or voting rights in the company.</li>
              <li><strong>Restricted regions.</strong> Not offered to persons in the United States, mainland China or Hong Kong.</li>
            </ul>
          </Section>

          <Section id="glossary">
            <dl className="dx-glossary">
              {GLOSSARY.map(([term, def]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{def}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <motion.div
            className="dx-end"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            <div>
              <h3>Ready to place a trade?</h3>
              <p>Connect a wallet on Robinhood Chain testnet and pick a market.</p>
            </div>
            <Link to="/terminal" className="dx-btn">Open the terminal →</Link>
          </motion.div>
        </main>
      </div>
    </div>
  );
};
