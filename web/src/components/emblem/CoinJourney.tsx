import { useEffect, useRef } from "react";
import { motion } from "motion/react";
// type-only and the shared constant: three.js itself arrives with the dynamic import below, in its own chunk
import type { EmblemScene } from "./emblemScene";
import { CANVAS_SCALE } from "./constants";
import { isCoarsePointer } from "../../utils/useMediaQuery";

/* ============================================================================
   The HanMarket coin's journey down the landing page.

   The 3D coin (public/hero/emblem.glb) lives in one fixed layer above the page.
   It starts in the hero's logo slot (HeroCoinSlot), spins in and grows a little
   with the hero's scroll, then moves down the page from dock to dock. Every
   section up to the FAQ keeps a place for it in its own layout (CoinDock):
   beside the product panel, next to the How It Works and Markets titles, and in
   the FAQ's side column, where it stays and scrolls away with the page.

   Docked, the coin is fastened to its dock and scrolls with the page, swelling a
   little as the dock nears the middle of the screen. Between docks it does not
   travel across the content: it fades out where it was and fades back in at the
   next dock, settling with a short turn.

   With reduced motion it never takes off: every dock shows the flat logo.
============================================================================ */

const MODEL_URL = "/hero/emblem.glb";
/** stacking: above the hero, below the page's sections (lp-section: 6) */
export const COIN_LAYER_Z = 5;
/** the coin rests in a dock for at most this much scroll either side of the dock being centred on screen */
const HOLD_HALF = 0.22;
/** every move between docks gets at least this much scroll, as a fraction of the screen height */
const MIN_FLIGHT = 0.6;
/** a move fades the coin out over its first stretch of scroll and back in over its last */
const FADE = 0.3;
/** how much smaller the coin is at the moment it disappears and reappears */
const SHRINK = 0.15;
/** the coin grows to this multiple of its slot over the first part of the hero's scroll */
const HERO_ZOOM = 1.5;
/** the entrance, after the hero's own intro delay: seconds to spin in and grow from nothing */
const INTRO_SECONDS = 1.8;
/** a highlight crosses the coin once per this many seconds, taking GLINT_SWEEP of them */
const GLINT_EVERY = 4.2;
const GLINT_SWEEP = 1.3;
/** how quickly the journey catches up with the scroll (the page itself scrolls smoothly too); lower is floatier */
const FOLLOW = 5;

interface Pose {
  x: number; // viewport px, the coin's centre
  y: number;
  size: number; // px across
  spin: number; // radians about the vertical axis
  opacity: number;
}

/** A dock as laid out. Measured now and then, so the frame loop never has to read the page's layout. */
interface DockSpot {
  x: number; // viewport x of its centre (the page never scrolls sideways)
  y: number; // document y of its centre
  size: number;
  holdFrom: number; // the scroll positions between which the coin rests in it
  holdTo: number;
  /** the FAQ's dock rides down its column: the column's sticky top, where it starts, and where it lets go */
  sticky?: { top: number; naturalTop: number; offset: number; lastTop: number };
}

interface Layout {
  heroRange: number; // scroll length of the hero's sticky stage
  /** the hero slot's centre with the hero's text at rest; the text's scroll offset is added every frame */
  slot: { x: number; y: number; size: number };
  docks: DockSpot[];
}

const TURN = Math.PI * 2;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The hero text's vertical offset, from the inline transform motion writes on it: no layout read. */
function heroTextOffset(content: HTMLElement | null): number {
  const m = content?.style.transform.match(/translateY\((-?[\d.]+)(px|vh)\)/);
  if (!m) return 0;
  return m[2] === "vh" ? (Number(m[1]) * window.innerHeight) / 100 : Number(m[1]);
}

/** The hero's stage is sticky for `heroRange` px of scroll, then scrolls away with the page. */
const heroLift = (scroll: number, heroRange: number) => Math.min(0, heroRange - scroll);

