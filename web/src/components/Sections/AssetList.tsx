import { useEffect, useMemo, useRef, useState } from 'react';
import type { FC } from 'react';
import { ASSETS, BOARDS, formatLocalPrice, type Board, type ChinaAsset } from '../../data/assets';
import { usePrices } from '../../hooks/usePrices';

export interface Asset extends ChinaAsset {
  id: string;
  price: number;      // local currency
  priceUsd: number;
  change24h: number;
  /** the underlying equity is halted (only known for Robinhood-tokenized names) */
  halted?: boolean;
}

interface AssetListProps {
  onSelectAsset?: (asset: Asset) => void;
  selectedAssetId?: string;
  onPricesUpdate?: (prices: Record<string, Asset>) => void;
  initialBoard?: Board;
}

export const AssetList: FC<AssetListProps> = ({ onSelectAsset, selectedAssetId, onPricesUpdate, initialBoard = 'HK' }) => {
  const [board, setBoard] = useState<Board>(initialBoard);
  const [query, setQuery] = useState('');
  const quotes = usePrices();
  const hasAutoSelected = useRef(false);

  const assetMap = useMemo(() => {
    const map: Record<string, Asset> = {};
    for (const a of ASSETS) {
      const q = quotes[a.symbol];
      map[a.symbol] = { ...a, id: a.symbol, price: q?.price ?? 0, priceUsd: q?.priceUsd ?? 0, change24h: q?.change24h ?? 0, halted: q?.halted };
    }
    return map;
  }, [quotes]);

  useEffect(() => {
    onPricesUpdate?.(assetMap);
  }, [assetMap, onPricesUpdate]);

  // Select the first asset once so the chart and option chain open populated
  useEffect(() => {
    if (hasAutoSelected.current || !onSelectAsset || selectedAssetId) return;
    hasAutoSelected.current = true;
    onSelectAsset(assetMap[ASSETS.find((a) => a.board === board)!.symbol]);
  }, [assetMap, onSelectAsset, selectedAssetId, board]);

  const q = query.trim().toLowerCase();
  const assets = Object.values(assetMap).filter((a) =>
    q ? `${a.symbol} ${a.name} ${a.cn}`.toLowerCase().includes(q) : a.board === board,
  );

  const tabStyle = (active: boolean) => ({
    flex: 1,
    padding: '0.55rem 0.25rem',
    backgroundColor: 'transparent',
    color: active ? '#AB000D' : 'rgba(40,33,28,0.62)',
    border: 'none',
    borderBottom: active ? '2px solid #AB000D' : '2px solid transparent',
    cursor: 'pointer',
    fontFamily: "'Montserrat', 'Inter Tight', sans-serif",
    fontSize: '0.66rem',
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', position: 'relative' }}>
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        backgroundColor: 'rgba(255,253,249,0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        margin: '0 -0.5rem 0.4rem',
        padding: '0.25rem 0.5rem 0',
      }}>
        <input
          id="asset-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Tencent, 0700, 比亚迪…"
          aria-label="Search assets"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '0.55rem 0.75rem',
            borderRadius: '8px',
            border: '1px solid rgba(11,11,11,0.1)',
            background: '#FFFFFF',
            fontFamily: "'Inter Tight', sans-serif",
            fontSize: '0.8rem',
          }}
        />
        {!q && (
          <div role="tablist" style={{ display: 'flex', borderBottom: '1px solid rgba(11,11,11,0.06)', marginTop: '0.4rem' }}>
            {BOARDS.map((b) => (
              <button key={b.id} role="tab" aria-selected={board === b.id} onClick={() => setBoard(b.id)} style={tabStyle(board === b.id)}>
                {b.label} <span style={{ fontFamily: "'Noto Sans SC', sans-serif", letterSpacing: '0.05em' }}>{b.cn}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {assets.length === 0 && (
        <div style={{ padding: '1rem', fontSize: '0.8rem', color: 'rgba(40,33,28,0.62)', textAlign: 'center' }}>No asset matches “{query}”.</div>
      )}

      {assets.map((asset) => {
        const isSelected = selectedAssetId === asset.id;
        const hasPrice = asset.price > 0;
        const up = asset.change24h >= 0;
        return (
          <button
            key={asset.id}
            type="button"
            onClick={() => onSelectAsset?.(asset)}
            className="t-asset-row"
            aria-pressed={isSelected}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.5rem',
              width: '100%',
              textAlign: 'left',
              padding: '0.65rem 0.7rem',
              borderRadius: '8px',
              cursor: 'pointer',
              backgroundColor: isSelected ? 'rgba(171,0,13,0.07)' : 'transparent',
              border: isSelected ? '1px solid rgba(171,0,13,0.2)' : '1px solid transparent',
              font: 'inherit',
              color: 'inherit',
              transition: 'background-color 0.2s',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "'Noto Sans SC', 'Inter Tight', sans-serif", fontWeight: 500, color: '#0B0B0B', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                {asset.cn}
              </div>
              <div style={{ color: 'rgba(40,33,28,0.55)', fontSize: '0.7rem', marginTop: '0.15rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{asset.symbol}</span> · {asset.name}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0 }}>
              <div style={{ fontWeight: 600, color: '#0B0B0B', fontSize: '0.82rem' }}>
                {hasPrice ? formatLocalPrice(asset, asset.price) : '—'}
              </div>
              <div style={{ color: hasPrice ? (up ? '#C8102E' : '#1E8E5A') : 'rgba(40,33,28,0.42)', fontSize: '0.7rem', marginTop: '0.15rem' }}>
                {hasPrice ? `${up ? '+' : ''}${asset.change24h.toFixed(2)}%` : '—'}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};
