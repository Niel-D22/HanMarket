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
  { id: 'writing', title: 'Writing options', cn: '卖出' },
  { id: 'settlement', title: 'Settlement', cn: '结算' },
  { id: 'fees', title: 'Fees & limits', cn: '费用' },
  { id: 'risks', title: 'Risks', cn: '风险' },
  { id: 'glossary', title: 'Glossary', cn: '术语' },
] as const;

const EASE = [0.22, 1, 0.36, 1] as const;

function Section({ id, index, children }: { id: string; index: number; children: ReactNode }) {
  const meta = SECTIONS[index];
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
  { step: 'Create', cn: '开设', who: 'Protocol', text: 'A market is opened for one asset, call or put, strike, cap and expiry.' },
  { step: 'Write', cn: '卖出', who: 'Writer', text: 'Locks USDC equal to the cap per contract and sets an ask price.' },
  { step: 'Buy', cn: '买入', who: 'Trader', text: 'Pays the premium in USDC and receives option tokens in their wallet.' },
  { step: 'Expire', cn: '到期', who: 'Market', text: 'Trading stops at expiry, set to the exchange close.' },
  { step: 'Settle', cn: '结算', who: 'Anyone', text: 'The price at expiry, from Chainlink or the HanMarket signer, fixes the payout per contract.' },
  { step: 'Redeem', cn: '兑付', who: 'Both sides', text: 'Holders redeem the payout; writers claim back the rest of their collateral.' },
];

