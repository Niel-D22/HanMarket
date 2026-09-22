import { useRef, useEffect, useState, useCallback } from "react";
import type { ReactNode, CSSProperties, RefObject } from "react";
import { gsap } from "gsap";
import { useInView } from "motion/react";

/* ============================================================================
   MagicBento — bento card grid with a cursor spotlight, per-card border glow,
   floating particles and a click ripple (GSAP). Ported from the React Bits
   component to this project's plain-CSS stack: Tailwind classes became the
   .mb-* rules below, and cards take real content (`visual`) plus an optional
   full-bleed `background` layer instead of fixed placeholder text.
============================================================================ */

export interface BentoCard {
  label: string;
  title: string;
  description: string;
  visual?: ReactNode;
  background?: ReactNode;
}

interface MagicBentoProps {
  cards: BentoCard[];
  textAutoHide?: boolean;
  enableStars?: boolean;
  enableSpotlight?: boolean;
  enableBorderGlow?: boolean;
  disableAnimations?: boolean;
  spotlightRadius?: number;
  particleCount?: number;
  enableTilt?: boolean;
  glowColor?: string; // "R, G, B"
  clickEffect?: boolean;
  enableMagnetism?: boolean;
}

const MOBILE_BREAKPOINT = 768;

const createParticleElement = (x: number, y: number, color: string) => {
  const el = document.createElement("div");
  el.className = "mb-particle";
  el.style.cssText = `
    position:absolute;width:4px;height:4px;border-radius:50%;
    background:rgba(${color},1);box-shadow:0 0 6px rgba(${color},0.6);
    pointer-events:none;z-index:100;left:${x}px;top:${y}px;
  `;
  return el;
};

const updateCardGlowProperties = (card: HTMLElement, mouseX: number, mouseY: number, glow: number, radius: number) => {
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--glow-x", `${((mouseX - rect.left) / rect.width) * 100}%`);
  card.style.setProperty("--glow-y", `${((mouseY - rect.top) / rect.height) * 100}%`);
  card.style.setProperty("--glow-intensity", glow.toString());
  card.style.setProperty("--glow-radius", `${radius}px`);
};

interface ParticleCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  disableAnimations?: boolean;
  particleCount: number;
  glowColor: string;
  enableStars: boolean;
  enableTilt: boolean;
  clickEffect: boolean;
  enableMagnetism: boolean;
}

