import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { isCoarsePointer } from "../utils/useMediaQuery";
import type { MotionValue } from "motion/react";

/* ============================================================================
   The landscape behind the HanMarket hero: ink-wash mountains, the Great Wall
   and mist, each a separate transparent layer (made from the paintings in
   public/Asset Heroo by scripts/hero-scene.py). Kept to the brief's composition:
   paper, mountains, the Wall leading the eye in, the pagoda and its lantern, and
   nothing added around them. Calm over busy: every motion here is slow.

   Depth is one number per layer, 0 (horizon) to 1 (nearest). It drives all three
   motions, so the scene reads as a real space rather than a zoom on a picture:
   - intro: a camera zoom into the painting. Every layer grows about one
     vanishing point, the near ones much more, as if the viewer were walking in
     along the Wall.
   - scroll: the camera flies on through the scene. Near layers swell and fade
     as it passes them, until the clouds rise over the hero.
   - camera: the layers shift against the cursor, near ones further. When the
     cursor rests (and always on a phone) the camera drifts on its own, and it
     keeps walking slowly in and back out, one continuous loop with no cut.
   Mist and a little ink dust also drift on their own.
============================================================================ */

/** where the Great Wall disappears; every layer scales about this point so the dolly has one direction */
export const VANISHING_POINT = "64% 56%";

const INTRO_SECONDS = 7;
/** starts gently, travels, then settles over a long tail, like a camera move rather than a UI transition */
const INTRO_EASE = [0.45, 0.05, 0.15, 1] as const;
/** how much smaller the nearest layer starts, before the intro zoom brings it to full size */
const INTRO_DEPTH = 0.3;
/** extra scale of the nearest layer at the end of the hero's scroll */
const SCROLL_DEPTH = 1.2;
/** layers at least this near fade out while the scroll zoom carries the camera past them */
const PASSED_DEPTH = 0.6;
/** the stretch of the hero's scroll over which those near layers fade */
const PASS_FADE: [number, number] = [0.25, 0.6];
/** pixels the nearest layer moves when the pointer reaches the edge of the screen */
const POINTER_PX = { x: 30, y: 14 };
/** a resting cursor hands the camera back to its own drift after this long */
const IDLE_AFTER_MS = 2500;
/** the idle drift: two slow waves of different periods, so the path never visibly repeats */
const IDLE = { x: 0.6, y: 0.4, xSeconds: 23, ySeconds: 31 };
/** the continuous walk in and back out: extra scale of the nearest layer at the deepest point, and one loop's length */
const BREATH = { depth: 0.08, seconds: 20 };
/** past this much scroll the hero is out of view and the camera stops updating */
const HERO_SCROLL_VH = 2.5;

interface SceneLayer {
  src: string;
  width: number;
  height: number;
  depth: number;
  /** placement of the image inside the full-screen layer */
  style: CSSProperties;
  /** slow horizontal drift of its own, as a fraction of its width */
  drift?: { by: number; seconds: number };
  /** placement on phones; a layer without one is left out there, so a phone downloads less */
  narrow?: CSSProperties;
}

