import type { FC, ReactNode } from "react";

export interface LogoLoopItem {
  label: string;
  node?: ReactNode;
  href?: string;
}

interface LogoLoopProps {
  items: LogoLoopItem[];
  speed?: number; // seconds for one full pass
  direction?: "left" | "right";
  color?: string;
  gap?: number;
  showLabels?: boolean; // false = logos only; the label is kept as the accessible name
  repeat?: number; // repeat a short list so one pass is wider than the screen (no empty gap in the loop)
}

/** Seamless CSS marquee: no external animation lib, pauses on hover, fades at the edges. */
export const LogoLoop: FC<LogoLoopProps> = ({
  items, speed = 28, direction = "left", color = "rgba(232,222,216,0.55)", gap = 48, showLabels = true, repeat = 1,
}) => {
  const pass = Array.from({ length: Math.max(1, repeat) }, () => items).flat();
  const track = [...pass, ...pass]; // duplicated once for a seamless loop
  const Chip = ({ item, hidden }: { item: LogoLoopItem; hidden: boolean }) => {
    const inner = (
      <span
        role={showLabels ? undefined : "img"}
        aria-label={showLabels || hidden ? undefined : item.label}
        aria-hidden={hidden || undefined}
        title={showLabels ? undefined : item.label}
        style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", color, fontSize: 14, fontWeight: 500 }}
      >
        {item.node}
        {showLabels && item.label}
      </span>
    );
    return item.href ? (
      <a href={item.href} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>{inner}</a>
    ) : inner;
  };

  return (
    <div
      style={{
        position: "relative", width: "100%", overflow: "hidden",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
        maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
      }}
    >
      <div
        className="logoloop-track"
        style={{
          display: "flex", alignItems: "center", width: "max-content", gap, paddingRight: gap,
          animation: `logoloop-${direction} ${speed}s linear infinite`,
        }}
      >
        {/* second copy exists only for the seamless loop, so screen readers skip it */}
        {track.map((item, i) => <Chip key={item.label + i} item={item} hidden={i >= items.length} />)}
      </div>
      <style>{`
        @keyframes logoloop-left { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes logoloop-right { from { transform: translateX(-50%); } to { transform: translateX(0); } }
        .logoloop-track:hover { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) { .logoloop-track { animation: none !important; } }
      `}</style>
    </div>
  );
};