function ParticleCard({
  children, className = "", style, disableAnimations = false, particleCount, glowColor,
  enableStars, enableTilt, clickEffect, enableMagnetism,
}: ParticleCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLElement[]>([]);
  const timeoutsRef = useRef<number[]>([]);
  const isHoveredRef = useRef(false);
  const memoizedParticles = useRef<HTMLElement[]>([]);
  const particlesInitialized = useRef(false);
  const magnetismAnimationRef = useRef<gsap.core.Tween | null>(null);

  const initializeParticles = useCallback(() => {
    if (particlesInitialized.current || !cardRef.current) return;
    const { width, height } = cardRef.current.getBoundingClientRect();
    memoizedParticles.current = Array.from({ length: particleCount }, () =>
      createParticleElement(Math.random() * width, Math.random() * height, glowColor)
    );
    particlesInitialized.current = true;
  }, [particleCount, glowColor]);

  const clearAllParticles = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    magnetismAnimationRef.current?.kill();
    particlesRef.current.forEach((particle) => {
      gsap.to(particle, {
        scale: 0, opacity: 0, duration: 0.3, ease: "back.in(1.7)",
        onComplete: () => { particle.parentNode?.removeChild(particle); },
      });
    });
    particlesRef.current = [];
  }, []);

  const animateParticles = useCallback(() => {
    if (!cardRef.current || !isHoveredRef.current) return;
    if (!particlesInitialized.current) initializeParticles();

    memoizedParticles.current.forEach((particle, index) => {
      const timeoutId = window.setTimeout(() => {
        if (!isHoveredRef.current || !cardRef.current) return;
        const clone = particle.cloneNode(true) as HTMLElement;
        cardRef.current.appendChild(clone);
        particlesRef.current.push(clone);

        gsap.fromTo(clone, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(1.7)" });
        gsap.to(clone, {
          x: (Math.random() - 0.5) * 100, y: (Math.random() - 0.5) * 100, rotation: Math.random() * 360,
          duration: 2 + Math.random() * 2, ease: "none", repeat: -1, yoyo: true,
        });
        gsap.to(clone, { opacity: 0.3, duration: 1.5, ease: "power2.inOut", repeat: -1, yoyo: true });
      }, index * 100);
      timeoutsRef.current.push(timeoutId);
    });
  }, [initializeParticles]);

  useEffect(() => {
    if (disableAnimations || !cardRef.current) return;
    const element = cardRef.current;

    const handleMouseEnter = () => {
      isHoveredRef.current = true;
      if (enableStars) animateParticles();
      if (enableTilt) {
        gsap.to(element, { rotateX: 5, rotateY: 5, duration: 0.3, ease: "power2.out", transformPerspective: 1000 });
      }
    };

    const handleMouseLeave = () => {
      isHoveredRef.current = false;
      clearAllParticles();
      if (enableTilt) gsap.to(element, { rotateX: 0, rotateY: 0, duration: 0.3, ease: "power2.out" });
      if (enableMagnetism) gsap.to(element, { x: 0, y: 0, duration: 0.3, ease: "power2.out" });
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!enableTilt && !enableMagnetism) return;
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      if (enableTilt) {
        gsap.to(element, {
          rotateX: ((y - centerY) / centerY) * -10, rotateY: ((x - centerX) / centerX) * 10,
          duration: 0.1, ease: "power2.out", transformPerspective: 1000,
        });
      }
      if (enableMagnetism) {
        magnetismAnimationRef.current = gsap.to(element, {
          x: (x - centerX) * 0.05, y: (y - centerY) * 0.05, duration: 0.3, ease: "power2.out",
        });
      }
    };

    const handleClick = (e: MouseEvent) => {
      if (!clickEffect) return;
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const maxDistance = Math.max(
        Math.hypot(x, y), Math.hypot(x - rect.width, y),
        Math.hypot(x, y - rect.height), Math.hypot(x - rect.width, y - rect.height)
      );
      const ripple = document.createElement("div");
      ripple.style.cssText = `
        position:absolute;width:${maxDistance * 2}px;height:${maxDistance * 2}px;border-radius:50%;
        background:radial-gradient(circle, rgba(${glowColor},0.4) 0%, rgba(${glowColor},0.2) 30%, transparent 70%);
        left:${x - maxDistance}px;top:${y - maxDistance}px;pointer-events:none;z-index:1000;
      `;
      element.appendChild(ripple);
      gsap.fromTo(ripple, { scale: 0, opacity: 1 }, {
        scale: 1, opacity: 0, duration: 0.8, ease: "power2.out", onComplete: () => ripple.remove(),
      });
    };

    element.addEventListener("mouseenter", handleMouseEnter);
    element.addEventListener("mouseleave", handleMouseLeave);
    element.addEventListener("mousemove", handleMouseMove);
    element.addEventListener("click", handleClick);

    return () => {
      isHoveredRef.current = false;
      element.removeEventListener("mouseenter", handleMouseEnter);
      element.removeEventListener("mouseleave", handleMouseLeave);
      element.removeEventListener("mousemove", handleMouseMove);
      element.removeEventListener("click", handleClick);
      clearAllParticles();
    };
  }, [animateParticles, clearAllParticles, disableAnimations, enableStars, enableTilt, enableMagnetism, clickEffect, glowColor]);

  return (
    <div ref={cardRef} className={className} style={style}>
      {children}
    </div>
  );
}