function measure(slot: HTMLElement, content: HTMLElement | null): Layout {
  const V = window.innerHeight;
  const scroll = window.scrollY;
  const hero = document.querySelector<HTMLElement>(".hp-hero");
  const heroRange = hero ? hero.offsetHeight - V : V;
  const s = slot.getBoundingClientRect();
  const slotSpot = { x: s.left + s.width / 2, y: s.top + s.height / 2 - heroTextOffset(content) - heroLift(scroll, heroRange), size: s.width };

  const docks = [...document.querySelectorAll<HTMLElement>("[data-coin-dock]")].flatMap((el): DockSpot[] => {
    const r = el.getBoundingClientRect();
    if (r.width === 0) return []; // hidden at this screen size
    const x = r.left + r.width / 2;
    if (el.dataset.coinDock === "sticky" && el.parentElement?.parentElement) {
      const side = el.parentElement;
      const column = side.parentElement!.getBoundingClientRect();
      const sideRect = side.getBoundingClientRect();
      const naturalTop = column.top + scroll; // the side column starts at the top of its grid row
      const offset = r.top - sideRect.top + r.height / 2;
      const sticky = { top: parseFloat(getComputedStyle(side).top) || 0, naturalTop, offset, lastTop: column.bottom + scroll - sideRect.height };
      const centred = naturalTop + offset - V / 2;
      // it rides down its column, so it keeps the coin until the column is nearly done
      return [{ x, y: naturalTop + offset, size: r.width, holdFrom: centred - HOLD_HALF * V, holdTo: Math.max(centred, column.bottom + scroll - 0.8 * V), sticky }];
    }
    const y = r.top + r.height / 2 + scroll;
    const centred = y - V / 2; // the scroll at which this dock sits in the middle of the screen
    return [{ x, y, size: r.width, holdFrom: centred - HOLD_HALF * V, holdTo: centred + HOLD_HALF * V }];
  });
  // Pace: a flight squeezed into a short stretch of scroll reads as the coin jumping. Where two docks are close,
  // they hold the coin for less, so the flight between them always gets at least MIN_FLIGHT of a screen.
  for (let i = 1; i < docks.length; i++) {
    const a = docks[i - 1];
    const b = docks[i];
    const short = MIN_FLIGHT * V - (b.holdFrom - a.holdTo);
    if (short > 0) {
      a.holdTo = Math.max(a.holdFrom, a.holdTo - short / 2);
      b.holdFrom = Math.min(b.holdTo, b.holdFrom + short / 2);
    }
  }
  return { heroRange, slot: slotSpot, docks };
}

/** A dock's centre on screen at this scroll. */
function dockY(d: DockSpot, scroll: number) {
  if (!d.sticky) return d.y - scroll;
  const { top, naturalTop, offset, lastTop } = d.sticky;
  return Math.min(Math.max(naturalTop - scroll, top), lastTop - scroll) + offset;
}

/** The coin at rest in a dock: fastened to it, swelling a little as the dock nears the middle of the screen. */
function docked(d: DockSpot, scroll: number, index: number): Pose {
  const V = window.innerHeight;
  const y = dockY(d, scroll);
  const centred = 1 - Math.min(1, Math.abs(y / V - 0.5) * 2); // 1 at the middle of the screen, 0 at its edges
  return {
    x: d.x,
    y,
    size: d.size * (0.9 + 0.14 * centred),
    // each dock faces the coin a little differently, and it keeps turning slowly while the page scrolls past
    spin: (index + 1) * TURN + (index % 2 ? -0.45 : 0.45) + ((scroll - d.holdFrom) / V) * 0.5,
    opacity: 1,
  };
}

/**
 * The coin's pose. `journey` is the smoothed scroll that says how far along the path the coin is; `scroll` places the
 * docks and the hero slot on screen, so a docked coin moves exactly with its section.
 */
