import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useSpring, useTransform, useReducedMotion, useMotionValue, useAnimation, animate } from "motion/react";
import type { MotionValue } from "motion/react";
import { Cloudscape } from "./Cloudscape";
import { useTheme } from "../theme/ThemeProvider";

/* ============================================================================
   HanMarket hero — layered ink-wash scene on rice paper.

   Intro: the page opens inside the clouds. Both cloud banks sink away to reveal
   the paper, the pagoda slides in, the lantern drops and swings to rest, the
   wordmark writes itself letter by letter and the 漢 seal is stamped last.

   Scroll: the section is taller than the screen and its content is `sticky`.
   Layers move at different speeds (parallax) and the clouds rise until they
   cover the hero. The next section is pulled up over the end of this one, so
   it rises out of the clouds instead of following a blank screen.

   Every layer is two nested elements: the outer one follows scroll, the inner
   one plays the intro, so the two animations never fight over `transform`.
============================================================================ */

export const IVORY = "var(--hm-bg)"; // the page ground; in light mode the ivory sampled from the bottom of the cloud art
const INK = "var(--hm-text)";
const HAN_RED = "var(--hm-red)";
const STONE = "var(--hm-stone)";

const SERIF = "'Cormorant Garamond', 'Noto Serif SC', Georgia, serif";
const WIDE = "'Montserrat', 'Inter Tight', system-ui, sans-serif";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_INOUT = [0.76, 0, 0.24, 1] as const;

/* intro timeline, in seconds */
const T = {
  clouds: 0.15,
  paper: 0,
  building: 0.75,
  mark: 1.05,
  word: 1.2,
  lantern: 1.35,
  tag: 1.85,
  sub: 2.05,
  rule: 2.2,
  cta: 2.35,
  seal: 2.55,
};

/** the fraction of the section's scroll at which the clouds have fully covered the hero */
const COVERED_AT = 0.8;
/** how far the next section is pulled up over the end of the hero (see Landing.tsx) */
export const HERO_OVERLAP = "70vh";

/** phones get a taller text block, so the clouds start lower and only rise once the visitor scrolls */
function useIsNarrow(query = "(max-width: 820px)") {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return narrow;
}

function useLayer(progress: MotionValue<number>, input: number[], output: string[], reduce: boolean | null) {
  return useTransform(progress, input, reduce ? output.map(() => output[0]) : output);
}

function Seal() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="6" fill={HAN_RED} />
      <rect x="6" y="6" width="52" height="52" rx="3" fill="none" stroke="#F6F2EB" strokeOpacity="0.55" strokeWidth="1.2" />
      <text x="32" y="44" textAnchor="middle" fontSize="36" fontFamily="'Noto Serif SC', serif" fontWeight="700" fill="#F6F2EB">漢</text>
    </svg>
  );
}

