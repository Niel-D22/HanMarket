import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";
import { LogoMark, LogoText } from '../components/Navbar';
import { HanperpHero, IVORY, HERO_OVERLAP, HERO_COIN_DELAY } from '../components/HanperpHero';
import { CoinDock, CoinJourney } from '../components/emblem/CoinJourney';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { SplashCursor } from '../components/SplashCursor';
import { LogoLoop } from '../components/LogoLoop';
import { BorderGlow } from '../components/BorderGlow';
import { MagicBento } from '../components/MagicBento';
import { Coverflow } from '../components/Coverflow';
import { useTheme } from '../theme/ThemeProvider';
import { FINE_POINTER, useMediaQuery } from '../utils/useMediaQuery';
import { X_URL } from '../config/social';
// Open-source mono logos from web3icons (MIT), trimmed to head's markup: the chain and the L1 under it, the
// settlement token and MetaMask. Arbitrum, Chainlink, WalletConnect and Rabby were removed as backend detail
// that means little to a first-time visitor.
import robinhoodSvg from '@web3icons/core/svgs/networks/mono/robinhood.svg.js';
import ethereumSvg from '@web3icons/core/svgs/networks/mono/ethereum.svg.js';
import usdcSvg from '@web3icons/core/svgs/tokens/mono/USDC.svg.js';

const svgUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
// All white-on-clear, so --hm-logo-filter turns them to ink in the light theme.
//   MetaMask: web3icons only has it in colour, and flattened to one silhouette its face disappeared into a blob.
//   public/logos/metamask-mono.svg is the same fox in one colour with each facet's own share of ink, so it is
//   `shaded`: it keeps its tones instead of going through the flattening filter.
//   Pons Family: Robinhood Chain's own token launchpad, live on mainnet since the July 2026 launch (not in
//   web3icons; their own logo from ponsfamily.com).
const STACK_LOGOS: { label: string; src: string; shaded?: boolean }[] = [
  { label: "Robinhood Chain", src: svgUrl(robinhoodSvg) },
  { label: "Ethereum", src: svgUrl(ethereumSvg) },
  { label: "USDC", src: svgUrl(usdcSvg) },
  { label: "MetaMask", src: "/logos/metamask-mono.svg", shaded: true },
  { label: "Pons Family", src: "/logos/pons.png" },
];
// Every logo in the row in the same grey. A wrapper, not the <img>'s own filter: the images already carry
// --hm-logo-filter (invert in one theme, `none` in the other), and "grayscale(1) none" is invalid.
const LOGO_TONE = 0.42;
const GREY_LOGO: React.CSSProperties = { display: "block", filter: "var(--hm-logo-mono)", opacity: LOGO_TONE };
const SHADED_LOGO: React.CSSProperties = { display: "block", opacity: LOGO_TONE };

/* =============================================================================
   HANMARKET landing page. Ink-wash on rice paper, Han red accents.
   Options and perpetuals on Hong Kong & China equities, settled in USDC on
   Robinhood Chain. Both are the product, so copy on this page should never
   promote one and leave the other unmentioned.
============================================================================= */

/* HanMarket brand board: Han red, ivory, charcoal, stone. Light theme. */
const BORDER = "rgba(var(--hm-line-c), 0.08)";
const RED = "var(--hm-crimson)"; /* Han crimson, for the brand's red accents (not a price direction) */
const GAIN = "var(--hm-up)";     /* a price or P&L going up: green */
const LOSS = "var(--hm-down)";   /* going down: red */
const ORANGE = "var(--hm-red)";   /* Han red */
const GOLD = "var(--hm-red)";     /* accent text: gold is too light to read on ivory, so accents use Han red */
const TEXT = "var(--hm-text)";
const MUTED = "rgba(var(--hm-ink-c), 0.68)";
const MUTED_2 = "rgba(var(--hm-ink-c), 0.5)";
const GRADIENT = `linear-gradient(180deg, ${RED} 0%, ${ORANGE} 100%)`;
/* One ground colour for the whole page, the same ivory the hero clouds end in, so there is no seam. */
const SECTION_BG = IVORY;

const DISPLAY = "'Cormorant Garamond', 'Noto Serif SC', Georgia, serif";
const SANS = "'Inter Tight', -apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

const EYEBROW: React.CSSProperties = {
  fontFamily: "'Montserrat', 'Inter Tight', sans-serif", fontSize: 12.5, color: ORANGE, margin: 0,
  letterSpacing: "0.28em", textTransform: "uppercase", fontWeight: 600,
};