function poseAt(journey: number, scroll: number, L: Layout, textOffset: number): Pose {
  const hero = { x: L.slot.x, y: L.slot.y + textOffset + heroLift(scroll, L.heroRange) };
  // in the hero: grows from the slot's size over the first 30% of the hero's scroll, turning once
  const zoomEnd = L.heroRange * 0.3;
  const heroPose = (t: number): Pose => ({ ...hero, size: L.slot.size * mix(1, HERO_ZOOM, t), spin: TURN * t, opacity: 1 });
  if (journey <= zoomEnd || L.docks.length === 0) return heroPose(smooth(clamp01(journey / zoomEnd)));

  // docked at dock i, or moving from the previous stop to it
  let from: Pose = heroPose(1);
  let leave = zoomEnd;
  for (let i = 0; i < L.docks.length; i++) {
    const d = L.docks[i];
    if (journey < d.holdFrom) {
      // A teleport, not a flight: the coin fades out where it was (still fastened to that spot as it scrolls away),
      // is gone for the middle of the move, and fades in at the next dock with a short settling turn.
      const t = clamp01((journey - leave) / Math.max(1, d.holdFrom - leave));
      if (t < 0.5) {
        const out = easeOutCubic(clamp01(t / FADE));
        return { ...from, size: from.size * (1 - SHRINK * out), spin: from.spin + out * 0.6, opacity: 1 - out };
      }
      const to = docked(d, scroll, i);
      const arrive = easeOutCubic(clamp01((t - (1 - FADE)) / FADE));
      return { ...to, size: to.size * (1 - SHRINK * (1 - arrive)), spin: to.spin - (1 - arrive) * 1.2, opacity: arrive };
    }
    if (journey <= d.holdTo || i === L.docks.length - 1) return docked(d, scroll, i);
    from = docked(d, scroll, i);
    leave = d.holdTo;
  }
  return from;
}

/** The space the coin starts from in the hero, with the flat logo in it until the 3D coin has taken over. */
export function HeroCoinSlot({ delay, reduce }: { delay: number; reduce: boolean | null }) {
  return (
    <div className="hp-coin" data-coin-slot="">
      <motion.img
        className="hp-coin-flat" src="/brand/hanmarket-mark.png" alt="" width={238} height={238}
        {...(reduce ? {} : { initial: { opacity: 0, scale: 0.8 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.8, delay } })}
      />
    </div>
  );
}

/**
 * A place for the coin in a section's layout: empty space while the coin is elsewhere; with reduced motion (or no
 * WebGL) it shows the flat logo instead. `sticky` marks the FAQ's dock, which rides down its column.
 */
export function CoinDock({ className = "", sticky = false }: { className?: string; sticky?: boolean }) {
  return (
    <div className={`coin-dock ${className}`} data-coin-dock={sticky ? "sticky" : ""} aria-hidden="true">
      <img className="coin-dock-flat" src="/brand/hanmarket-mark.png" alt="" width={238} height={238} loading="lazy" />
    </div>
  );
}