export function HanperpHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const narrow = useIsNarrow();
  const { theme } = useTheme();

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start start", "end end"] });
  // a light spring on scroll so the layers glide instead of snapping to wheel steps
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.35 });

  const bgY = useLayer(p, [0, 1], ["0vh", "6vh"], reduce);
  const bgScale = useTransform(p, [0, 1], reduce ? [1.04, 1.04] : [1.04, 1.12]);
  const buildingY = useLayer(p, [0, 1], ["0vh", "-18vh"], reduce);
  const buildingX = useLayer(p, [0, 1], ["0vw", "4vw"], reduce);
  const sealY = useLayer(p, [0, 1], ["0vh", "-28vh"], reduce);
  const textY = useLayer(p, [0, 1], ["0vh", "-22vh"], reduce);
  const textOpacity = useTransform(p, [0, 0.15, 0.45], [1, 1, 0]);
  // once faded out, the buttons must not keep catching clicks meant for the section rising over them
  const textPointer = useTransform(p, (v) => (v > 0.4 ? "none" : "auto"));
  const backCloudY = useLayer(p, [0, COVERED_AT], narrow ? ["86vh", "-12vh"] : ["58vh", "-12vh"], reduce);
  const frontCloudY = useLayer(p, [0, COVERED_AT], narrow ? ["104vh", "-80vh"] : ["82vh", "-80vh"], reduce);

  const skip = reduce ? { initial: false as const } : {};

  const fadeUp = (delay: number, y = 22) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 1, delay, ease: EASE_OUT },
        };

  const letters = "HANMARKET".split("");

  // the lantern: idle sway is these controls' own animation, so grabbing it can stop that animation
  // without fighting it, then hand back to it once the visitor lets go and it settles.
  const lanternRotate = useMotionValue(0);
  const lanternControls = useAnimation();
  const draggingLantern = useRef(false);
  const idleSway = () => {
    if (reduce || draggingLantern.current) return;
    lanternControls.start({ rotate: [-2.2, 2.2, -2.2], transition: { duration: 6, repeat: Infinity, ease: "easeInOut" } });
  };
  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(idleSway, (T.lantern + 3) * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  return (
    <section ref={sectionRef} aria-label="HanMarket" className="hp-hero" style={{ position: "relative", height: "230vh", background: IVORY }}>
      <style>{`
        .hp-sticky { position: sticky; top: 0; height: 100vh; height: 100svh; overflow: hidden; background: ${IVORY}; }
        .hp-layer { position: absolute; will-change: transform; }
        /* zoomed out a little: smaller pagoda, more paper around it */
        .hp-building { right: -2vw; top: 9vh; width: min(54vw, 126vh); aspect-ratio: 1536 / 1024; }
        .hp-content { position: absolute; inset: 0; display: flex; align-items: center; padding: 40px clamp(20px, 8vw, 150px) 0; z-index: 3; }
        .hp-brand { display: flex; align-items: center; gap: clamp(16px, 2.2vw, 34px); }
        .hp-mark { width: clamp(72px, 8vw, 128px); height: auto; filter: drop-shadow(0 14px 22px rgba(120,84,40,0.22)); }
        .hp-word { font-family: ${WIDE}; font-weight: 500; font-size: clamp(28px, 3.7vw, 60px); letter-spacing: 0.22em; line-height: 1; color: ${INK}; margin: 0; display: flex; }
        .hp-word span { display: inline-block; }
        .hp-tag { font-family: ${SERIF}; font-weight: 600; font-size: clamp(20px, 2.2vw, 34px); color: ${INK}; margin: 12px 0 0; line-height: 1.15; }
        .hp-sub { font-family: ${WIDE}; font-size: clamp(10.5px, 0.85vw, 13px); letter-spacing: 0.32em; color: ${STONE}; margin: 12px 0 0; }
        .hp-rule { width: 58px; height: 2px; background: ${HAN_RED}; margin-top: 20px; }
        .hp-cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
        .hp-btn { font-family: ${WIDE}; font-size: 14px; font-weight: 600; letter-spacing: 0.04em; text-decoration: none; padding: 13px 24px; border-radius: 999px; transition: transform .2s ease, background .2s ease, box-shadow .2s ease; display: inline-block; }
        .hp-btn--solid { background: ${HAN_RED}; color: var(--hm-on-red); box-shadow: 0 10px 26px rgba(var(--hm-red-c), 0.25); }
        .hp-btn--solid:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(var(--hm-red-c), 0.32); }
        .hp-btn--ghost { color: ${INK}; border: 1px solid rgba(var(--hm-line-c), 0.25); background: rgba(var(--hm-bg-c), 0.6); }
        .hp-btn--ghost:hover { background: rgba(var(--hm-line-c), 0.05); transform: translateY(-2px); }
        .hp-btn:focus-visible { outline: 2px solid ${HAN_RED}; outline-offset: 3px; }
        .hp-seal { right: clamp(18px, 4vw, 70px); top: 44vh; width: clamp(40px, 3.6vw, 60px); aspect-ratio: 1; z-index: 2; }
        /* hangs from the eave: ~52% across the art is where the roof underside ends, ~40% down */
        .hp-lantern { position: absolute; left: 44.8%; top: 39.5%; width: 14.5%; }
        /* the art's mist is cut flat at the bottom edge; fade it out so no line shows */
        .hp-building-art { -webkit-mask-image: linear-gradient(180deg, #000 58%, transparent 96%); mask-image: linear-gradient(180deg, #000 58%, transparent 96%); }
        .hp-clouds { left: 0; right: 0; z-index: 4; pointer-events: none; }
        /* the solid part fades in over its first 12vh, so where a cloud image ends there is no hard line */
        .hp-fill { background: linear-gradient(180deg, rgba(var(--hm-bg-c), 0) 0, ${IVORY} 12vh); height: 130vh; margin-top: -12vh; }
        @media (max-width: 820px) {
          .hp-building { width: 150vw; right: -62vw; top: 7vh; opacity: .9; }
          .hp-content { align-items: flex-end; padding: 0 22px 12vh; }
          .hp-brand { flex-direction: column; align-items: flex-start; gap: 14px; }
          .hp-mark { width: 64px; }
          .hp-word { font-size: clamp(24px, 7.6vw, 38px); letter-spacing: 0.16em; }
          .hp-tag { font-size: 22px; }
          .hp-sub { font-size: 10.5px; letter-spacing: 0.24em; }
          .hp-cta { margin-top: 24px; }
          .hp-btn { padding: 13px 20px; }
          .hp-seal { top: 13vh; right: 22px; width: 38px; }
          .hp-content::before { content: ""; position: absolute; inset: 35% 0 0 0; background: linear-gradient(180deg, rgba(var(--hm-bg-c), 0), ${IVORY} 40%); z-index: -1; pointer-events: none; }
        }
        @media (prefers-reduced-motion: reduce) { .hp-btn { transition: none; } }
      `}</style>

      <div className="hp-sticky">
        {/* 1. paper + mountains: settles from a slight zoom */}
        <motion.div className="hp-layer" style={{ inset: 0, y: bgY, scale: bgScale }}>
          <motion.img
            src="/hero/bg-paper.webp" alt="" width={1672} height={941}
            {...(reduce ? {} : { initial: { scale: 1.12 }, animate: { scale: 1 }, transition: { duration: 3.2, delay: T.paper, ease: EASE_OUT } })}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "right center", display: "block" }}
          />
        </motion.div>

        {/* 2. pagoda roof, with the lantern hanging from its eave */}
        <motion.div className="hp-layer hp-building" style={{ x: buildingX, y: buildingY, zIndex: 1 }}>
          <motion.div
            style={{ position: "relative", width: "100%", height: "100%" }}
            {...(reduce ? {} : {
              initial: { opacity: 0, x: 120, y: 30 },
              animate: { opacity: 1, x: 0, y: 0 },
              transition: { duration: 1.8, delay: T.building, ease: EASE_OUT },
            })}
          >
            <img className="hp-building-art" src="/hero/building.webp" alt="" width={1536} height={1024} style={{ width: "100%", height: "100%", display: "block" }} />
            <motion.div
              className="hp-lantern"
              {...(reduce ? {} : {
                initial: { opacity: 0, y: "-60%" },
                animate: { opacity: 1, y: "0%" },
                transition: { y: { type: "spring", stiffness: 70, damping: 11, delay: T.lantern }, opacity: { duration: 0.4, delay: T.lantern } },
              })}
            >
              {/* outer: a big swing when it lands that dies down; inner: the endless gentle sway */}
              <motion.div
                style={{ transformOrigin: "50% 1%" }}
                {...(reduce ? {} : {
                  initial: { rotate: 0 },
                  animate: { rotate: [0, 9, -6, 3.5, -1.8, 0] },
                  transition: { duration: 3.2, delay: T.lantern + 0.35, ease: "easeInOut" },
                })}
              >
                <motion.img
                  src="/hero/lantern.webp" alt="" width={640} height={960}
                  style={{ width: "100%", height: "auto", display: "block", transformOrigin: "50% 1%", rotate: lanternRotate }}
                  animate={lanternControls}
                  {...(reduce ? {} : {
                    onHoverStart: () => {
                      draggingLantern.current = true; // reuse as a generic "idle sway is suspended" flag
                      lanternControls.stop();
                      animate(lanternRotate, [lanternRotate.get(), 16, -11, 6.5, -3.5, 1.5, 0], { duration: 1.7, ease: "easeInOut" })
                        .then(() => { draggingLantern.current = false; idleSway(); });
                    },
                  })}
                />
              </motion.div>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* 3. 漢 seal: stamped onto the paper last */}
        <motion.div className="hp-layer hp-seal" style={{ y: sealY }}>
          <motion.div
            style={{ width: "100%", height: "100%" }}
            {...(reduce ? skip : {
              initial: { opacity: 0, scale: 1.9, rotate: -14 },
              animate: { opacity: 1, scale: 1, rotate: 0 },
              transition: { duration: 0.45, delay: T.seal, ease: [0.5, 0, 0.75, 0] },
            })}
          >
            <Seal />
          </motion.div>
        </motion.div>

        {/* 4. headline — the container itself never captures pointer events: it is a full-screen flex box,
            and with pointer-events: auto here it silently ate every hover/drag meant for the lantern and
            pagoda sitting behind it (they share screen space; the container's empty flex space doesn't
            know that). Only the two CTA links below need to be clickable, so they carry pointer-events. */}
        <motion.div className="hp-content" style={{ y: textY, opacity: textOpacity, pointerEvents: "none" }}>
          <div>
            <div className="hp-brand">
              <motion.img
                className="hp-mark" src="/brand/hanmarket-mark.png" alt="" width={238} height={238}
                {...(reduce ? {} : {
                  initial: { opacity: 0, rotateY: -80, scale: 0.8 },
                  animate: { opacity: 1, rotateY: 0, scale: 1 },
                  transition: { duration: 1.3, delay: T.mark, ease: EASE_OUT },
                })}
                style={{ transformPerspective: 800 }}
              />
              <div>
                <h1 className="hp-word" aria-label="HanMarket">
                  {letters.map((ch, i) => (
                    <motion.span
                      key={i}
                      aria-hidden="true"
                      {...(reduce ? {} : {
                        initial: { opacity: 0, y: "0.6em" },
                        animate: { opacity: 1, y: "0em" },
                        transition: { duration: 0.8, delay: T.word + i * 0.07, ease: EASE_OUT },
                      })}
                    >
                      {ch}
                    </motion.span>
                  ))}
                </h1>
                <motion.p className="hp-tag" {...fadeUp(T.tag)}>Trade China. Beyond Borders.</motion.p>
                <motion.p className="hp-sub" {...fadeUp(T.sub, 12)}>CHINA EQUITIES. ONCHAIN.</motion.p>
                <motion.div
                  className="hp-rule"
                  {...(reduce ? {} : { initial: { scaleX: 0 }, animate: { scaleX: 1 }, transition: { duration: 0.9, delay: T.rule, ease: EASE_INOUT } })}
                  style={{ transformOrigin: "0% 50%" }}
                />
              </div>
            </div>
            <motion.div className="hp-cta" style={{ pointerEvents: textPointer }} {...fadeUp(T.cta)}>
              <Link to="/terminal" className="hp-btn hp-btn--solid">Start Trading →</Link>
              <Link to="/#markets" className="hp-btn hp-btn--ghost">View Markets</Link>
            </motion.div>
          </div>
        </motion.div>

        {/* 5. back clouds: illustrated ink clouds, higher than the front bank so they stay visible, shown uncropped */}
        <motion.div className="hp-layer hp-clouds" style={{ top: 0, y: backCloudY }}>
          <motion.div
            {...(reduce ? {} : { initial: { y: "-140vh" }, animate: { y: "0vh" }, transition: { duration: 2.6, delay: T.clouds + 0.15, ease: EASE_INOUT } })}
          >
            <motion.div
              animate={reduce ? undefined : { x: ["0%", "-2.5%", "0%"] }}
              transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
              style={{ marginLeft: "-4vw", marginRight: "-4vw" }}
            >
              <img src="/hero/clouds-back.webp" alt="" width={2172} height={724} style={{ display: "block", width: "100%", height: "auto" }} />
              <div className="hp-fill" />
            </motion.div>
          </motion.div>
        </motion.div>

        {/* 6. soft shader clouds: thin and wispy on top, ivory at the bottom; they finish covering the hero */}
        <motion.div className="hp-layer hp-clouds" style={{ top: 0, y: frontCloudY, zIndex: 5 }}>
          <motion.div
            {...(reduce ? {} : { initial: { y: "-190vh" }, animate: { y: "0vh" }, transition: { duration: 2.4, delay: T.clouds, ease: EASE_INOUT } })}
          >
            <Cloudscape fadeTop height="80vh" speed={0.3} {...(theme === "dark" ? { colorBottom: "#0C0A09", colorMid: "#13110F", colorTop: "#2B2621" } : { colorBottom: "#E4DCCF", colorMid: "#F6F2EB", colorTop: "#FFFFFF" })} />
            <div className="hp-fill" style={{ background: IVORY, marginTop: -2 }} />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

export default HanperpHero;