const GLOSSARY: [string, string][] = [
  ['Strike', 'The reference price in USD. A call pays above it, a put pays below it.'],
  ['Cap', 'The most one contract can ever pay out. It is also the USDC a writer locks per contract.'],
  ['Premium', 'The price a buyer pays per contract, in USDC, set by the writer’s ask.'],
  ['Contract', 'One option token. It gives exposure to one share of the underlying.'],
  ['Settlement price', 'The USD price used at expiry. HK prices are converted from HKD with the USD/HKD rate.'],
  ['Settlement window', 'How close to expiry an oracle price must be published to be accepted.'],
  ['Oracle grace period', 'Time after expiry before the admin may settle manually if no valid oracle price arrived.'],
  ['Writer position', 'A writer’s record for one market: contracts minted and sold, and collateral locked.'],
];

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
  const writerPnl = premium - payout;
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
        <div><dt>Writer P&amp;L</dt><dd className={writerPnl >= 0 ? 'is-up' : 'is-down'}>{fmt(writerPnl)}</dd></div>
        <div><dt>Collateral locked</dt><dd>{fmt(effCap)}</dd></div>
      </dl>
      {!isCall && cap > strike && <p className="dx-note">A put can never pay more than its strike, so its cap is limited to {fmt(strike)}.</p>}
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
                <td className="dx-mono dx-feed">{a.symbol === 'BABA' ? 'Chainlink' : 'HanMarket signer'}</td>
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
            Cash-settled options on Hong Kong and China equities, collateralised and paid out in USDC on Robinhood Chain.
            This guide covers the full life of a trade, from writing a contract to redeeming it after expiry.
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
          <Section id="overview" index={0}>
            <p>
              HanMarket lets you take a view on companies like Tencent, Alibaba or BYD without holding the shares.
              Each market is a <strong>call</strong> or a <strong>put</strong> on one stock, with a strike price, a cap and an expiry.
            </p>
            <p>
              Nothing is ever delivered. When the option expires, the market settles on the stock price at expiry
              and pays the difference in USDC. Every contract is backed in full by collateral a writer
              locked when the option was created, so payouts never depend on anyone paying later.
            </p>
            <div className="dx-callouts">
              <div><span className="dx-callout-k">Collateral</span><span>USDC only</span></div>
              <div><span className="dx-callout-k">Settlement</span><span>Cash, at expiry</span></div>
              <div><span className="dx-callout-k">Oracle</span><span>Chainlink + HanMarket signer</span></div>
              <div><span className="dx-callout-k">Style</span><span>European, capped</span></div>
            </div>
          </Section>

          <Section id="lifecycle" index={1}>
            <p>Every option goes through the same six steps. Only buying and writing need you to act before expiry.</p>
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

          <Section id="markets" index={2}>
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

          <Section id="buying" index={3}>
            <p>
              Buying an option costs the premium and nothing more. You receive option tokens straight into your wallet,
              and you can hold them to expiry or send them to another wallet.
            </p>
            <ul className="dx-list">
              <li><strong>Call</strong> pays <span className="dx-formula">min(price − strike, cap)</span> when the price at expiry is above the strike.</li>
              <li><strong>Put</strong> pays <span className="dx-formula">min(strike − price, cap)</span> when the price at expiry is below the strike.</li>
              <li><strong>Maximum loss</strong> is the premium you paid. <strong>Maximum gain</strong> is the cap minus the premium.</li>
              <li>Every order sets the highest premium you accept, so a writer cannot raise the price while your transaction is in flight.</li>
            </ul>
            <PayoffCalculator />
          </Section>

          <Section id="writing" index={4}>
            <p>
              Writers supply the options and earn the premium. To write, you lock the cap in USDC for each contract
              and choose your ask. Options you have written sit in an escrow until someone buys them.
            </p>
            <ul className="dx-list">
              <li><strong>Collateral:</strong> contracts × cap, rounded up to the nearest micro-USDC.</li>
              <li><strong>Premium:</strong> paid to your wallet the moment a buyer fills your ask, minus the protocol fee.</li>
              <li><strong>Change your ask</strong> at any time before settlement.</li>
              <li><strong>Cancel unsold contracts</strong> to burn them and take their collateral back straight away.</li>
              <li><strong>After settlement</strong>, claim what is left: your collateral minus the payout owed on the contracts you sold.</li>
            </ul>
            <div className="dx-example">
              <span className="dx-kicker">Example</span>
              <p>
                You write 10 Tencent calls with a $55 strike and a $10 cap, asking $1.80. You lock <strong>$100</strong>.
                A buyer takes all 10 and you receive <strong>$18</strong> less the fee. Tencent settles at $60, so each
                contract pays $5: holders redeem <strong>$50</strong> and you claim back the other <strong>$50</strong>.
              </p>
            </div>
          </Section>

          <Section id="settlement" index={5}>
            <p>
              Expiry is set to the exchange close. A HanMarket keeper settles every expired market automatically, so you
              normally only need to redeem or claim. How the price is fixed depends on the stock:
            </p>
            <ul className="dx-list">
              <li><strong>Alibaba (BABA)</strong> uses Chainlink’s <em>Robinhood BABA / USD</em> feed. The contract only accepts the last feed round published before expiry, so the price cannot be picked or changed. Anyone can submit it.</li>
              <li><strong>Every other stock</strong> has no onchain feed on Robinhood Chain yet. It settles with a price signed by the HanMarket price signer, taken from market data at the exchange close (HK prices converted at USD/HKD). The contract checks the signature and the timing, but you are trusting that price.</li>
              <li>Each market in the terminal is labelled <strong>Chainlink</strong> or <strong>HanMarket</strong> so you know which applies before you trade.</li>
              <li>If no valid price exists (a feed outage or an exchange holiday), the admin may settle manually, but only after the market’s <strong>oracle grace period</strong>. Manual settlements are marked on-chain.</li>
              <li>Settlement is final and happens once. Redeeming and claiming have no deadline.</li>
            </ul>
          </Section>

          <Section id="fees" index={6}>
            <div className="dx-table-scroll">
              <table className="dx-table">
                <tbody>
                  <tr><th scope="row">Trading fee</th><td>A share of each premium, paid by the buyer to the treasury. Set by the protocol, capped at 5%.</td></tr>
                  <tr><th scope="row">Writing</th><td>No fee. You only pay gas, plus a one-time USDC approval the first time you trade.</td></tr>
                  <tr><th scope="row">Redeeming &amp; claiming</th><td>No fee beyond gas.</td></tr>
                  <tr><th scope="row">Network fees</th><td>Paid in ETH on Robinhood Chain, usually a fraction of a cent per transaction.</td></tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="risks" index={7}>
            <ul className="dx-list dx-risks">
              <li><strong>Unaudited code.</strong> The contract has not had an external audit. Use testnet funds only.</li>
              <li><strong>Price risk.</strong> Alibaba relies on Chainlink; every other stock relies on the HanMarket price signer. A wrong or missing price affects every holder of that market.</li>
              <li><strong>Admin fallback.</strong> If the oracle fails, a manual settlement price is trusted after the grace period.</li>
              <li><strong>No early exit.</strong> Options settle at expiry. Before then you can only sell by transferring tokens to someone else.</li>
              <li><strong>Not shares.</strong> Options give no ownership, dividends or voting rights in the company.</li>
              <li><strong>Restricted regions.</strong> Not offered to persons in the United States, mainland China or Hong Kong.</li>
            </ul>
          </Section>

          <Section id="glossary" index={8}>
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