function GlobalSpotlight({
  gridRef, disableAnimations = false, enabled = true, spotlightRadius, glowColor,
}: {
  gridRef: RefObject<HTMLDivElement | null>;
  disableAnimations?: boolean;
  enabled?: boolean;
  spotlightRadius: number;
  glowColor: string;
}) {
  const spotlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (disableAnimations || !gridRef.current || !enabled) return;

    const spotlight = document.createElement("div");
    spotlight.style.cssText = `
      position:fixed;width:800px;height:800px;border-radius:50%;pointer-events:none;
      background:radial-gradient(circle,
        rgba(${glowColor},0.15) 0%, rgba(${glowColor},0.08) 15%, rgba(${glowColor},0.04) 25%,
        rgba(${glowColor},0.02) 40%, rgba(${glowColor},0.01) 65%, transparent 70%);
      z-index:5;opacity:0;transform:translate(-50%,-50%);mix-blend-mode:multiply;
    `;
    document.body.appendChild(spotlight);
    spotlightRef.current = spotlight;

    const proximity = spotlightRadius * 0.5;
    const fadeDistance = spotlightRadius * 0.75;

    const handleMouseMove = (e: MouseEvent) => {
      if (!spotlightRef.current || !gridRef.current) return;
      const rect = gridRef.current.getBoundingClientRect();
      const mouseInside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      const cards = gridRef.current.querySelectorAll<HTMLElement>(".mb-card");

      if (!mouseInside) {
        gsap.to(spotlightRef.current, { opacity: 0, duration: 0.3, ease: "power2.out" });
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"));
        return;
      }

      let minDistance = Infinity;
      cards.forEach((card) => {
        const r = card.getBoundingClientRect();
        const distance = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) - Math.max(r.width, r.height) / 2;
        const effective = Math.max(0, distance);
        minDistance = Math.min(minDistance, effective);
        let glow = 0;
        if (effective <= proximity) glow = 1;
        else if (effective <= fadeDistance) glow = (fadeDistance - effective) / (fadeDistance - proximity);
        updateCardGlowProperties(card, e.clientX, e.clientY, glow, spotlightRadius);
      });

      gsap.to(spotlightRef.current, { left: e.clientX, top: e.clientY, duration: 0.1, ease: "power2.out" });
      const targetOpacity = minDistance <= proximity
        ? 0.8
        : minDistance <= fadeDistance ? ((fadeDistance - minDistance) / (fadeDistance - proximity)) * 0.8 : 0;
      gsap.to(spotlightRef.current, { opacity: targetOpacity, duration: targetOpacity > 0 ? 0.2 : 0.5, ease: "power2.out" });
    };

    const handleMouseLeave = () => {
      gridRef.current?.querySelectorAll<HTMLElement>(".mb-card").forEach((card) => card.style.setProperty("--glow-intensity", "0"));
      if (spotlightRef.current) gsap.to(spotlightRef.current, { opacity: 0, duration: 0.3, ease: "power2.out" });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      spotlightRef.current?.parentNode?.removeChild(spotlightRef.current);
    };
  }, [gridRef, disableAnimations, enabled, spotlightRadius, glowColor]);

  return null;
}

function useMobileDetection() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

