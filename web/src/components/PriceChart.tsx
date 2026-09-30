import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useNetwork } from '../contexts/NetworkContext';
import { findAsset } from '../data/assets';

// Candlestick chart for HK listings and China ADRs. TradingView's embeddable widget refuses HKEX symbols,
// so the default draws the candles itself with lightweight-charts (TradingView's open-source charting
// library). US-listed ADRs can also switch to TradingView's own chart, which the widget does serve.
// Green candles close up, red candles close down, as the terminal's other prices.

const TIMEFRAMES = [
  { id: '1m', label: '1m' },
  { id: '5m', label: '5m' },
  { id: '15m', label: '15m' },
  { id: '1h', label: '1H' },
  { id: '1d', label: '1D' },
  { id: '1w', label: '1W' },
] as const;
type Timeframe = (typeof TIMEFRAMES)[number]['id'];
/** daily and weekly candles carry a date, not a time of day */
const isIntraday = (tf: Timeframe) => tf !== '1d' && tf !== '1w';

const LIGHT = { up: '#1E8E5A', down: '#C8102E', ink: '#0B0B0B', muted: 'rgba(40,33,28,0.55)', line: 'rgba(11,11,11,0.06)', cross: 'rgba(171,0,13,0.35)', label: '#AB000D' };
const DARK = { up: '#26C281', down: '#F04A52', ink: '#26262C', muted: '#8D8D97', line: 'rgba(255,255,255,0.05)', cross: 'rgba(201,163,106,0.45)', label: '#8A6D43' };

// lightweight-charts renders timestamps as UTC; shift them so the axis reads in the exchange's local time.
function tzOffsetSeconds(tz: string, t: number) {
  const d = new Date(t * 1000);
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return (local.getTime() - utc.getTime()) / 1000;
}

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
interface Legend { time: number; o: number; h: number; l: number; c: number; v: number; chg: number; pct: number }

/** The OHLC line for candle `i`; the change is against the candle before it (its own open for the first). */
function legendAt(candles: Candle[], i: number): Legend | null {
  const c = candles[i];
  if (!c) return null;
  const prev = candles[i - 1]?.close ?? c.open;
  return { time: c.time, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume, chg: c.close - prev, pct: prev ? ((c.close - prev) / prev) * 100 : 0 };
}