/* ---------- hand-drawn area chart: cubic Bézier, brand gradient fill, no charting lib ---------- */
function MiniChart({ up = true, id = "hero" }: { up?: boolean; id?: string }) {
  const stroke = up ? GAIN : LOSS;
  const gid = `mc-${id.replace(/[^a-zA-Z0-9]/g, "")}`; // unique per chart: several render on one page
  // hand-authored path across a 220x64 box, ending high (up) or low (down)
  const d = up
    ? "M0,46 C18,44 30,30 46,32 C64,34 74,18 92,20 C110,22 122,10 140,12 C158,14 170,26 188,20 C202,15 210,6 220,4"
    : "M0,10 C18,14 30,20 46,22 C64,24 74,30 92,34 C110,38 122,30 140,36 C158,42 170,44 188,50 C202,54 210,58 220,58";
  const fill = up
    ? `${d} L220,64 L0,64 Z`
    : `${d} L220,64 L0,64 Z`;
  return (
    <svg viewBox="0 0 220 64" width="100%" height="64" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${gid})`} stroke="none" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- hero dashboard preview: HanMarket's own trading UI, not a generic bank template ---------- */
/* ---------- Engines section: straight into the product, no browser-chrome mockup in between.
   Four cards, one per deployed contract, each with the number that contract actually tracks,
   rather than a screenshot of the terminal. */

/* What you can actually trade, not the contracts behind it. Vault and OracleRouter used to have their
   own cards here, which read as backend architecture to a first-time visitor ("what's an OracleRouter?").
   That detail didn't disappear, it moved to Docs → Contract addresses, where the audience already wants
   it: someone about to verify the protocol, not someone deciding whether to try it. */
function OptionsProductVisual() {
  const cell = (k: string, v: string) => (
    <div key={k} style={{ textAlign: "center" }}>
      <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: TEXT }}>{v}</div>
      <div style={{ fontFamily: SANS, fontSize: 9.5, letterSpacing: "0.06em", color: "rgba(var(--hm-ink-c), 0.45)", marginTop: 3 }}>{k}</div>
    </div>
  );
  return <div style={{ display: "flex", gap: 22 }}>{cell("STRIKE", "$480")}{cell("PREMIUM", "$12.40")}{cell("CAP", "$20")}</div>;
}

function PerpsProductVisual() {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, color: TEXT }}>
        10x <span style={{ fontSize: 12, color: "rgba(var(--hm-ink-c), 0.45)", fontWeight: 400, fontFamily: SANS }}>max leverage</span>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 12.5, color: RED, marginTop: 8 }}>Funding +0.0032% / 1h</div>
    </div>
  );
}

const PRODUCT_CARDS = [
  {
    label: "01", title: "Options", description: "Calls and puts on Tencent, Alibaba, BYD and more. Cash-settled in USDC. Every payout is capped, so a buyer can never win more than a seller can lose.",
    visual: <OptionsProductVisual />, cta: "Trade options",
  },
  {
    label: "02", title: "Perpetuals", description: "Leveraged long or short on BABA, Tencent, PDD and more, up to 10x, with no expiry. Funding between longs and shorts keeps the price honest.",
    visual: <PerpsProductVisual />, cta: "Trade perpetuals",
  },
];

/** The Protocol: one glowing spec panel, not a bento grid. It is deliberately a different shape from the
 * How It Works cards just above it, so the two sections don't read as the same component twice. */
function ProtocolPanel() {
  return (
    <BorderGlow
      borderRadius={28}
      backgroundColor="var(--hm-card)"
      glowRadius={340}
      glowIntensity={0.75}
      coneSpread={36}
      colors={[RED, ORANGE, GOLD]}
      style={{ maxWidth: 860, margin: "0 auto", overflow: "hidden", boxShadow: "0 40px 90px -34px rgba(var(--hm-shadow-c), 0.3)" }}
    >
      <div className="protocol-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)" }}>
        {PRODUCT_CARDS.map((c) => (
          <div key={c.title} className="protocol-col" style={{ padding: "34px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: GOLD, letterSpacing: "0.08em" }}>{c.label}</span>
            <div style={{ minHeight: 54, display: "flex", alignItems: "center" }}>{c.visual}</div>
            <h3 style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 600, margin: 0 }}>{c.title}</h3>
            <p style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: 1.55, color: MUTED, margin: 0 }}>{c.description}</p>
            <Link to="/terminal" style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: "var(--hm-red)", textDecoration: "none", marginTop: "auto", paddingTop: 4 }}>
              {c.cta} →
            </Link>
          </div>
        ))}
      </div>
    </BorderGlow>
  );
}

/* ---------- How It Works bento: each card shows the step, not just describes it ---------- */

const chip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 999,
  background: "rgba(var(--hm-line-c), 0.05)", border: "1px solid rgba(var(--hm-line-c), 0.08)",
  fontFamily: SANS, fontSize: 12, color: "rgba(var(--hm-ink-c), 0.8)", whiteSpace: "nowrap",
};

function WalletVisual() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={chip}>MetaMask <span style={{ width: 6, height: 6, borderRadius: "50%", background: GAIN }} /></span>
      <span style={{ ...chip, opacity: 0.6 }}>Robinhood Wallet</span>
    </div>
  );
}

function DepositVisual() {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, color: TEXT, letterSpacing: "-0.02em" }}>10,000.00</div>
      <div style={{ fontFamily: MONO, fontSize: 12, color: GOLD, marginTop: 2 }}>USDC · Robinhood Chain</div>
    </div>
  );
}

function MarketsVisual() {
  const rows = [["0700.HK", "腾讯控股", "480.00"], ["9988.HK", "阿里巴巴", "85.00"], ["1810.HK", "小米集团", "42.00"], ["1211.HK", "比亚迪", "260.00"]];
  return (
    <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map(([sym, cn, px], i) => (
        <div key={sym} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderRadius: 12,
          background: i === 0 ? "rgba(var(--hm-red-c), 0.14)" : "rgba(var(--hm-card-c), 0.85)",
          border: `1px solid ${i === 0 ? "rgba(var(--hm-red-c), 0.4)" : "rgba(var(--hm-line-c), 0.07)"}`,
        }}>
          <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: TEXT }}>{sym}</span>
          <span style={{ fontFamily: "'Noto Sans SC'," + SANS, fontSize: 12, color: "rgba(var(--hm-ink-c), 0.55)", flex: 1 }}>{cn}</span>
          <span style={{ fontFamily: MONO, fontSize: 12, color: i === 0 ? GOLD : "rgba(var(--hm-ink-c), 0.7)" }}>HK${px}</span>
        </div>
      ))}
    </div>
  );
}

function TicketVisual() {
  const line = (k: string, v: string, accent = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "7px 0" }}>
      <span style={{ fontFamily: SANS, color: "rgba(var(--hm-ink-c), 0.55)" }}>{k}</span>
      <span style={{ fontFamily: MONO, color: accent ? GOLD : TEXT }}>{v}</span>
    </div>
  );
  return (
    <div style={{
      width: "100%", maxWidth: 340, padding: 16, borderRadius: 16,
      background: "rgba(var(--hm-card-c), 0.88)", border: "1px solid rgba(var(--hm-line-c), 0.08)",
    }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <span style={{ ...chip, background: GRADIENT, color: "var(--hm-on-red)", border: "none", fontWeight: 700 }}>Buy Call</span>
        <span style={chip}>Buy Put</span>
        <span style={chip}>Sell</span>
      </div>
      {line("Market", "0700.HK")}
      {line("Strike", "HK$480")}
      {line("Expiry", "30 days")}
      {line("Premium", "12.40 USDC", true)}
      <div style={{ marginTop: 10, textAlign: "center", padding: "10px 0", borderRadius: 999, background: "var(--hm-solid)", color: "var(--hm-on-solid)", fontFamily: SANS, fontSize: 13, fontWeight: 700 }}>
        Confirm in wallet
      </div>
    </div>
  );
}

function ExpiryVisual() {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: TEXT }}>29d 14h</div>
      <div style={{ marginTop: 8, height: 4, width: 150, borderRadius: 99, background: "rgba(var(--hm-line-c), 0.08)", overflow: "hidden" }}>
        <div style={{ width: "4%", height: "100%", background: GRADIENT }} />
      </div>
    </div>
  );
}

function ReclaimVisual() {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: GAIN }}>+500.00</div>
      <div style={{ fontFamily: MONO, fontSize: 12, color: "rgba(var(--hm-ink-c), 0.5)", marginTop: 2 }}>USDC returned</div>
    </div>
  );
}

/* ---------- perpetuals equivalents of the market/ticket/outcome visuals above ---------- */

function PerpMarketVisual() {
  return (
    <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 12,
        background: "rgba(var(--hm-red-c), 0.14)", border: "1px solid rgba(var(--hm-red-c), 0.4)",
      }}>
        <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: TEXT }}>BABA-PERP</span>
        <span style={{ fontFamily: MONO, fontSize: 13, color: GOLD }}>$118.20</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, fontFamily: MONO, color: "rgba(var(--hm-ink-c), 0.55)", padding: "0 4px" }}>
        <span>Funding / 1h <span style={{ color: RED }}>+0.0032%</span></span>
        <span>up to 10x</span>
      </div>
    </div>
  );
}

function PerpTicketVisual() {
  const line = (k: string, v: string, accent = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "7px 0" }}>
      <span style={{ fontFamily: SANS, color: "rgba(var(--hm-ink-c), 0.55)" }}>{k}</span>
      <span style={{ fontFamily: MONO, color: accent ? GOLD : TEXT }}>{v}</span>
    </div>
  );
  return (
    <div style={{
      width: "100%", maxWidth: 340, padding: 16, borderRadius: 16,
      background: "rgba(var(--hm-card-c), 0.88)", border: "1px solid rgba(var(--hm-line-c), 0.08)",
    }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <span style={{ ...chip, background: GRADIENT, color: "var(--hm-on-red)", border: "none", fontWeight: 700 }}>Long</span>
        <span style={chip}>Short</span>
      </div>
      {line("Market", "BABA-PERP")}
      {line("Leverage", "10x")}
      {line("Margin", "500 USDC")}
      {line("Liq. price", "$106.10", true)}
      <div style={{ marginTop: 10, textAlign: "center", padding: "10px 0", borderRadius: 999, background: "var(--hm-solid)", color: "var(--hm-on-solid)", fontFamily: SANS, fontSize: 13, fontWeight: 700 }}>
        Confirm in wallet
      </div>
    </div>
  );
}

function FundingVisual() {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: RED }}>+0.0032%</div>
      <div style={{ fontFamily: MONO, fontSize: 12, color: "rgba(var(--hm-ink-c), 0.5)", marginTop: 4 }}>Funding / 1h · next in 42m</div>
    </div>
  );
}

function ClosePositionVisual() {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: GAIN }}>+128.40</div>
      <div style={{ fontFamily: MONO, fontSize: 12, color: "rgba(var(--hm-ink-c), 0.5)", marginTop: 2 }}>USDC · position closed</div>
    </div>
  );
}

/* ---------- Options / Perpetuals toggle for the How It Works section ---------- */

const OPTIONS_STEPS = [
  { label: "01", title: "Connect a wallet", description: "MetaMask, Robinhood Wallet or any EVM wallet. No sign-up.", visual: <WalletVisual /> },
  { label: "02", title: "Deposit USDC", description: "Every trade is priced and settled in USDC on Robinhood Chain.", visual: <DepositVisual /> },
  {
    label: "03", title: "Pick a market", description: "Hong Kong & China equity options, by strike and expiry.",
    visual: <MarketsVisual />, background: <img src="/hero/bg-paper.webp" alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "right center" }} />,
  },
  {
    label: "04", title: "Place the trade", description: "Buy a call or put, or sell one to earn the premium. You sign every trade.",
    visual: <TicketVisual />, background: <img src="/hero/clouds-back.webp" alt="" style={{ position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: "70%", objectFit: "cover", objectPosition: "top center" }} />,
  },
  { label: "05", title: "Redeem at expiry", description: "In the money? Redeem your USDC payout as soon as the market settles.", visual: <ExpiryVisual /> },
  { label: "06", title: "Reclaim collateral", description: "Sellers take back unsold contracts and every dollar not owed to buyers.", visual: <ReclaimVisual /> },
];

const PERPS_STEPS = [
  { label: "01", title: "Connect a wallet", description: "MetaMask, Robinhood Wallet or any EVM wallet. No sign-up.", visual: <WalletVisual /> },
  { label: "02", title: "Deposit USDC", description: "Every trade is priced and settled in USDC on Robinhood Chain.", visual: <DepositVisual /> },
  {
    label: "03", title: "Pick a market", description: "BABA-PERP or another of seven perp markets, priced off an onchain feed, up to 10x leverage.",
    visual: <PerpMarketVisual />, background: <img src="/hero/bg-paper.webp" alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "right center" }} />,
  },
  {
    label: "04", title: "Open a position", description: "Go long or short with leverage. You sign every trade.",
    visual: <PerpTicketVisual />, background: <img src="/hero/clouds-back.webp" alt="" style={{ position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: "70%", objectFit: "cover", objectPosition: "top center" }} />,
  },
  { label: "05", title: "Funding, not expiry", description: "No expiry date. Longs and shorts exchange funding every hour based on demand.", visual: <FundingVisual /> },
  { label: "06", title: "Close anytime", description: "Close your position whenever you want, or get liquidated if your margin runs out.", visual: <ClosePositionVisual /> },
];

function HowItWorksToggle({ product, onChange }: { product: "options" | "perps"; onChange: (p: "options" | "perps") => void }) {
  const seg = (key: "options" | "perps", label: string) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={product === key}
      onClick={() => onChange(key)}
      style={{
        fontFamily: SANS, fontSize: 13.5, fontWeight: 700, padding: "9px 22px", borderRadius: 999, border: "none", cursor: "pointer",
        background: product === key ? GRADIENT : "transparent",
        color: product === key ? "var(--hm-on-red)" : MUTED,
        transition: "background .2s ease, color .2s ease",
      }}
    >
      {label}
    </button>
  );
  return (
    <div role="tablist" aria-label="Product" style={{
      display: "inline-flex", gap: 4, padding: 4, borderRadius: 999,
      background: "rgba(var(--hm-line-c), 0.05)", border: "1px solid rgba(var(--hm-line-c), 0.08)",
    }}>
      {seg("options", "Options")}
      {seg("perps", "Perpetuals")}
    </div>
  );
}


/* ---------- markets coverflow: one tidy card per underlying (illustrative figures) ---------- */
interface Market {
  symbol: string;
  cn: string;
  name: string;
  price: string;
  change: number; // % over 24h
  chain: [strike: string, call: string, put: string][]; // middle row is at-the-money
  /** the issuer's own logo, not HanMarket's, shown for identification like on any quote screen */
  logo: string;
}

const MARKETS: Market[] = [
  { symbol: "9988.HK", cn: "阿里巴巴", name: "Alibaba", price: "85.00", change: -0.93, logo: "/logos/alibaba.svg", chain: [["80", "6.10", "1.35"], ["85", "3.60", "2.95"], ["90", "1.70", "5.90"]] },
  { symbol: "1810.HK", cn: "小米集团", name: "Xiaomi", price: "42.00", change: 2.1, logo: "/logos/xiaomi.svg", chain: [["40", "3.20", "0.95"], ["42", "2.15", "1.70"], ["45", "1.20", "3.05"]] },
  { symbol: "0700.HK", cn: "腾讯控股", name: "Tencent", price: "480.00", change: 1.24, logo: "/logos/tencent.svg", chain: [["460", "22.80", "4.90"], ["480", "12.40", "9.10"], ["500", "7.85", "14.60"]] },
  { symbol: "1211.HK", cn: "比亚迪", name: "BYD", price: "260.00", change: -0.41, logo: "/logos/byd.svg", chain: [["240", "22.40", "3.60"], ["260", "10.20", "8.10"], ["280", "6.40", "13.40"]] },
  { symbol: "3690.HK", cn: "美团", name: "Meituan", price: "120.00", change: 2.35, logo: "/logos/meituan.png", chain: [["110", "12.30", "2.10"], ["120", "6.20", "5.40"], ["130", "2.60", "11.80"]] },
];

function MarketCard({ market }: { market: Market }) {
  const up = market.change >= 0;
  const changeColor = up ? GAIN : LOSS;
  const col = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 } as const;
  return (
    <div style={{
      textAlign: "left", borderRadius: 22, padding: 22, fontFamily: SANS,
      background: `linear-gradient(180deg, var(--hm-card) 0%, var(--hm-bg-2) 100%)`,
      border: "1px solid rgba(var(--hm-line-c), 0.08)",
      boxShadow: "0 30px 60px -28px rgba(var(--hm-shadow-c), 0.3)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span style={{
            width: 44, height: 44, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0, padding: 6,
            // fixed light backing, not a theme token: these are the issuer's real brand colours, so they
            // must not go through --hm-logo-filter (the invert(1) trick built for HanMarket's own mono mark)
            background: "#FFFFFF", border: "1px solid rgba(var(--hm-gold-c), 0.28)",
          }}>
            <img src={market.logo} alt={`${market.name} logo`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </span>
          <div>
            <div style={{ fontFamily: "'Noto Sans SC'," + SANS, fontSize: 20, fontWeight: 500, color: TEXT, lineHeight: 1.2 }}>{market.cn}</div>
            <div style={{ fontSize: 13, color: MUTED }}>{market.name}</div>
          </div>
        </div>
        <span style={{ fontFamily: MONO, fontSize: 12, color: GOLD, border: "1px solid rgba(var(--hm-red-c), 0.3)", borderRadius: 999, padding: "4px 10px" }}>{market.symbol}</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 18 }}>
        <span style={{ fontFamily: MONO, fontSize: 28, fontWeight: 600, color: TEXT, letterSpacing: "-0.02em" }}>HK${market.price}</span>
        <span style={{ fontFamily: MONO, fontSize: 13, color: changeColor }}>{up ? "▲" : "▼"} {up ? "+" : ""}{market.change.toFixed(2)}%</span>
      </div>

      <div style={{ margin: "10px -4px 14px" }}>
        <MiniChart up={up} id={market.symbol} />
      </div>

      <div style={{ ...col, fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.08em", color: MUTED_2, paddingBottom: 8 }}>
        <span>STRIKE</span><span style={{ textAlign: "right" }}>CALL</span><span style={{ textAlign: "right" }}>PUT</span>
      </div>
      {market.chain.map(([strike, call, put], i) => {
        const atm = i === 1;
        return (
          <div key={strike} style={{
            ...col, fontFamily: MONO, fontSize: 13, padding: "8px 10px", margin: "0 -10px", borderRadius: 10,
            background: atm ? "rgba(var(--hm-red-c), 0.1)" : "transparent",
          }}>
            <span style={{ color: atm ? GOLD : "rgba(var(--hm-ink-c), 0.75)" }}>{strike}</span>
            <span style={{ textAlign: "right", color: TEXT }}>{call}</span>
            <span style={{ textAlign: "right", color: "rgba(var(--hm-ink-c), 0.75)" }}>{put}</span>
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18 }}>
        <span style={{ fontSize: 12, color: MUTED_2 }}>30-day expiry · USDC</span>
        <Link to="/terminal" style={{
          textDecoration: "none", fontSize: 13, fontWeight: 700, color: "var(--hm-on-red)", background: GRADIENT,
          borderRadius: 999, padding: "9px 18px",
        }}>
          Trade ↗
        </Link>
      </div>
    </div>
  );
}

/* ---------- scroll reveal: every block below the hero enters as it scrolls into view ---------- */
const REVEAL_EASE = [0.22, 1, 0.36, 1] as const;

function Reveal({ children, delay = 0, y = 32, amount = 0.25, style }: {
  children: React.ReactNode; delay?: number; y?: number; amount?: number; style?: React.CSSProperties;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.9, delay, ease: REVEAL_EASE }}
      style={style}
    >
      {children}
    </motion.div>
  );
}

/** section heading: eyebrow, then title, then optional lead, one after another */
function RevealHeading({ eyebrow, title, lead, align = "center", maxWidth = 720, marginBottom = 56 }: {
  eyebrow?: string; title: React.ReactNode; lead?: React.ReactNode; align?: "center" | "left"; maxWidth?: number; marginBottom?: number;
}) {
  return (
    <div style={{ maxWidth, margin: `0 auto ${marginBottom}px`, textAlign: align }}>
      {eyebrow && <Reveal y={14}><p style={EYEBROW}>{eyebrow}</p></Reveal>}
      <Reveal delay={0.1}>
        <h2 style={{ fontFamily: DISPLAY, fontSize: "clamp(30px, 5vw, 52px)", fontWeight: 600, letterSpacing: "-0.01em", margin: "14px 0 0", lineHeight: 1.1 }}>
          {title}
        </h2>
      </Reveal>
      {lead && (
        <Reveal delay={0.2} y={18}>
          <p style={{ fontFamily: SANS, fontSize: 15.5, color: MUTED_2, maxWidth: 560, margin: align === "left" ? "18px 0 0" : "18px auto 0", lineHeight: 1.6 }}>{lead}</p>
        </Reveal>
      )}
    </div>
  );
}

/* ---------- FAQ accordion item ---------- */
function FAQItem({ q, a, index = 0 }: { q: string; a: string; index?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ duration: 0.7, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
      style={{ borderBottom: `1px solid ${BORDER}` }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 16,
          background: "none", border: "none", cursor: "pointer", padding: "22px 4px", textAlign: "left",
          fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, color: TEXT,
        }}
      >
        {q}
        <span style={{
          flexShrink: 0, width: 22, height: 22, display: "grid", placeItems: "center",
          color: GOLD, fontSize: 20, transform: open ? "rotate(45deg)" : "none", transition: "transform 0.25s ease",
        }}>+</span>
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        style={{ overflow: "hidden" }}
      >
        <p style={{ fontFamily: SANS, fontSize: 15, lineHeight: 1.65, color: MUTED, margin: "0 0 22px", maxWidth: 640 }}>{a}</p>
      </motion.div>
    </motion.div>
  );
}

/* ---------- closing call to action: the hero's ink-wash world in a framed panel ---------- */
function FinalCta() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // parallax inside the panel while it crosses the screen
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const paperY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [-30, 30]);
  const buildingY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [60, -60]);
  const cloudsY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [40, -30]);

  return (
    <motion.div
      ref={ref}
      className="cta-panel"
      initial={{ opacity: 0, y: 60, scale: 0.97 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 1.1, ease: REVEAL_EASE }}
    >
      <style>{`
        .cta-panel { position: relative; max-width: 1200px; margin: 0 auto; min-height: clamp(460px, 62vh, 620px); border-radius: 28px; overflow: hidden; background: var(--hm-panel); border: 1px solid rgba(var(--hm-line-c), 0.08); box-shadow: 0 40px 90px -40px rgba(var(--hm-shadow-c), 0.35); isolation: isolate; }
        .cta-layer { position: absolute; pointer-events: none; }
        .cta-paper { inset: -40px 0; }
        .cta-paper img { width: 100%; height: 100%; object-fit: cover; object-position: right center; display: block; }
        .cta-building { right: -6%; top: -4%; width: min(62%, 720px); aspect-ratio: 1536 / 1024; }
        .cta-building img.art { width: 100%; height: 100%; display: block; -webkit-mask-image: linear-gradient(180deg, #000 55%, transparent 95%); mask-image: linear-gradient(180deg, #000 55%, transparent 95%); }
        .cta-lantern { position: absolute; left: 44.8%; top: 39.5%; width: 14.5%; transform-origin: 50% 1%; }
        .cta-clouds { left: -4%; right: -4%; bottom: -12%; }
        .cta-clouds img { width: 100%; height: auto; display: block; }
        .cta-content { position: relative; z-index: 2; padding: clamp(40px, 7vw, 88px); max-width: 620px; }
        .cta-title { font-family: ${DISPLAY}; font-weight: 600; font-size: clamp(40px, 5.4vw, 76px); line-height: 1; letter-spacing: -0.01em; color: ${TEXT}; margin: 16px 0 0; }
        .cta-rule { width: 64px; height: 2px; background: ${ORANGE}; margin: 26px 0 22px; transform-origin: 0 50%; }
        .cta-lead { font-family: ${SANS}; font-size: clamp(15.5px, 1.2vw, 18px); line-height: 1.6; color: ${MUTED}; margin: 0; max-width: 42ch; }
        .cta-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
        .cta-btn { font-family: 'Montserrat', 'Inter Tight', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.04em; text-decoration: none; padding: 14px 26px; border-radius: 999px; transition: transform .2s ease, background .2s ease, box-shadow .2s ease; }
        .cta-btn--solid { background: ${ORANGE}; color: var(--hm-on-red); box-shadow: 0 10px 26px rgba(var(--hm-red-c), 0.25); }
        .cta-btn--solid:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(var(--hm-red-c), 0.32); }
        .cta-btn--ghost { color: ${TEXT}; border: 1px solid rgba(var(--hm-line-c), 0.3); background: rgba(var(--hm-bg-c), 0.6); }
        .cta-btn--ghost:hover { background: rgba(var(--hm-line-c), 0.05); transform: translateY(-2px); }
        .cta-btn:focus-visible { outline: 2px solid ${ORANGE}; outline-offset: 3px; }
        .cta-note { font-family: ${SANS}; font-size: 12px; color: ${MUTED_2}; margin: 18px 0 0; }
        @media (max-width: 760px) {
          .cta-building { width: 125%; right: -48%; top: -6%; opacity: 0.55; }
          .cta-content { padding: 210px 24px 36px; }
          .cta-clouds { bottom: -6%; opacity: 0.6; }
        }
      `}</style>

      <motion.div className="cta-layer cta-paper" style={{ y: paperY }} aria-hidden="true">
        <img src="/hero/bg-paper.webp" alt="" />
      </motion.div>

      <motion.div className="cta-layer cta-building" style={{ y: buildingY }} aria-hidden="true">
        <motion.div
          style={{ position: "relative", width: "100%", height: "100%" }}
          initial={{ opacity: 0, x: 80 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 1.5, delay: 0.2, ease: REVEAL_EASE }}
        >
          <img className="art" src="/hero/building.webp" alt="" />
          <motion.img
            className="cta-lantern"
            src="/hero/lantern.webp"
            alt=""
            initial={{ opacity: 0, y: "-40%" }}
            whileInView={{ opacity: 1, y: "0%" }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ y: { type: "spring", stiffness: 70, damping: 11, delay: 0.7 }, opacity: { duration: 0.4, delay: 0.7 }, rotate: { duration: 6, repeat: Infinity, ease: "easeInOut" } }}
            animate={reduce ? undefined : { rotate: [-2.5, 2.5, -2.5] }}
            style={{ rotate: 0 }}
          />
        </motion.div>
      </motion.div>

      <motion.div className="cta-layer cta-clouds" style={{ y: cloudsY }} aria-hidden="true">
        <motion.div
          animate={reduce ? undefined : { x: ["0%", "-2%", "0%"] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        >
          <img src="/hero/clouds-back.webp" alt="" />
        </motion.div>
      </motion.div>

      <div className="cta-content">
        <Reveal y={14} delay={0.15}><p style={EYEBROW}>Start trading</p></Reveal>
        <Reveal delay={0.25}>
          <h2 className="cta-title">Trade the<br />Next China.</h2>
        </Reveal>
        <motion.div
          className="cta-rule"
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{ duration: 0.9, delay: 0.5, ease: [0.76, 0, 0.24, 1] }}
        />
        <Reveal delay={0.45} y={18}>
          <p className="cta-lead">Options and perpetuals on Tencent, Alibaba, Xiaomi, BYD and more, settled in USDC on Robinhood Chain. Connect a wallet and place your first trade on testnet.</p>
        </Reveal>
        <Reveal delay={0.6} y={18}>
          <div className="cta-actions">
            <Link to="/terminal" className="cta-btn cta-btn--solid">Start Trading →</Link>
            <Link to="/docs" className="cta-btn cta-btn--ghost">Read the Docs</Link>
          </div>
          <p className="cta-note">Running on Robinhood Chain testnet · not yet audited</p>
        </Reveal>
      </div>
    </motion.div>
  );
}

/** How It Works: a toggle over two six-step walkthroughs, options and perpetuals, since they diverge
 * after "deposit": one has an expiry and a premium, the other leverage and funding. */
function HowItWorksSection() {
  const [product, setProduct] = useState<"options" | "perps">("options");
  return (
    <section id="how" className="lp-section" style={{ padding: "100px 20px" }}>
      <div className="dock-lockup" style={{ marginBottom: 32 }}>
        <CoinDock />
        <div className="dock-lockup-text">
          <RevealHeading eyebrow="How It Works" title="From wallet to trade in six steps" align="left" marginBottom={0} />
        </div>
      </div>
      <Reveal y={14} amount={0.6}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 44 }}>
          <HowItWorksToggle product={product} onChange={setProduct} />
        </div>
      </Reveal>
      {/* re-keying on product restarts the bento's stagger-in animation for the new set of cards */}
      <div key={product}>
        <MagicBento
          glowColor="var(--hm-red-c)"
          spotlightRadius={400}
          particleCount={12}
          cards={product === "options" ? OPTIONS_STEPS : PERPS_STEPS}
        />
      </div>
    </section>
  );
}

export default function HanPerpLanding() {
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const { theme } = useTheme();
  const finePointer = useMediaQuery(FINE_POINTER);

  // Smooth scrolling (Lenis): a wheel step glides instead of jumping 100px at once, so everything tied to the
  // scroll (the hero's layers, the coin's journey) moves continuously. Touch scrolling is left native.
  const lenisRef = useRef<Lenis | null>(null);
  useEffect(() => {
    if (reduceMotion) return;
    const lenis = new Lenis({ lerp: 0.085, anchors: true });
    lenisRef.current = lenis;
    let raf = 0;
    const tick = (time: number) => { lenis.raf(time); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); lenisRef.current = null; };
  }, [reduceMotion]);

  // A full page load (refresh, or opening a pasted URL) starts at the top, so the intro plays from the
  // beginning. Restoring an old scroll position or a stale #hash dropped visitors mid-page, often inside
  // the cloud-covered part of the hero, which looked like a blank white screen.
  useEffect(() => {
    const prev = history.scrollRestoration;
    history.scrollRestoration = "manual";
    if (location.key === "default") {
      window.scrollTo(0, 0);
      if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    }
    return () => { history.scrollRestoration = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // in-app links such as "/#markets" still scroll to their section
  useEffect(() => {
    if (location.key === "default") return;
    if (location.hash) {
      setTimeout(() => {
        const id = location.hash.replace('#', '');
        const element = document.getElementById(id);
        if (!element) return;
        if (lenisRef.current) lenisRef.current.scrollTo(element);
        else element.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [location]);

  return (
    <div style={{ background: SECTION_BG, color: TEXT, fontFamily: SANS, overflowX: "clip" }}>
      <style>{`
        @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; } }
        /* the coin (CoinJourney, z-index 5) sits under the sections' content, in the docks they leave open for it */
        .lp-section { position: relative; z-index: 6; }
        /* every section keeps a place for the coin (CoinDock) in its own layout */
        .dock-row { display: flex; align-items: center; justify-content: center; gap: clamp(28px, 4vw, 64px); max-width: 1200px; margin: 0 auto; }
        .dock-row-main { flex: 1 1 auto; min-width: 0; max-width: 880px; }
        .dock-lockup { display: flex; align-items: center; justify-content: center; gap: clamp(24px, 3.5vw, 52px); max-width: 1000px; margin: 0 auto; }
        .dock-lockup > .dock-lockup-text { flex: 0 1 auto; min-width: 0; }
        .dock-faq { display: grid; grid-template-columns: minmax(170px, 250px) minmax(0, 720px); gap: clamp(32px, 5vw, 72px); justify-content: center; align-items: start; max-width: 1100px; margin: 0 auto; }
        .dock-faq-side { position: sticky; top: 30vh; display: flex; justify-content: center; padding-top: 24px; }
        @media (max-width: 820px) {
          /* one column: the dock sits centred above whatever it was beside */
          .dock-row, .dock-lockup { flex-direction: column; gap: 22px; }
          .dock-row .coin-dock, .dock-lockup .coin-dock { order: -1; --dock: 104px; }
          .dock-lockup-text > div, .dock-row-main > div:first-child { text-align: center !important; }
          .dock-row-note { text-align: center; margin: 20px auto 0 !important; }
          .dock-faq { grid-template-columns: 1fr; gap: 12px; }
          .dock-faq-side { position: static; padding-top: 0; }
          .dock-faq-side .coin-dock { --dock: 104px; }
          .dock-faq-text > div:first-child { text-align: center !important; }
        }

        /* protocol spec panel: a vertical rule between the two cards, a horizontal one once they stack,
           so the divider always sits between cards rather than around them */
        .protocol-col + .protocol-col { border-left: 1px solid rgba(var(--hm-line-c), 0.08); }
        @media (max-width: 560px) {
          .protocol-grid { grid-template-columns: 1fr !important; }
          .protocol-col { border-left: none !important; border-top: 1px solid rgba(var(--hm-line-c), 0.08); }
          .protocol-col:first-child { border-top: none; }
        }
        @media (max-width: 640px) {
          .lp-section { padding-top: 64px !important; padding-bottom: 64px !important; }
          #engines { padding-top: 24px !important; }
          #why { padding-top: 0 !important; }
          #start { padding-top: 16px !important; padding-bottom: 72px !important; }
          .lp-footer { flex-direction: column; align-items: flex-start !important; padding: 36px 22px 44px !important; }
          .lp-footer-note { text-align: left !important; }
        }
      `}</style>

      {/* cursor trail: React Bits SplashCursor with its default look, colour only */}
      {/* white ink trails belong on rice paper; on the dark ground the fluid layer veils the hero art */}
      {/* a cursor effect: on a touch screen every scroll gesture would run a full-screen fluid simulation */}
      {theme === "light" && finePointer && (
        <SplashCursor
          DENSITY_DISSIPATION={4}
          VELOCITY_DISSIPATION={2}
          PRESSURE={0.1}
          CURL={3}
          SPLAT_RADIUS={0.2}
          SPLAT_FORCE={6000}
          COLOR_UPDATE_SPEED={10}
          SHADING
          RAINBOW_MODE={false}
          COLOR="#FFFFFF"
        />
      )}
      <HanperpHero />
      <CoinJourney delay={HERO_COIN_DELAY} reduce={reduceMotion} />

      {/* WHAT YOU CAN TRADE: first thing under the clouds: straight into the product, no mocked
          screenshot standing in for it. Two cards, not four: Vault and OracleRouter used to have their
          own cards, which read as backend architecture ("what's an OracleRouter?") rather than something
          to try. That detail moved to Docs → Contract addresses, for the audience who wants it. */}
      <section id="engines" className="lp-section" style={{ position: "relative", zIndex: 6, marginTop: `-${HERO_OVERLAP}`, padding: "40px 20px 100px" }}>
        <div className="dock-row">
          <div className="dock-row-main">
            <RevealHeading eyebrow="What You Can Trade" title="Options and perpetuals" align="left" maxWidth={880} marginBottom={40} />
            <ProtocolPanel />
            <p className="dock-row-note" style={{ fontFamily: SANS, fontSize: 12.5, color: MUTED_2, maxWidth: 520, margin: "20px 0 0" }}>
              Max leverage is a live figure. Strike, premium and funding shown here are a worked example. See
              Markets below for live pricing.
            </p>
          </div>
          <CoinDock />
        </div>
      </section>

      {/* BUILT WITH: the real stack, not fake "trusted by" client logos. Logos only, all in one grey (head's
          call): the names stay as each logo's accessible name and hover title. HanMarket's own mark leads the row. */}
      <section style={{ padding: "20px 0 36px" }} aria-label="Built with">
        {/* Every logo as a flat silhouette: colour to black, and alpha pushed to solid, so a logo drawn with shading or
            see-through layers (the Pons P) comes out as one even shape like the rest. */}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
          <filter id="hm-logo-mono" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
            <feComponentTransfer><feFuncA type="linear" slope="4" intercept="0" /></feComponentTransfer>
          </filter>
        </svg>
        <Reveal y={16} amount={0.6}>
        <LogoLoop
          showLabels={false}
          // LogoLoop's own default (rgba(232,222,216,0.55)) is light beige for a dark backdrop; this
          // section sits on the page's light ivory ground, where that colour nearly vanishes into it.
          color="rgba(var(--hm-ink-c), 0.6)"
          gap={64}
          repeat={4}
          speed={40}
          items={[
            {
              label: "HanMarket",
              node: <span style={GREY_LOGO}><LogoMark size={36} /></span>,
            },
            ...STACK_LOGOS.map(({ label, src, shaded }) => ({
              label,
              node: <span style={shaded ? SHADED_LOGO : GREY_LOGO}><img src={src} alt="" width={36} height={36} style={{ display: "block", filter: "var(--hm-logo-filter)" }} /></span>,
            })),
          ]}
        />
        </Reveal>
      </section>

      {/* HOW IT WORKS: the first real question a first-time visitor has: how do I actually use this.
          Options and perps are different enough after step 2 (an expiry and a premium vs. leverage and
          funding) that one six-step list would have to lie about one of them, so this is a toggle over
          two, not one list with a caption. */}
      <HowItWorksSection />

      {/* MARKETS: proof the product is real, the actual assets rather than a pitch */}
      <section id="markets" className="lp-section" style={{ padding: "100px 20px", overflowX: "hidden" }}>
        <div style={{ maxWidth: 1250, margin: "0 auto", textAlign: "center" }}>
          <div className="dock-lockup" style={{ marginBottom: 48 }}>
            <div className="dock-lockup-text">
              <RevealHeading
                eyebrow="Markets"
                title={<>Real Hong Kong &amp; China equities</>}
                lead="Every stock has an option chain, shown here as an illustration. BABA also trades as a perpetual. Live pricing arrives when markets launch."
                align="left"
                marginBottom={0}
              />
            </div>
            <CoinDock />
          </div>
          <Reveal y={60} amount={0.2}>
          <Coverflow
            ariaLabel="Example markets. Use the arrow keys to browse."
            itemLabels={MARKETS.map((m) => `${m.symbol} ${m.name}`)}
            initialIndex={2}
            accent="var(--hm-red)"
            rotation={24}
            itemWidth={340}
            spacing={260}
            announce={(i, total) => `Showing ${MARKETS[i].name}, ${i + 1} of ${total}`}
            items={MARKETS.map((m) => <MarketCard key={m.symbol} market={m} />)}
          />
          </Reveal>
        </div>
      </section>

      {/* WHY ONCHAIN: four plain facts set like notes on a scroll, a brushed character over each, hairlines between.
          No cards or icons. Every claim is checkable: the fees are FeeManager's (contracts/script/Deploy.s.sol), and
          Vault.withdraw has no pause. */}
      <section id="why" className="lp-section" style={{ padding: "20px 20px 100px" }}>
        <style>{`
          .why-grid { max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid rgba(var(--hm-line-c), 0.16); border-bottom: 1px solid rgba(var(--hm-line-c), 0.16); }
          .why-item { padding: 36px 28px 40px; text-align: left; }
          .why-item + .why-item { border-left: 1px solid rgba(var(--hm-line-c), 0.16); }
          .why-char { display: block; font-family: 'Ma Shan Zheng', 'Noto Serif SC', serif; font-size: 58px; line-height: 1; color: ${TEXT}; opacity: 0.9; }
          .why-title { font-family: ${DISPLAY}; font-size: 24px; font-weight: 600; line-height: 1.15; color: ${TEXT}; margin: 24px 0 10px; }
          .why-text { font-family: ${SANS}; font-size: 15px; line-height: 1.6; color: ${MUTED}; margin: 0; }
          @media (max-width: 900px) {
            .why-grid { grid-template-columns: repeat(2, 1fr); }
            .why-item:nth-child(3) { border-left: none; }
            .why-item:nth-child(n + 3) { border-top: 1px solid rgba(var(--hm-line-c), 0.16); }
          }
          @media (max-width: 520px) {
            .why-grid { grid-template-columns: 1fr; }
            .why-item { padding: 28px 2px 30px; }
            .why-item + .why-item { border-left: none; border-top: 1px solid rgba(var(--hm-line-c), 0.16); }
            .why-char { font-size: 50px; }
          }
        `}</style>
        <div className="why-grid">
          {[
            ["股", "Hong Kong & China equities", "Options on 33 Hong Kong and China names: Tencent, Alibaba, Xiaomi, BYD and more."],
            ["明", "Settled in the open", "Collateral, trades and settlement are contract calls on Robinhood Chain. Anyone can check them on the explorer."],
            ["守", "No company account", "Your collateral sits in the vault contract. Your free balance can be withdrawn at any time, even while trading is paused."],
            ["廉", "Fees in plain numbers", "1% of the premium on options, 0.08% of size on perpetuals, and gas that costs cents."],
          ].map(([char, title, text], i) => (
            <motion.div
              key={title}
              className="why-item"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.8, delay: i * 0.08, ease: REVEAL_EASE }}
            >
              <span className="why-char" aria-hidden="true">{char}</span>
              <h3 className="why-title">{title}</h3>
              <p className="why-text">{text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FAQ: the honest answers, including the ones that are less flattering (no audit yet, devnet) */}
      <section id="faq" className="lp-section" style={{ padding: "100px 20px" }}>
        <div className="dock-faq">
          <div className="dock-faq-side"><CoinDock sticky /></div>
          <div className="dock-faq-text">
          <RevealHeading eyebrow="FAQ" title="Questions traders actually ask" align="left" marginBottom={40} />
          <FAQItem index={0} q="What is an options contract, in plain terms?" a="A call option lets you lock in today's price to buy an asset later; a put does the opposite for selling. On HanMarket, everything is priced in USDC and settled onchain. You never touch the real Hong Kong shares." />
          <FAQItem index={1} q="What is a perpetual, in plain terms?" a="A leveraged long or short with no expiry date. You hold it as long as you want and close it whenever you choose. Longs and shorts pay each other funding depending on which side is more crowded, so the price stays honest without a settlement date." />
          <FAQItem index={2} q="How much leverage can I use on a perpetual, and what does it cost?" a="Every perp market allows up to 10x while HanMarket is on testnet. Leverage and margin are linked: 10x needs about 10% margin, and a position is liquidated once its equity falls to 5% of its size. That is roughly a 5% move against you, sooner once fees and funding are counted, so a small move can wipe out the margin. A price that gaps past the liquidation level is a loss the vault absorbs rather than you. The limit is a risk setting, not a fixed ceiling, and the contracts have not been audited yet, so trade with funds you can afford to lose." />
          <FAQItem index={3} q="Is my collateral safe?" a="HanMarket is self-custodial: your wallet holds your collateral, not HanMarket. That said, the protocol is new and has not yet been through a third-party security audit. Trade with that in mind, and only with funds you can afford to risk." />
          <FAQItem index={4} q="Is this live on mainnet?" a="Not yet. HanMarket runs on Robinhood Chain testnet while the contract is tested. A mainnet launch will be announced once it has been audited." />
          <FAQItem index={5} q="Which wallets are supported?" a="Any EVM wallet: MetaMask, Rabby, the Robinhood Wallet or anything that connects through WalletConnect. Keep a little ETH on Robinhood Chain for gas." />
          <FAQItem index={6} q="Why Hong Kong and China equities specifically?" a="Names like Tencent, Alibaba, Xiaomi and BYD give traders outside China exposure to major Chinese companies without a local brokerage account, with every trade paid in USDC." />
          <FAQItem index={7} q="How is the settlement or liquidation price decided?" a="On mainnet, Alibaba (options and BABA-PERP) uses Chainlink's onchain Robinhood BABA / USD feed, so nobody can change it. On testnet, Chainlink has no equity feeds, so BABA and the six other perp markets use a feed the HanMarket keeper updates from market data. Every other stock has no onchain feed, so its options settle with a price signed by HanMarket. Each market shows which one it uses before you trade." />
          </div>
        </div>
      </section>

      {/* CLOSING CTA: end on the one action that matters */}
      <section id="start" className="lp-section" style={{ padding: "40px 20px 110px" }}>
        <FinalCta />
      </section>

      {/* FOOTER */}
      <motion.footer
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.8, ease: REVEAL_EASE }}
        className="lp-footer"
        style={{ color: MUTED, padding: "44px 22px", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between", alignItems: "center" }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          <LogoMark size={36} />
          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 700, fontFamily: SANS, color: TEXT }}><LogoText /></span>
            <span style={{ fontFamily: "'Montserrat', 'Inter Tight', sans-serif", fontSize: 10, letterSpacing: "0.28em", color: MUTED_2 }}>MARKETS WITHOUT BORDERS</span>
          </span>
          {X_URL && (
            <a href={X_URL} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', color: MUTED, marginLeft: 16 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
          )}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.1em", color: MUTED_2 }}>
          Options and perpetuals on Hong Kong &amp; China equities · Built on Robinhood Chain
          <span style={{ display: "block", marginTop: 6, fontFamily: "'Noto Sans SC'," + SANS, letterSpacing: "0.2em" }}>连接东西 · Connecting East and West</span>
        </span>
        <span className="lp-footer-note" style={{ fontFamily: SANS, fontSize: 12, maxWidth: 360, textAlign: "right", lineHeight: 1.5, color: MUTED_2 }}>
          Derivatives involve risk. Access is restricted by jurisdiction. Nothing here is financial advice.
        </span>
      </motion.footer>
    </div>
  );
}
