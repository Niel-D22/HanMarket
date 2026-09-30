import type React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadCormorant } from "@remotion/google-fonts/CormorantGaramond";

/* HanMarket intro, 5 seconds at 30 fps, 1920x1080.
   A drop of ink falls on rice paper and blooms; the gold coin turns up out of the stain, catches one glint of light;
   the wordmark writes itself in, a red rule is drawn, the tagline follows. The whole frame drifts in slowly.
   The coin frames are renders of the website's own 3D model (public/hero/emblem.glb), exported with a transparent
   background; the paper, mountains and mist are the website's hero layers. */

const { fontFamily: SANS } = loadMontserrat("normal", { weights: ["500"], subsets: ["latin"] });
const { fontFamily: SERIF } = loadCormorant("normal", { weights: ["600"], subsets: ["latin"] });

const PAPER = "#F6F2EB";
const INK = "#17140F";
const RED = "#C8102E";
const STONE = "#6B645A";

/** where the drop lands and the coin stands */
const CENTER = { x: 960, y: 385 };
const COIN_PX = 440; // the coin frames are 900px with the coin filling ~83%, so the coin shows ~365px across

// timeline, in frames
const T = { drop: 0, impact: 9, coinIn: 12, spinFrames: 48, glint: 62, glintFrames: 24, title: 64, rule: 98, tagline: 102, sub: 114 };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function Landscape({ f }: { f: number }) {
  const rise = interpolate(f, [0, 36], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const layer = (src: string, depth: number, style: React.CSSProperties) => (
    <Img
      src={staticFile(src)}
      style={{
        position: "absolute", ...style,
        // nearer layers grow more as the camera moves in, and settle up from slightly lower
        transform: `translateY(${(1 - rise) * 40 * depth}px) scale(${1 + (f / 150) * 0.05 * depth})`,
        transformOrigin: "50% 60%",
      }}
    />
  );
  const drift = interpolate(f, [0, 150], [0, -40]);
  return (
    <>
      {layer("scene/mountains-far.webp", 0.3, { left: -120, width: 2160, bottom: 300, opacity: 0.4 * rise })}
      {layer("scene/mountains-mid.webp", 0.7, { left: -160, width: 2240, bottom: -140, opacity: 0.5 * rise })}
      <Img
        src={staticFile("scene/mist.webp")}
        style={{ position: "absolute", left: -300 + drift, width: 2600, bottom: -60, opacity: 0.75 * rise }}
      />
    </>
  );
}

function InkDrop({ f }: { f: number }) {
  // the drop: falls fast, stretched by its speed
  const fall = interpolate(f, [T.drop, T.impact], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  const dropY = -80 + (CENTER.y + 80) * fall;
  const dropOpacity = f < T.impact ? 1 : 0;

  // the bloom: spreads out from the impact, its edge roughened like ink soaking into paper
  const bloom = interpolate(f, [T.impact, T.impact + 34], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const r = 330 * bloom;
  const stain = interpolate(f, [T.impact, T.impact + 8, 70, 150], [0, 0.85, 0.16, 0.12], clamp);
  const splat = [
    [0.2, 1.0], [1.3, 0.8], [2.2, 1.1], [3.1, 0.7], [4.0, 1.05], [4.9, 0.85], [5.7, 0.95],
  ];
  return (
    <AbsoluteFill>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="ink" x="-50%" y="-50%" width="200%" height="200%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={3} seed={7} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={46} xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation={1.2} />
          </filter>
          <filter id="droplet" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={0.8} />
          </filter>
          <radialGradient id="wash">
            <stop offset="0%" stopColor={INK} stopOpacity={0.9} />
            <stop offset="55%" stopColor={INK} stopOpacity={0.55} />
            <stop offset="100%" stopColor={INK} stopOpacity={0} />
          </radialGradient>
        </defs>
        {f >= T.impact && (
          <>
            <g filter="url(#ink)" opacity={stain}>
              <circle cx={CENTER.x} cy={CENTER.y} r={r} fill="url(#wash)" />
            </g>
            {/* fine droplets thrown off by the impact: small, round and soft, not roughened like the stain */}
            <g filter="url(#droplet)" opacity={stain}>
              {splat.map(([a, d], i) => {
                const p = interpolate(f, [T.impact + 1 + i * 0.6, T.impact + 7 + i * 0.6], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
                const dist = (r * 0.92 + 30) * d;
                return <circle key={i} cx={CENTER.x + Math.cos(a) * dist} cy={CENTER.y + Math.sin(a) * dist} r={(2.5 + (i % 3) * 1.8) * p} fill={INK} />;
              })}
            </g>
          </>
        )}
        <ellipse cx={CENTER.x} cy={dropY} rx={9} ry={9 + 16 * fall} fill={INK} opacity={dropOpacity} />
      </svg>
    </AbsoluteFill>
  );
}

function Coin({ f, fps }: { f: number; fps: number }) {
  if (f < T.coinIn) return null;
  const local = f - T.coinIn;
  // spin in, then hold face-on; one glint crosses it; then rest
  let frame = Math.min(local, T.spinFrames - 1);
  if (f >= T.glint && f < T.glint + T.glintFrames) frame = T.spinFrames + (f - T.glint);
  const grow = spring({ frame: local, fps, config: { damping: 15, mass: 0.9 } });
  const scale = 0.55 + 0.45 * grow;
  const opacity = interpolate(local, [0, 8], [0, 1], clamp);
  const blur = interpolate(local, [0, 12], [8, 0], clamp);
  const float = Math.sin(f / 22) * 4; // a breath of movement once it has landed
  return (
    <Img
      src={staticFile(`coin/coin-${String(frame).padStart(3, "0")}.webp`)}
      style={{
        position: "absolute", width: COIN_PX, height: COIN_PX,
        left: CENTER.x - COIN_PX / 2, top: CENTER.y - COIN_PX / 2 + float,
        opacity, transform: `scale(${scale})`,
        filter: `blur(${blur}px) drop-shadow(0 28px 36px rgba(120, 84, 40, 0.28))`,
      }}
    />
  );
}

function Title({ f, fps }: { f: number; fps: number }) {
  const letters = "HANMARKET".split("");
  const rule = interpolate(f, [T.rule, T.rule + 16], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const tag = spring({ frame: f - T.tagline, fps, config: { damping: 200 } });
  const sub = interpolate(f, [T.sub, T.sub + 14], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center", top: 640 }}>
      <div style={{ display: "flex", fontFamily: SANS, fontWeight: 500, fontSize: 104, letterSpacing: "0.26em", marginRight: "-0.26em", color: INK, lineHeight: 1 }}>
        {letters.map((ch, i) => {
          const p = spring({ frame: f - T.title - i * 3, fps, config: { damping: 200 } });
          return (
            <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 34}px)`, filter: `blur(${(1 - p) * 8}px)` }}>
              {ch}
            </span>
          );
        })}
      </div>
      <div style={{ width: 110 * rule, height: 3, background: RED, marginTop: 30 }} />
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 54, color: INK, marginTop: 26, opacity: tag, transform: `translateY(${(1 - tag) * 18}px)` }}>
        Trade China. Beyond Borders.
      </div>
      <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: 19, letterSpacing: "0.42em", marginRight: "-0.42em", color: STONE, marginTop: 18, opacity: sub }}>
        CHINA EQUITIES · ONCHAIN
      </div>
    </AbsoluteFill>
  );
}

export const HanMarketIntro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const camera = interpolate(f, [0, 150], [1, 1.05]); // the whole frame drifts in, never still
  return (
    <AbsoluteFill style={{ background: PAPER, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${camera})` }}>
        <Img src={staticFile("scene/bg-paper.webp")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <Landscape f={f} />
        <InkDrop f={f} />
        <Coin f={f} fps={fps} />
      </AbsoluteFill>
      <Title f={f} fps={fps} />
      {/* a soft vignette keeps the eye in the middle */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(60,40,20,0.14) 100%)" }} />
    </AbsoluteFill>
  );
};