const price = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 });
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(2)}K` : String(Math.round(n)));
/** `time` is already shifted to the exchange's wall clock, so reading its UTC fields gives that clock */
const stamp = (time: number, intraday: boolean) => {
  const iso = new Date(time * 1000).toISOString();
  return intraday ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
};

// ---------------------------------------------------------------- line or candles

type Style = 'candles' | 'line';
const STYLE_KEY = 'hm-chart-style';
function readStyle(): Style {
  try {
    return localStorage.getItem(STYLE_KEY) === 'line' ? 'line' : 'candles';
  } catch {
    return 'candles';
  }
}

// ---------------------------------------------------------------- engine choice

type Engine = 'native' | 'tradingview';
const ENGINE_KEY = 'hm-chart-engine';

/** A per-viewer convenience, so it lives in localStorage; a private window can refuse it, hence the guards. */
function readEngine(): Engine {
  try {
    return localStorage.getItem(ENGINE_KEY) === 'tradingview' ? 'tradingview' : 'native';
  } catch {
    return 'native';
  }
}

function EngineToggle({ engine, onChange }: { engine: Engine; onChange: (e: Engine) => void }) {
  return (
    <div className="tm-engine" role="group" aria-label="Chart source">
      <button type="button" aria-pressed={engine === 'native'} onClick={() => onChange('native')}>HanMarket</button>
      <button type="button" aria-pressed={engine === 'tradingview'} onClick={() => onChange('tradingview')} title="TradingView's own chart, with its full drawing tools. It draws green up and red down.">TradingView</button>
    </div>
  );
}

// ---------------------------------------------------------------- TradingView

function TradingViewChart({ tvSymbol, dark, toggle }: { tvSymbol: string; dark: boolean; toggle: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    inner.style.cssText = 'height:100%;width:100%';
    host.appendChild(inner);
    // TradingView's embed protocol: the script reads its own text as the widget's JSON config
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: '60',
      timezone: 'exchange',
      theme: dark ? 'dark' : 'light',
      style: '1',
      locale: 'en',
      allow_symbol_change: false,
      hide_side_toolbar: false,
      withdateranges: true,
      backgroundColor: dark ? '#111113' : '#fbf9f5',
      support_host: 'https://www.tradingview.com',
    });
    host.appendChild(script);
    return () => { host.innerHTML = ''; };
  }, [tvSymbol, dark]);

  return (
    <div className="tm-chart-col">
      <div className="tm-chart-bar">
        <span className="tm-chart-note">{tvSymbol} · TradingView</span>
        {toggle}
      </div>
      <div className="tm-chart-body">
        <div ref={hostRef} className="tradingview-widget-container" style={{ position: 'absolute', inset: 0 }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- native candles

function NativeChart({ symbol, dark, toggle }: { symbol: string; dark: boolean; toggle: ReactNode }) {
  const { up: UP, down: DOWN, ink: INK, muted: MUTED, line: LINE, cross: CROSS, label: LABEL } = dark ? DARK : LIGHT;
  const { apiUrl } = useNetwork();
  const asset = findAsset(symbol);
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const indexRef = useRef<Map<number, number>>(new Map());
  const [tf, setTf] = useState<Timeframe>('1h');
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [legend, setLegend] = useState<Legend | null>(null);
  const [style, setStyle] = useState<Style>(readStyle);
  const chooseStyle = (next: Style) => {
    setStyle(next);
    try {
      localStorage.setItem(STYLE_KEY, next);
    } catch {
      // not persisted, which only means the choice lasts for this visit
    }
  };

  useEffect(() => {
    if (!boxRef.current) return;
    const chart = createChart(boxRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: MUTED,
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: { vertLines: { color: LINE }, horzLines: { color: LINE } },
      rightPriceScale: { borderColor: LINE },
      timeScale: { borderColor: LINE, timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: CROSS, labelBackgroundColor: INK },
        horzLine: { color: CROSS, labelBackgroundColor: LABEL },
      },
    });
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: UP, borderUpColor: UP, wickUpColor: UP,
      downColor: DOWN, borderDownColor: DOWN, wickDownColor: DOWN,
    });
    // the close as a line, drawn on the same scale; only one of the two is visible at a time
    lineRef.current = chart.addSeries(LineSeries, { color: LABEL, lineWidth: 2, priceLineVisible: true, visible: false });
    volumeRef.current = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    // The legend follows the crosshair, and rests on the latest candle when the pointer leaves the chart.
    chart.subscribeCrosshairMove((p: MouseEventParams<Time>) => {
      const candles = candlesRef.current;
      const i = typeof p.time === 'number' ? indexRef.current.get(p.time) : undefined;
      setLegend(legendAt(candles, i ?? candles.length - 1));
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    if (!asset) return;
    const ctrl = new AbortController();
    const tz = asset.board === 'HK' ? 'Asia/Hong_Kong' : 'America/New_York';
    setStatus('loading');

    fetch(`${apiUrl}/candles?symbol=${encodeURIComponent(asset.symbol)}&tf=${tf}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error);
        const candles: Candle[] = json?.data?.candles ?? [];
        const shifted = candles.map((c) => ({ ...c, time: c.time + tzOffsetSeconds(tz, c.time) }));
        candlesRef.current = shifted;
        indexRef.current = new Map(shifted.map((c, i) => [c.time, i]));
        candleRef.current?.setData(shifted.map(({ time, open, high, low, close }) => ({ time: time as UTCTimestamp, open, high, low, close })));
        lineRef.current?.setData(shifted.map(({ time, close }) => ({ time: time as UTCTimestamp, value: close })));
        volumeRef.current?.setData(shifted.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? `${UP}38` : `${DOWN}38`,
        })));
        chartRef.current?.timeScale().fitContent();
        setLegend(legendAt(shifted, shifted.length - 1));
        setStatus(candles.length ? 'ready' : 'empty');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          candlesRef.current = [];
          indexRef.current = new Map();
          setLegend(null);
          setStatus('error');
        }
      });
    return () => ctrl.abort();
  }, [apiUrl, asset, tf, UP, DOWN]);

  useEffect(() => {
    candleRef.current?.applyOptions({ visible: style === 'candles' });
    lineRef.current?.applyOptions({ visible: style === 'line' });
  }, [style, dark]);

  const tone = legend && legend.chg < 0 ? 'down' : 'up';
  return (
    <div className="tm-chart-col">
      <div className="tm-chart-bar">
        <div role="group" aria-label="Chart timeframe" style={{ display: 'flex', gap: '2px' }}>
          {TIMEFRAMES.map((t) => (
            <button key={t.id} type="button" aria-pressed={tf === t.id} onClick={() => setTf(t.id)} className="t-range">
              {t.label}
            </button>
          ))}
        </div>
        <div className="tm-chart-bar-r">
          <div className="tm-engine" role="group" aria-label="Chart style">
            <button type="button" aria-pressed={style === 'line'} onClick={() => chooseStyle('line')}>Line</button>
            <button type="button" aria-pressed={style === 'candles'} onClick={() => chooseStyle('candles')}>Candles</button>
          </div>
          <button type="button" className="t-reset" title="Fit the whole range back on screen" onClick={() => chartRef.current?.timeScale().fitContent()}>Reset view</button>
          <span className="tm-chart-note">
            {asset ? `${asset.currency} · ${asset.board === 'HK' ? 'HKT' : 'ET'}` : ''}
            {status === 'loading' && ' · loading…'}
            {status === 'error' && ' · price history unavailable'}
            {status === 'empty' && ' · no trades in this range'}
          </span>
          {toggle}
        </div>
      </div>
      <div className="tm-chart-body">
        <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />
        {legend && status === 'ready' && (
          <div className="tm-ohlc" aria-label="Candle under the pointer">
            <span className="dim">{stamp(legend.time, isIntraday(tf))}</span>
            <span><i>O</i> <b className={tone}>{price(legend.o)}</b></span>
            <span><i>H</i> <b className={tone}>{price(legend.h)}</b></span>
            <span><i>L</i> <b className={tone}>{price(legend.l)}</b></span>
            <span><i>C</i> <b className={tone}>{price(legend.c)}</b></span>
            <span className={tone}>{legend.chg >= 0 ? '+' : ''}{price(legend.chg)} ({legend.pct >= 0 ? '+' : ''}{legend.pct.toFixed(2)}%)</span>
            <span><i>Vol</i> <b>{compact(legend.v)}</b></span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- public

interface Props {
  symbol?: string;
  /** the terminal's dark theme */
  dark?: boolean;
}

export function PriceChart({ symbol = '0700.HK', dark = false }: Props) {
  const asset = findAsset(symbol);
  // TradingView's widget serves US-listed symbols only; HKEX ones it refuses, so those stay on the native chart
  const canTradingView = asset?.board === 'ADR' && !!asset.tv;
  const [pref, setPref] = useState<Engine>(readEngine);
  const engine: Engine = canTradingView ? pref : 'native';
  const choose = (e: Engine) => {
    setPref(e);
    try {
      localStorage.setItem(ENGINE_KEY, e);
    } catch {
      // not persisted, which only means the choice lasts for this visit
    }
  };
  const toggle = canTradingView ? <EngineToggle engine={engine} onChange={choose} /> : null;

  return engine === 'tradingview' && asset
    ? <TradingViewChart tvSymbol={asset.tv} dark={dark} toggle={toggle} />
    : <NativeChart symbol={symbol} dark={dark} toggle={toggle} />;
}
