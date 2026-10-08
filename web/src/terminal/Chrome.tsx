import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ASSETS, type ChinaAsset } from '../data/assets';
import type { Quote } from '../hooks/usePrices';
import type { NetworkKey } from '../contexts/NetworkContext';
import type { PerpMarket } from './protocol';
import { fmtCompact, fmtPrice } from './protocol';
import { ThemeToggle } from '../theme/ThemeProvider';
import { ChinaClock, MusicToggle } from '../components/ChinaClock';
import {
  IconActivity, IconDocs, IconKeyboard, IconMarkets, IconMenu, IconPanelLeft, IconPanelRight, IconPortfolio, IconSearch, IconStrategy, IconTrade,
  IconVault, IconWallet, IconX,
} from './icons';
import type { PanelKey, Panels } from './panels';
import { X_URL } from '../config/social';
import { OpenInWallet, needsWalletApp } from './OpenInWallet';

export type View = 'trade' | 'markets' | 'strategies' | 'portfolio' | 'activity' | 'vault';
export type Product = 'options' | 'perps';


const change = (q?: Quote) => q?.change24h ?? 0;
const Change = ({ q }: { q?: Quote }) => {
  const c = change(q);
  return <span className={c >= 0 ? 'up' : 'down'}>{q ? `${c >= 0 ? '▲' : '▼'} ${c >= 0 ? '+' : ''}${c.toFixed(2)}%` : '—'}</span>;
};

// ---------------------------------------------------------------- top bar

export function TopBar({ network, setNetwork, onSelect, onMenu, panels, onPanel, onHelp }: {
  network: NetworkKey;
  setNetwork: (n: NetworkKey) => void;
  onSelect: (symbol: string) => void;
  onMenu: () => void;
  panels: Panels;
  onPanel: (key: PanelKey) => void;
  onHelp: () => void;
}) {
  const [q, setQ] = useState('');
  const [walletApp, setWalletApp] = useState(false);
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
      <button
        type="button"
        className="tm-icon-btn tm-desk-only"
        aria-pressed={!panels.side}
        aria-label={panels.side ? 'Hide the sidebar' : 'Show the sidebar'}
        title={`${panels.side ? 'Hide' : 'Show'} the sidebar ( [ )`}
        onClick={() => onPanel('side')}
      >
        <IconPanelLeft />
      </button>
      <div className="tm-search">
        <IconSearch />
        <input
          id="tm-search"
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
        {X_URL && (
          <a className="tm-icon-btn tm-x" href={X_URL} target="_blank" rel="noreferrer noopener" aria-label="HanMarket on X" title="HanMarket on X">
            <IconX />
          </a>
        )}
        <button type="button" className="tm-icon-btn tm-desk-only" aria-label="Keyboard shortcuts" title="Keyboard shortcuts ( ? )" onClick={onHelp}>
          <IconKeyboard />
        </button>
        <button
          type="button"
          className="tm-icon-btn tm-desk-only"
          aria-pressed={!panels.right}
          aria-label={panels.right ? 'Hide the order terminal' : 'Show the order terminal'}
          title={`${panels.right ? 'Hide' : 'Show'} the order terminal ( ] )`}
          onClick={() => onPanel('right')}
        >
          <IconPanelRight />
        </button>
        <ChinaClock variant="terminal" className="tm-desk-only" />
        <MusicToggle variant="terminal" className="tm-desk-only" />
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
            // a phone browser with no wallet in it: point to the wallet apps instead of a connect modal with nothing to offer
            const connect = () => (needsWalletApp() ? setWalletApp(true) : openConnectModal());
            const onClick = !account ? connect : chain?.unsupported ? openChainModal : openAccountModal;
            return (
              <button type="button" className={`tm-wallet ${account ? 'is-connected' : ''}`} onClick={onClick} aria-hidden={!mounted}>
                <IconWallet /> {label}
              </button>
            );
          }}
        </ConnectButton.Custom>
      </div>
      <OpenInWallet open={walletApp} onClose={() => setWalletApp(false)} />
    </header>
  );
}

// ---------------------------------------------------------------- sidebar

const WATCHLIST_DEFAULT = ['BABA', '0700.HK', '9988.HK', '1810.HK', '1211.HK', 'PDD'];
const WATCHLIST_KEY = 'hm-watchlist';

/**
 * The starred markets, kept in this browser. It is a per-viewer convenience, not account state, so it
 * lives in localStorage, which can be empty or throw in a private window, hence the guards.
 */
function useWatchlist() {
  const [list, setList] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (Array.isArray(saved) && saved.every((s) => typeof s === 'string')) return saved;
    } catch {
      // unreadable or blocked: start from the default list
    }
    return WATCHLIST_DEFAULT;
  });

  const toggle = useCallback((symbol: string) => {
    setList((prev) => {
      const next = prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol];
      try {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      } catch {
        // not persisted, which only means the change lasts for this visit
      }
      return next;
    });
  }, []);

  return { list, toggle, has: (s: string) => list.includes(s) };
}