export function CoinJourney({ delay, reduce }: {
  /** seconds after mount before the coin spins in, matching the hero's intro */
  delay: number;
  reduce: boolean | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const fx = fxRef.current;
    const canvas = canvasRef.current;
    const slot = document.querySelector<HTMLElement>("[data-coin-slot]");
    if (reduce || !wrap || !fx || !canvas || !slot) return;
    let disposed = false;
    let frame = 0;
    let scene: EmblemScene | undefined;
    const cleanups: (() => void)[] = [];

    (async () => {
      try {
        const { createEmblemScene } = await import("./emblemScene");
        if (disposed) return;
        scene = await createEmblemScene(canvas, MODEL_URL);
      } catch (e) {
        console.warn("3D coin unavailable, keeping the flat logo", e);
        return;
      }
      if (disposed) { scene.dispose(); return; }
      const s = scene;

      const content = document.querySelector<HTMLElement>(".hp-content");
      let layout = measure(slot, content);
      // the coin is small, so a phone's 3x screen gains nothing past 1.5x but pays for every extra pixel
      const dpr = Math.min(window.devicePixelRatio || 1, isCoarsePointer() ? 1.5 : 1.75);
      let canvasPx = 0;
      const remeasure = () => {
        layout = measure(slot, content);
        const px = Math.round(layout.slot.size * CANVAS_SCALE);
        // a phone's address bar showing or hiding fires resize mid-scroll: only rebuild the canvas if its size changed
        if (px === canvasPx) return;
        canvasPx = px;
        canvas.style.width = canvas.style.height = `${px}px`;
        fx.style.width = fx.style.height = `${layout.slot.size}px`;
        s.resize(px, px, dpr);
      };
      remeasure();
      window.addEventListener("resize", remeasure);
      // sections change height as images, fonts and reveal animations settle; a rare re-measure keeps the docks true
      const settle = window.setInterval(() => { layout = measure(slot, content); }, 1500);
      cleanups.push(() => { window.removeEventListener("resize", remeasure); window.clearInterval(settle); });

      let pointerX = 0;
      let pointerY = 0;
      const onPointer = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        pointerX = (e.clientX / window.innerWidth) * 2 - 1;
        pointerY = (e.clientY / window.innerHeight) * 2 - 1;
      };
      window.addEventListener("pointermove", onPointer, { passive: true });
      cleanups.push(() => window.removeEventListener("pointermove", onPointer));

      const start = performance.now() + delay * 1000;
      let last = performance.now();
      let journey = window.scrollY;
      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        if (document.hidden) { last = now; return; }
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        // the path follows the scroll with a little weight, so fades and turns ease instead of snapping to each wheel
        // step; where the coin is attached to the page (the hero slot, a dock) it still moves exactly with the page
        journey = mix(journey, window.scrollY, 1 - Math.exp(-dt * FOLLOW));
        const cur = poseAt(journey, window.scrollY, layout, heroTextOffset(content));
        const base = layout.slot.size;

        const t = (now - start) / 1000;
        const intro = clamp01(t / INTRO_SECONDS);
        const zoom = (cur.size / base) * easeOutBack(intro);
        wrap.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
        wrap.style.opacity = String(cur.opacity);
        fx.style.transform = `translate(-50%, -50%) scale(${Math.max(zoom, 0)})`;
        if (cur.opacity < 0.01 || cur.y < -base * 2 || cur.y > window.innerHeight + base * 2) return; // nothing to draw

        const glintPhase = t > INTRO_SECONDS ? ((t - INTRO_SECONDS) % GLINT_EVERY) / GLINT_SWEEP : 2;
        s.render({
          // spins in (one and a half turns, slowing to a stop), then rocks very slightly; the journey adds its own turns
          spin: (1 - easeOutCubic(intro)) * Math.PI * 3 + Math.sin(t * 0.5) * 0.16 + cur.spin,
          tiltX: pointerY * 0.18 + Math.sin(t * 0.4) * 0.05,
          tiltY: pointerX * 0.3,
          zoom,
          glint: glintPhase <= 1 ? glintPhase * 2 - 1 : 2,
        });
      };
      frame = requestAnimationFrame(loop);
      // hand over from the flat logo once the first frames are drawn
      window.setTimeout(() => { if (!disposed) { document.documentElement.dataset.coinLive = ""; wrap.dataset.live = ""; } }, 60);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cleanups.forEach((fn) => fn());
      delete document.documentElement.dataset.coinLive;
      scene?.dispose();
    };
  }, [delay, reduce]);

  if (reduce) return null;
  return (
    <div ref={wrapRef} className="coin-journey" aria-hidden="true">
      <div ref={fxRef} className="coin-fx">
        <div className="coin-halo" />
      </div>
      <canvas ref={canvasRef} className="coin-canvas" />
    </div>
  );
}

/** Styles for the slot (rendered by the hero) and the flying coin. */
export const COIN_CSS = `
  .hp-coin { position: relative; width: clamp(110px, 10vw, 168px); aspect-ratio: 1; }
  .hp-coin-flat { position: absolute; inset: 0; width: 100%; height: 100%; filter: drop-shadow(0 14px 22px rgba(120,84,40,0.22)); transition: opacity .5s ease; }
  :root[data-coin-live] .hp-coin-flat { opacity: 0 !important; }

  /* docks: the coin's place in each section's layout */
  .coin-dock { position: relative; width: var(--dock, clamp(150px, 15vw, 210px)); aspect-ratio: 1; flex: none; }
  .coin-dock-flat { position: absolute; inset: 6%; width: 88%; height: 88%; opacity: 0; transition: opacity .5s ease; }
  :root:not([data-coin-live]) .coin-dock-flat { opacity: 1; }

  .coin-journey { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: ${COIN_LAYER_Z}; pointer-events: none; will-change: transform; }
  .coin-journey:not([data-live]) { visibility: hidden; }
  .coin-canvas { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); }
  .coin-fx { position: absolute; left: 0; top: 0; }
  /* a still, faint warmth behind the gold; no pulse, no sparkles */
  .coin-halo { position: absolute; inset: -30%; border-radius: 50%;
    background: radial-gradient(circle, rgba(232, 190, 110, 0.22) 0%, rgba(232, 190, 110, 0.07) 40%, rgba(232, 190, 110, 0) 68%); }
`;
