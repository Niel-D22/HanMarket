import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useNetwork } from '../contexts/NetworkContext';
import { findAsset } from '../data/assets';

// Candlestick chart for HK listings and China ADRs. TradingView's embeddable widget refuses HKEX symbols,
// so this draws the candles itself with lightweight-charts (TradingView's open-source charting library).
// Colours follow the China convention: red candles close up, green candles close down.

const RANGES = ['1D', '5D', '1M', '6M', '1Y', '5Y'] as const;
type Range = (typeof RANGES)[number];

const LIGHT = { up: '#C8102E', down: '#1E8E5A', ink: '#0B0B0B', muted: 'rgba(40,33,28,0.55)', line: 'rgba(11,11,11,0.06)', cross: 'rgba(171,0,13,0.35)', label: '#AB000D' };
const DARK = { up: '#F04A52', down: '#26C281', ink: '#26262C', muted: '#8D8D97', line: 'rgba(255,255,255,0.05)', cross: 'rgba(201,163,106,0.45)', label: '#8A6D43' };

// lightweight-charts renders timestamps as UTC; shift them so the axis reads in the exchange's local time.
function tzOffsetSeconds(tz: string, t: number) {
  const d = new Date(t * 1000);
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return (local.getTime() - utc.getTime()) / 1000;
}

interface Props {
  symbol?: string;
  /** the terminal's dark theme */
  dark?: boolean;
}

export function PriceChart({ symbol = '0700.HK', dark = false }: Props) {
  const { up: UP, down: DOWN, ink: INK, muted: MUTED, line: LINE, cross: CROSS, label: LABEL } = dark ? DARK : LIGHT;
  const { apiUrl } = useNetwork();
  const asset = findAsset(symbol);
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [range, setRange] = useState<Range>('1M');
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

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
    volumeRef.current = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
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

    fetch(`${apiUrl}/candles?symbol=${encodeURIComponent(asset.symbol)}&range=${range}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((json) => {
        const candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = json?.data?.candles ?? [];
        if (!json.success) throw new Error(json.error);
        const shifted = candles.map((c) => ({ ...c, time: (c.time + tzOffsetSeconds(tz, c.time)) as UTCTimestamp }));
        candleRef.current?.setData(shifted.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
        volumeRef.current?.setData(shifted.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? `${UP}38` : `${DOWN}38`,
        })));
        chartRef.current?.timeScale().fitContent();
        setStatus(candles.length ? 'ready' : 'empty');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setStatus('error');
      });
    return () => ctrl.abort();
  }, [apiUrl, asset, range, UP, DOWN]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div role="group" aria-label="Chart range" style={{ display: 'flex', gap: '2px' }}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className="t-range"
            >
              {r}
            </button>
          ))}
        </div>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.7rem', color: MUTED }}>
          {asset ? `${asset.currency} · ${asset.board === 'HK' ? 'HKT' : 'ET'}` : ''}
          {status === 'loading' && ' · loading…'}
          {status === 'error' && ' · price history unavailable'}
          {status === 'empty' && ' · no trades in this range'}
        </span>
      </div>
      <div ref={boxRef} style={{ flex: 1, minHeight: 0, position: 'relative' }} />
    </div>
  );
}