const LAYERS: SceneLayer[] = [
  { src: "/hero/scene/mountains-far.webp", width: 1440, height: 222, depth: 0.08, style: { left: "-14vw", width: "128vw", bottom: "29vh", opacity: 0.5 },
    narrow: { left: "-40vw", width: "180vw", top: "34vh", opacity: 0.45 } },
  { src: "/hero/scene/mist.webp", width: 1440, height: 195, depth: 0.38, style: { left: "-20vw", width: "140vw", bottom: "11vh", opacity: 0.75 }, drift: { by: -0.04, seconds: 38 },
    narrow: { left: "-50vw", width: "200vw", top: "48vh", opacity: 0.7 } },
  { src: "/hero/scene/mountains-mid.webp", width: 1920, height: 459, depth: 0.62, style: { left: "-14vw", width: "128vw", bottom: "-12vh", opacity: 0.6 },
    narrow: { left: "-45vw", width: "190vw", top: "44vh", opacity: 0.8 } },
  // the Wall in front of the middle range, below the headline and its buttons: the line the camera walks in along
  { src: "/hero/scene/great-wall.webp", width: 1920, height: 440, depth: 0.66, style: { left: "18vw", width: "64vw", bottom: "3vh", opacity: 0.95 },
    narrow: { left: "-30vw", width: "150vw", top: "38vh", opacity: 0.7 } },
  { src: "/hero/scene/mist.webp", width: 1440, height: 195, depth: 0.72, style: { left: "-20vw", width: "140vw", bottom: "-8vh", opacity: 0.6, transform: "scaleX(-1)" }, drift: { by: 0.05, seconds: 46 } },
];

export interface Camera {
  /** where the camera looks, -1 to 1 on each axis (0 = centre) */
  x: MotionValue<number>;
  y: MotionValue<number>;
  /** 0 to 1, the breathing push-in */
  breath: MotionValue<number>;
}

/**
 * The hero's camera. It follows the cursor; when the cursor rests, or on a touch screen, it drifts by itself, and it
 * breathes in and out the whole time. Everything holds still with reduced motion.
 */