export function MagicBento({
  cards,
  textAutoHide = true,
  enableStars = true,
  enableSpotlight = true,
  enableBorderGlow = true,
  disableAnimations = false,
  spotlightRadius = 300,
  particleCount = 12,
  enableTilt = false,
  glowColor = "255, 135, 3",
  clickEffect = true,
  enableMagnetism = false,
}: MagicBentoProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const isMobile = useMobileDetection();
  const inView = useInView(gridRef, { once: true, amount: 0.15 });
  const noAnim = disableAnimations || isMobile;

  return (
    <>
      <style>{`
        .mb-section { position: relative; width: 100%; max-width: 1100px; margin: 0 auto; user-select: none; }
        .mb-grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
        @media (min-width: 600px) { .mb-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (min-width: 1024px) {
          .mb-grid { grid-template-columns: repeat(4, 1fr); }
          .mb-grid .mb-card:nth-child(3) { grid-column: span 2; grid-row: span 2; }
          .mb-grid .mb-card:nth-child(4) { grid-column: 1 / span 2; grid-row: 2 / span 2; }
          .mb-grid .mb-card:nth-child(6) { grid-column: 4; grid-row: 3; }
        }
        .mb-card {
          --glow-x: 50%; --glow-y: 50%; --glow-intensity: 0; --glow-radius: 200px;
          position: relative; overflow: hidden; min-height: 220px; padding: 22px;
          border-radius: 20px; border: 1px solid rgba(var(--hm-line-c), .08); background: var(--hm-card); color: var(--hm-text);
          transition: transform .3s ease, box-shadow .3s ease;
        }
        /* entrance uses the separate translate property so it never fights the hover transform */
        .mb-card { opacity: 0; translate: 0 40px; }
        .mb-grid--in .mb-card { animation: mb-in 0.9s cubic-bezier(.22,1,.36,1) forwards; animation-delay: calc(var(--i) * 90ms); }
        @keyframes mb-in { to { opacity: 1; translate: 0 0; } }
        @media (prefers-reduced-motion: reduce) { .mb-card { opacity: 1; translate: none; } .mb-grid--in .mb-card { animation: none; } }
        .mb-card:hover { transform: translateY(-2px); box-shadow: 0 18px 40px -18px rgba(var(--hm-shadow-c), .25); }
        .mb-card--glow::after {
          content: ""; position: absolute; inset: 0; padding: 6px; border-radius: inherit;
          background: radial-gradient(var(--glow-radius) circle at var(--glow-x) var(--glow-y),
            rgba(${glowColor}, calc(var(--glow-intensity) * 0.8)) 0%,
            rgba(${glowColor}, calc(var(--glow-intensity) * 0.4)) 30%,
            transparent 60%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          pointer-events: none; z-index: 1;
        }
        .mb-card--glow:hover { box-shadow: 0 18px 40px -18px rgba(var(--hm-shadow-c), .25), 0 0 30px rgba(${glowColor}, .12); }
        .mb-bg { position: absolute; inset: 0; z-index: 0; }
        .mb-bg-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(var(--hm-card-c), .1) 0%, rgba(var(--hm-card-c), .45) 55%, rgba(var(--hm-card-c), .92) 100%); }
        .mb-content { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; gap: 16px; }
        .mb-label { font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: .1em; color: var(--hm-red); }
        .mb-visual { flex: 1; display: flex; align-items: center; min-height: 0; }
        .mb-title { margin: 0 0 4px; font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 23px; }
        .mb-desc { margin: 0; font-family: 'Inter Tight', sans-serif; font-size: 13.5px; line-height: 1.5; color: rgba(var(--hm-ink-c), .68); }
        .mb-clamp-1 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; line-clamp: 1; overflow: hidden; }
        .mb-clamp-2 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
        .mb-particle::before { content: ""; position: absolute; inset: -2px; background: rgba(${glowColor}, .2); border-radius: 50%; z-index: -1; }
        @media (prefers-reduced-motion: reduce) { .mb-card { transition: none; } .mb-card:hover { transform: none; } }
      `}</style>

      {enableSpotlight && (
        <GlobalSpotlight gridRef={gridRef} disableAnimations={noAnim} enabled={enableSpotlight} spotlightRadius={spotlightRadius} glowColor={glowColor} />
      )}

      <div className="mb-section" ref={gridRef}>
        <div className={`mb-grid ${inView ? "mb-grid--in" : ""}`}>
          {cards.map((card, i) => (
            <ParticleCard
              key={card.label}
              className={`mb-card ${enableBorderGlow ? "mb-card--glow" : ""}`}
              style={{ ["--i" as string]: i } as CSSProperties}
              disableAnimations={noAnim}
              particleCount={particleCount}
              glowColor={glowColor}
              enableStars={enableStars}
              enableTilt={enableTilt}
              clickEffect={clickEffect}
              enableMagnetism={enableMagnetism}
            >
              {card.background && (
                <div className="mb-bg" aria-hidden="true">
                  {card.background}
                  <div className="mb-bg-shade" />
                </div>
              )}
              <div className="mb-content">
                <span className="mb-label">{card.label}</span>
                {card.visual && <div className="mb-visual">{card.visual}</div>}
                <div>
                  <h3 className={`mb-title ${textAutoHide ? "mb-clamp-1" : ""}`}>{card.title}</h3>
                  <p className={`mb-desc ${textAutoHide ? "mb-clamp-2" : ""}`}>{card.description}</p>
                </div>
              </div>
            </ParticleCard>
          ))}
        </div>
      </div>
    </>
  );
}

export default MagicBento;
