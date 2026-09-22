import { useCallback, useState } from "react";
import type { ReactNode, KeyboardEvent } from "react";
import { motion, useReducedMotion } from "motion/react";

/* ============================================================================
   Coverflow — 3D carousel: the active card faces the viewer, neighbours
   rotate away on the Y axis. Arrow keys, swipe/drag, prev/next buttons and
   dots all move it; changes are announced to screen readers.
============================================================================ */

interface CoverflowProps {
  items: ReactNode[];
  itemLabels: string[]; // accessible name for each slide
  initialIndex?: number;
  rotation?: number; // degrees for the cards beside the active one
  itemWidth?: number; // px
  spacing?: number; // px between card centres
  ariaLabel: string;
  announce?: (index: number, total: number) => string;
  accent?: string;
}

export function Coverflow({
  items, itemLabels, initialIndex = 0, rotation = 22, itemWidth = 340, spacing = 250,
  ariaLabel, announce, accent = "#FDC747",
}: CoverflowProps) {
  const total = items.length;
  const [active, setActive] = useState(Math.min(Math.max(initialIndex, 0), total - 1));
  const reduceMotion = useReducedMotion();

  const go = useCallback((i: number) => setActive(Math.min(Math.max(i, 0), total - 1)), [total]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(active + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(active - 1); }
    if (e.key === "Home") { e.preventDefault(); go(0); }
    if (e.key === "End") { e.preventDefault(); go(total - 1); }
  };

  const arrow = (dir: -1 | 1) => {
    const disabled = dir === -1 ? active === 0 : active === total - 1;
    return (
      <button
        type="button"
        onClick={() => go(active + dir)}
        disabled={disabled}
        aria-label={dir === -1 ? "Previous market" : "Next market"}
        className="cf-arrow"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d={dir === -1 ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  };

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="cf-root"
    >
      <style>{`
        .cf-root { position: relative; width: 100%; outline: none; }
        .cf-root:focus-visible .cf-stage { outline: 2px solid ${accent}; outline-offset: 8px; border-radius: 24px; }
        .cf-stage { position: relative; display: grid; justify-items: center; align-items: center; perspective: 1400px; padding: 12px 0; overflow: hidden; touch-action: pan-y; }
        .cf-item { grid-area: 1 / 1; transform-style: preserve-3d; }
        .cf-controls { display: flex; align-items: center; justify-content: center; gap: 18px; margin-top: 28px; }
        .cf-arrow {
          width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
          background: rgba(var(--hm-line-c), 0.03); border: 1px solid rgba(var(--hm-line-c), 0.14); color: #0B0B0B;
          transition: background .2s ease, opacity .2s ease;
        }
        .cf-arrow:hover:not(:disabled) { background: rgba(var(--hm-line-c), 0.08); }
        .cf-arrow:disabled { opacity: .3; cursor: default; }
        .cf-arrow:focus-visible, .cf-dot:focus-visible { outline: 2px solid ${accent}; outline-offset: 3px; }
        .cf-dots { display: flex; gap: 8px; }
        .cf-dot { height: 8px; border-radius: 99px; border: none; padding: 0; cursor: pointer; background: rgba(var(--hm-line-c), 0.18); transition: width .3s ease, background .3s ease; }
        .cf-dot[aria-current="true"] { background: ${accent}; }
      `}</style>

      <motion.div
        className="cf-stage"
        drag={reduceMotion ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.15}
        onDragEnd={(_, info) => {
          if (info.offset.x < -60) go(active + 1);
          else if (info.offset.x > 60) go(active - 1);
        }}
      >
        {items.map((item, i) => {
          const offset = i - active;
          const dist = Math.abs(offset);
          const isActive = offset === 0;
          return (
            <motion.div
              key={itemLabels[i]}
              className="cf-item"
              role="group"
              aria-roledescription="slide"
              aria-label={itemLabels[i]}
              aria-hidden={!isActive}
              onClick={() => { if (!isActive) go(i); }}
              initial={false}
              animate={{
                x: offset * spacing,
                rotateY: offset === 0 ? 0 : offset < 0 ? rotation : -rotation,
                scale: isActive ? 1 : Math.max(0.72, 1 - dist * 0.13),
                opacity: dist > 2 ? 0 : isActive ? 1 : 0.5 - (dist - 1) * 0.2,
                filter: isActive ? "brightness(1)" : "brightness(0.96)",
              }}
              transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
              style={{ width: itemWidth, maxWidth: "calc(100vw - 48px)", zIndex: total - dist, cursor: isActive ? "default" : "pointer" }}
            >
              {/* inert: side cards can't be tabbed into or clicked through; the click falls to the wrapper above, which brings the card to the front */}
              <div inert={!isActive}>{item}</div>
            </motion.div>
          );
        })}
      </motion.div>

      <div className="cf-controls">
        {arrow(-1)}
        <div className="cf-dots" role="group" aria-label="Choose a market">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              className="cf-dot"
              aria-label={itemLabels[i]}
              aria-current={i === active}
              onClick={() => go(i)}
              style={{ width: i === active ? 22 : 8 }}
            />
          ))}
        </div>
        {arrow(1)}
      </div>

      <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {announce ? announce(active, total) : `${itemLabels[active]}, ${active + 1} of ${total}`}
      </div>
    </div>
  );
}

export default Coverflow;
