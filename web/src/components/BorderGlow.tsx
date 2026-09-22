import { useRef, useState } from "react";
import type { ReactNode, CSSProperties } from "react";

interface BorderGlowProps {
  children: ReactNode;
  edgeSensitivity?: number; // how far from the edge the glow starts reacting (px)
  glowColor?: string; // "R G B" triplet, used when `colors` isn't given
  backgroundColor?: string;
  borderRadius?: number;
  glowRadius?: number; // px, size of the cursor-follow glow
  glowIntensity?: number; // 0-1, opacity on hover
  coneSpread?: number; // how far the glow fades out, in % of glowRadius
  animated?: boolean; // rotating multi-color ring instead of cursor-follow
  colors?: string[]; // used for the animated ring, or as a multi-stop cursor glow
  style?: CSSProperties;
}

/** A border that glows where the cursor is (or spins through `colors` when `animated`). */
export function BorderGlow({
  children,
  edgeSensitivity = 30,
  glowColor = "255 135 3", // brand orange, as an "R G B" triplet
  backgroundColor = "#120F17",
  borderRadius = 20,
  glowRadius = 200,
  glowIntensity = 1,
  coneSpread = 30,
  animated = false,
  colors,
  style,
}: BorderGlowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--glow-x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--glow-y", `${e.clientY - rect.top}px`);
  };

  const stops = colors && colors.length ? colors.join(", ") : `rgb(${glowColor})`;
  const fade = Math.max(10, Math.min(90, coneSpread + 30));

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      style={{
        position: "relative",
        borderRadius,
        background: backgroundColor,
        isolation: "isolate",
        ...style,
      }}
    >
      {/* the glow ring: painted only into the border itself via mask-composite exclude */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius,
          padding: 1.5,
          background: animated
            ? `conic-gradient(from 0deg, ${stops}, ${stops.split(",")[0]})`
            : `radial-gradient(${glowRadius}px ${glowRadius}px at var(--glow-x, 50%) var(--glow-y, 50%), ${stops.split(",")[0]} 0%, transparent ${fade}%)`,
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          opacity: animated ? glowIntensity : active ? glowIntensity : glowIntensity * 0.3,
          transition: animated ? "none" : `opacity ${edgeSensitivity}ms ease`,
          animation: animated ? "borderglow-spin 5s linear infinite" : undefined,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      {animated && (
        <style>{`@keyframes borderglow-spin { to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`}</style>
      )}
    </div>
  );
}

export default BorderGlow;