/** The perpetuals list before there is one: still loading, not on mainnet yet, or nothing listed. */
function PerpsEmpty({ network, deployed, loading, onSwitchTestnet }: {
  network: NetworkKey;
  deployed: boolean;
  loading: boolean;
  onSwitchTestnet: () => void;
}) {
  if (!deployed && network === 'mainnet') {
    return (
      <div className="tm-empty">
        <b>Mainnet opens at launch</b>
        Perpetuals are live on testnet now.
        <button type="button" className="tm-empty-btn" onClick={onSwitchTestnet}>Switch to Testnet</button>
      </div>
    );
  }
  if (!deployed) return <div className="tm-empty">Perpetuals open once the protocol is deployed on this network.</div>;
  return <div className="tm-empty">{loading ? 'Loading markets…' : 'No perpetual markets listed yet.'}</div>;
}

export function Sidebar({ view, setView, symbol, product, onSelect, quotes, perps, network, deployed, onSwitchTestnet, open, onClose }: {
  view: View;
  setView: (v: View) => void;
  symbol: string;
  product: Product;
  onSelect: (symbol: string, product?: Product) => void;
  quotes: Record<string, Quote>;
  perps: PerpMarket[] | undefined;
  network: NetworkKey;
  deployed: boolean;
  onSwitchTestnet: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Product>(product);
  const watch = useWatchlist();
  const nav: { id: View; label: string; icon: ReactElement; badge?: string }[] = [
    { id: 'trade', label: 'Trade', icon: <IconTrade /> },
    { id: 'markets', label: 'Markets', icon: <IconMarkets /> },
    { id: 'strategies', label: 'Strategies', icon: <IconStrategy /> },
    { id: 'portfolio', label: 'Portfolio', icon: <IconPortfolio /> },
    { id: 'activity', label: 'Activity', icon: <IconActivity /> },
    { id: 'vault', label: 'Vault', icon: <IconVault />, badge: 'LP' },
  ];
  const go = (v: View) => { setView(v); onClose(); };
  const pick = (s: string, p?: Product) => { onSelect(s, p); onClose(); };
  const assetRow = (a: ChinaAsset, current: boolean, p?: Product, label?: string) => {
    const vol = quotes[a.symbol]?.volume;
    return (
      <div key={`${a.symbol}-${p ?? ''}`} className="tm-row-wrap">
        <button type="button" className="tm-row-btn" aria-current={current} onClick={() => pick(a.symbol, p)}>
          <span>
            <div className="t1">{label ?? a.symbol}</div>
            <div className="t2"><span className="cn">{a.cn}</span> · {a.name}</div>
          </span>
          <span>
            <div className="r1">{fmtPrice(quotes[a.symbol]?.price ?? 0)}</div>
            <div className="r2"><Change q={quotes[a.symbol]} /> {vol ? <span className="dim">· {fmtCompact(vol)}</span> : null}</div>
          </span>
        </button>
        <button
          type="button"
          className={`tm-star ${watch.has(a.symbol) ? 'on' : ''}`}
          aria-pressed={watch.has(a.symbol)}
          aria-label={`${watch.has(a.symbol) ? 'Remove' : 'Add'} ${a.symbol} ${watch.has(a.symbol) ? 'from' : 'to'} watchlist`}
          title={watch.has(a.symbol) ? 'Remove from watchlist' : 'Add to watchlist'}
          onClick={() => watch.toggle(a.symbol)}
        >
          {watch.has(a.symbol) ? '★' : '☆'}
        </button>
      </div>
    );
  };

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
        {watch.list.length === 0
          ? <div className="tm-empty">No markets starred. Use the ☆ beside a market below to add one.</div>
          : watch.list.map((s) => ASSETS.find((a) => a.symbol === s)).filter(Boolean).map((a) => assetRow(a!, view === 'trade' && symbol === a!.symbol))}
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
            : <PerpsEmpty network={network} deployed={deployed} loading={!perps} onSwitchTestnet={() => { onSwitchTestnet(); onClose(); }} />)}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- ticker tape

/** Every market's price and 24h change, scrolling along the top. The list is drawn twice so the loop has no seam. */
export function Ticker({ quotes, onSelect }: { quotes: Record<string, Quote>; onSelect: (symbol: string) => void }) {
  const items = ASSETS.filter((a) => quotes[a.symbol]);
  if (!items.length) return <div className="tm-ticker" aria-hidden="true" />;
  const run = (copy: number) => items.map((a) => {
    const q = quotes[a.symbol];
    return (
      <button key={`${copy}-${a.symbol}`} type="button" tabIndex={copy ? -1 : 0} onClick={() => onSelect(a.symbol)}>
        <b>{a.symbol}</b> <span className="num">{fmtPrice(q.price)}</span> <Change q={q} />
      </button>
    );
  });
  return (
    <div className="tm-ticker" aria-label="Market prices">
      <div className="tm-ticker-run">{run(0)}<span aria-hidden="true">{run(1)}</span></div>
    </div>
  );
}
