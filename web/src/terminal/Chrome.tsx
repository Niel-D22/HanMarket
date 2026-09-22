import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ASSETS, type ChinaAsset } from '../data/assets';
import type { Quote } from '../hooks/usePrices';
import type { NetworkKey } from '../contexts/NetworkContext';
import type { PerpMarket } from './protocol';
import { fmtPrice } from './protocol';
import { ThemeToggle } from '../theme/ThemeProvider';
import { IconDocs, IconMarkets, IconMenu, IconPortfolio, IconSearch, IconTrade, IconVault, IconWallet } from './icons';

export type View = 'trade' | 'markets' | 'portfolio' | 'vault';
export type Product = 'options' | 'perps';

const change = (q?: Quote) => q?.change24h ?? 0;
const Change = ({ q }: { q?: Quote }) => {
  const c = change(q);
  return <span className={c >= 0 ? 'up' : 'down'}>{q ? `${c >= 0 ? '▲' : '▼'} ${c >= 0 ? '+' : ''}${c.toFixed(2)}%` : '—'}</span>;
};

// ---------------------------------------------------------------- top bar

export function TopBar({ network, setNetwork, onSelect, onMenu }: {
  network: NetworkKey;
  setNetwork: (n: NetworkKey) => void;
  onSelect: (symbol: string) => void;
  onMenu: () => void;
}) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return ASSETS.filter((a) => [a.symbol, a.name, a.cn].some((s) => s.toLowerCase().includes(t))).slice(0, 8);
  }, [q]);

  return (
    <header className="tm-top">
      <button type="button" className="tm-menu-btn" aria-label="Open menu" onClick={onMenu}><IconMenu /></button>
      <Link to="/" className="tm-brand" aria-label="HanMarket home">
        <img src="/brand/hanmarket-mark.png" alt="" width={26} height={26} />
        <span>HANMARKET</span>
      </Link>
      <div className="tm-search">
        <IconSearch />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { onSelect(results[0].symbol); setQ(''); } if (e.key === 'Escape') setQ(''); }}
          placeholder="Search markets: Tencent, 0700, BABA, 比亚迪…"
          aria-label="Search markets"
        />
        {results.length > 0 && (
          <div className="tm-search-results" role="listbox">
            {results.map((a) => (
              <button key={a.symbol} type="button" role="option" aria-selected="false" onClick={() => { onSelect(a.symbol); setQ(''); }}>
                <span><b>{a.symbol}</b> <span className="muted">{a.name}</span></span>
                <span className="cn muted">{a.cn}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="tm-top-right">
        <ThemeToggle className="theme-toggle tm-theme" />
        <div className="tm-net" role="group" aria-label="Network">
          {(['mainnet', 'testnet'] as const).map((n) => (
            <button key={n} type="button" aria-pressed={network === n} onClick={() => setNetwork(n)}>
              {n === 'mainnet' ? 'Mainnet' : 'Testnet'}
            </button>
          ))}
        </div>
        <ConnectButton.Custom>
          {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
            const label = !mounted || !account ? 'Connect Wallet' : chain?.unsupported ? 'Wrong network' : account.displayName;
            const onClick = !account ? openConnectModal : chain?.unsupported ? openChainModal : openAccountModal;
            return (
              <button type="button" className={`tm-wallet ${account ? 'is-connected' : ''}`} onClick={onClick} aria-hidden={!mounted}>
                <IconWallet /> {label}
              </button>
            );
          }}
        </ConnectButton.Custom>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- sidebar

const WATCHLIST = ['BABA', '0700.HK', '9988.HK', '1810.HK', '1211.HK', 'PDD'];

export function Sidebar({ view, setView, symbol, product, onSelect, quotes, perps, open, onClose }: {
  view: View;
  setView: (v: View) => void;
  symbol: string;
  product: Product;
  onSelect: (symbol: string, product?: Product) => void;
  quotes: Record<string, Quote>;
  perps: PerpMarket[] | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Product>(product);
  const nav: { id: View; label: string; icon: ReactElement; badge?: string }[] = [
    { id: 'trade', label: 'Trade', icon: <IconTrade /> },
    { id: 'markets', label: 'Markets', icon: <IconMarkets /> },
    { id: 'portfolio', label: 'Portfolio', icon: <IconPortfolio /> },
    { id: 'vault', label: 'Vault', icon: <IconVault />, badge: 'LP' },
  ];
  const go = (v: View) => { setView(v); onClose(); };
  const pick = (s: string, p?: Product) => { onSelect(s, p); onClose(); };
  const assetRow = (a: ChinaAsset, current: boolean, p?: Product, label?: string) => (
    <button key={`${a.symbol}-${p ?? ''}`} type="button" className="tm-row-btn" aria-current={current} onClick={() => pick(a.symbol, p)}>
      <span>
        <div className="t1">{label ?? a.symbol}</div>
        <div className="t2"><span className="cn">{a.cn}</span> · {a.name}</div>
      </span>
      <span>
        <div className="r1">{fmtPrice(quotes[a.symbol]?.price ?? 0)}</div>
        <div className="r2"><Change q={quotes[a.symbol]} /></div>
      </span>
    </button>
  );

  return (
    <aside className={`tm-side tm-col ${open ? 'is-open' : ''}`} aria-label="Navigation">
      <div className="tm-side-h">NAVIGATION</div>
      <nav className="tm-nav">
        {nav.map((n) => (
          <button key={n.id} type="button" aria-current={view === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
            {n.icon} {n.label} {n.badge && <span className="tm-badge">{n.badge}</span>}
          </button>
        ))}
        <Link to="/docs"><IconDocs /> Docs</Link>
      </nav>

      <div className="tm-watch">
        <div className="tm-side-h">WATCHLIST</div>
        {WATCHLIST.map((s) => ASSETS.find((a) => a.symbol === s)).filter(Boolean).map((a) => assetRow(a!, view === 'trade' && symbol === a!.symbol))}
      </div>

      <div className="tm-side-h">MARKETS</div>
      <div className="tm-tabs" role="tablist">
        <button type="button" role="tab" className="tm-tab" aria-selected={tab === 'options'} onClick={() => setTab('options')}>Options</button>
        <button type="button" role="tab" className="tm-tab" aria-selected={tab === 'perps'} onClick={() => setTab('perps')}>Perpetuals</button>
      </div>
      <div>
        {tab === 'options'
          ? ASSETS.map((a) => assetRow(a, view === 'trade' && product === 'options' && symbol === a.symbol, 'options', `${a.symbol} Options`))
          : (perps?.length
            ? perps.map((m) => {
                const a = ASSETS.find((x) => x.symbol === m.assetSymbol);
                return a ? assetRow(a, view === 'trade' && product === 'perps' && symbol === a.symbol, 'perps', m.symbol) : null;
              })
            : <div className="tm-empty">BABA-PERP opens once the protocol is deployed on this network.</div>)}
      </div>
    </aside>
  );
}