export function useCamera(enabled: boolean): Camera {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const breath = useMotionValue(0);
  const calm = { stiffness: 40, damping: 18, mass: 0.8 };
  const sx = useSpring(x, calm);
  const sy = useSpring(y, calm);
  useEffect(() => {
    if (!enabled) return;
    let lastMove = -Infinity;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return; // a finger dragging the page is a scroll, not a look around
      lastMove = performance.now();
      x.set((e.clientX / window.innerWidth) * 2 - 1);
      y.set((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || window.scrollY > window.innerHeight * HERO_SCROLL_VH) return;
      const t = (now - start) / 1000;
      breath.set((1 - Math.cos((2 * Math.PI * t) / BREATH.seconds)) / 2);
      if (now - lastMove < IDLE_AFTER_MS) return;
      // the springs ease the hand-over, so the camera glides from the cursor's last spot into its drift
      x.set(IDLE.x * Math.sin((2 * Math.PI * t) / IDLE.xSeconds));
      y.set(IDLE.y * Math.sin((2 * Math.PI * t) / IDLE.ySeconds));
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [enabled, x, y, breath]);
  // one stable object, so effects that take the camera (CoinEmblem's WebGL scene) are not torn down on every render
  return useMemo(() => ({ x: sx, y: sy, breath }), [sx, sy, breath]);
}

/** Moves one layer for its depth: camera shift, breath and scroll dolly on the outside, intro dolly inside. */
export function useDepth(depth: number, progress: MotionValue<number>, camera: Camera, reduce: boolean | null) {
  const x = useTransform(camera.x, (v) => -v * depth * POINTER_PX.x);
  const y = useTransform(camera.y, (v) => -v * depth * POINTER_PX.y);
  const scale = useTransform([progress, camera.breath], ([p, b]: number[]) =>
    reduce ? 1 : (1 + p * depth * SCROLL_DEPTH) * (1 + b * depth * BREATH.depth));
  // a near layer the camera flies past fades away instead of filling the screen
  const opacity = useTransform(progress, PASS_FADE, reduce || depth < PASSED_DEPTH ? [1, 1] : [1, 0]);
  const intro = reduce
    ? {}
    : { initial: { scale: 1 - depth * INTRO_DEPTH }, animate: { scale: 1 }, transition: { duration: INTRO_SECONDS, ease: INTRO_EASE } };
  return { outer: { x, y, scale, opacity }, intro };
}

function Layer({ layer, index, progress, camera, reduce, narrow }: {
  layer: SceneLayer;
  index: number;
  narrow: boolean;
  progress: MotionValue<number>;
  camera: Camera;
  reduce: boolean | null;
}) {
  const { outer, intro } = useDepth(layer.depth, progress, camera, reduce);
  // each painting fades in once it has loaded, so a slow connection shows ink appearing rather than popping in
  const [loaded, setLoaded] = useState(false);
  const { transform, opacity, ...box } = narrow && layer.narrow ? layer.narrow : layer.style;
  const drift = layer.drift && !reduce
    ? {
        animate: { x: ["0%", `${layer.drift.by * 100}%`, "0%"] },
        transition: { duration: layer.drift.seconds, repeat: Infinity, ease: "easeInOut" as const },
      }
    : {};
  return (
    <motion.div className="hp-scene" style={{ ...outer, transformOrigin: VANISHING_POINT, zIndex: index }}>
      <motion.div className="hp-scene" style={{ transformOrigin: VANISHING_POINT }} {...intro}>
        <motion.div style={{ position: "absolute", ...box, opacity }} {...drift}>
          <img
            className="hp-scene-art" src={layer.src} alt="" width={layer.width} height={layer.height} decoding="async" draggable={false}
            ref={(img) => { if (img?.complete) setLoaded(true); }} onLoad={() => setLoaded(true)}
            style={{ display: "block", width: "100%", height: box.height ? "100%" : "auto", transform, opacity: loaded ? 1 : 0, transition: "opacity 1.4s ease" }}
          />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/** Fine ink dust drifting up through the scene. A canvas, paused while off screen or in a background tab. */
function InkMotes({ dark }: { dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // a phone draws the dust at 1x and with fewer motes: at its 3x screen a full-screen canvas is a lot of pixels
    const coarse = isCoarsePointer();
    const dpr = coarse ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      // a phone's address bar showing or hiding fires resize while scrolling; reallocating the canvas then stutters
      if (w === canvas.width && Math.abs(h - canvas.height) < 160 * dpr) return;
      canvas.width = w;
      canvas.height = h;
    };
    resize();
    window.addEventListener("resize", resize);

    // speed is screen heights per second: the slowest takes about a minute and a half to cross, the fastest half a minute
    const motes = Array.from({ length: coarse ? 16 : 32 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.5,
      speed: 0.011 + Math.random() * 0.022, phase: Math.random() * Math.PI * 2, alpha: 0.08 + Math.random() * 0.18,
    }));
    const tint = dark ? "236, 226, 210" : "58, 50, 42";

    let frame = 0;
    let visible = true;
    let last = performance.now();
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (!visible || document.hidden) { last = now; return; }
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const m of motes) {
        m.y -= m.speed * dt;
        m.x += Math.sin(now / 3000 + m.phase) * 0.0003;
        if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
        ctx.beginPath();
        ctx.arc(m.x * canvas.width, m.y * canvas.height, m.r * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${tint}, ${m.alpha})`;
        ctx.fill();
      }
    };
    frame = requestAnimationFrame(draw);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [dark]);
  return <canvas ref={ref} className="hp-scene" style={{ width: "100%", height: "100%", zIndex: 20 }} aria-hidden="true" />;
}

export function HeroScene({ progress, camera, reduce, dark, narrow }: {
  narrow: boolean;
  progress: MotionValue<number>;
  camera: Camera;
  reduce: boolean | null;
  dark: boolean;
}) {
  return (
    <div className="hp-scene" style={{ zIndex: 0 }} aria-hidden="true">
      {LAYERS.map((layer, i) => (narrow && !layer.narrow ? null : (
        <Layer key={`${layer.src}-${i}`} layer={layer} index={i} progress={progress} camera={camera} reduce={reduce} narrow={narrow} />
      )))}
      {/* keeps the headline readable where it sits over the landscape */}
      <div className="hp-scene hp-veil" style={{ zIndex: 19 }} />
      {!reduce && <InkMotes dark={dark} />}
    </div>
  );
}
