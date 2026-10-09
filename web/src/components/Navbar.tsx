import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { FC, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useNetwork } from '../contexts/NetworkContext';
import { ThemeToggle } from '../theme/ThemeProvider';
import { X_URL } from '../config/social';
import { ChinaClock, MusicToggle } from './ChinaClock';
import { useT } from '../i18n';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import './Navbar.css';

interface NavbarProps {
  variant?: 'landing' | 'terminal';
  /** extra controls on the right, e.g. the terminal's wallet button */
  actions?: ReactNode;
}

export const LogoText: FC = () => (
  <span className="logo-text" lang="en" style={{ fontFamily: "'Montserrat', 'Inter Tight', sans-serif", letterSpacing: '0.32em', fontWeight: 500, fontSize: '0.78em' }}>
    HANMARKET
  </span>
);

/** The gold coin mark. Decorative wherever the name is written next to it. */
export const LogoMark: FC<{ size?: number | string; alt?: string }> = ({ size = 28, alt = '' }) => (
  <img src="/brand/hanmarket-mark.png" alt={alt} width={238} height={238} style={{ width: size, height: size, display: 'block', flexShrink: 0 }} />
);

/** the bar never tucks away this close to the top of the page */
const TUCK_BELOW = 120;
/** px of scroll in one event that count as a direction, not jitter */
const TUCK_STEP = 4;
/** once scrolling stops for this long, the bar comes back */
const SHOW_AFTER_REST_MS = 700;

/**
 * What the landing bar drops, in this order, when its words do not fit the width. The CSS breakpoints are measured
 * for English; Russian, Vietnamese, Spanish and the like run 40-130px longer, so on top of them the bar checks itself
 * and drops one more piece at a time (all of them stay in the phone menu). 'compact' is the menu layout.
 */
const SQUEEZE = ['title', 'city', 'clock', 'track', 'compact', 'launch', 'lang', 'player'] as const;

export const Navbar: FC<NavbarProps> = ({ variant = 'landing', actions }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  // out of the way while the visitor reads on down; back when they scroll up, stop, or return to the top
  const [isTucked, setIsTucked] = useState(false);
  const isTerminal = variant === 'terminal';
  const t = useT();
  const { network, setNetwork } = useNetwork();
  // the landing page's hero carries the coin itself (and it travels down the page), so the bar shows only the name there
  const showMark = useLocation().pathname !== '/';
  const navRef = useRef<HTMLElement>(null);

  // set as a data attribute, not through React, so a re-render (scrolling, the menu) does not undo it
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || isTerminal) return;
    // every control ends inside the bar's side padding, at least 40px from the edge where the padding is that wide
    // (an overflowing grid first spills into the padding, which scrollWidth does not count, so the controls
    // themselves are measured)
    const fits = () => {
      const pad = parseFloat(getComputedStyle(nav).paddingRight) || 0;
      const limit = nav.getBoundingClientRect().right - Math.max(16, Math.min(pad, 40));
      return [...nav.querySelectorAll('.navbar-actions > *')].every((el) => el.getBoundingClientRect().right <= limit);
    };
    const fit = () => {
      // measured with the bar's padding transition off: a half-animated padding reads as overflow, and the bar then
      // flipped between dropping everything and nothing (seen in Spanish at 1160-1200px with the music on)
      nav.style.transition = 'none';
      nav.removeAttribute('data-squeeze');
      const dropped: string[] = [];
      for (const piece of SQUEEZE) {
        if (fits()) break;
        dropped.push(piece);
        nav.setAttribute('data-squeeze', dropped.join(' '));
      }
      void nav.offsetWidth; // commit the final layout before the transition comes back, so it does not animate
      nav.style.transition = '';
    };
    fit();
    // the bar's width, the player growing when music starts, and web fonts arriving all change what fits; refit on
    // the next frame, outside the observer's own callback, so the change it makes is not reported back as a loop
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); });
    observer.observe(nav);
    nav.querySelectorAll('.navbar-actions, .navbar-links').forEach((el) => observer.observe(el));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [isTerminal, t]);

  useEffect(() => {
    if (isTerminal) return;
    let lastY = window.scrollY;
    let rest: number | undefined;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      setIsScrolled(y > 8);
      if (y < TUCK_BELOW || delta < -TUCK_STEP) setIsTucked(false);
      else if (delta > TUCK_STEP) setIsTucked(true);
      window.clearTimeout(rest);
      rest = window.setTimeout(() => setIsTucked(false), SHOW_AFTER_REST_MS);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(rest);
    };
  }, [isTerminal]);

  return (
    <>
      <nav
        ref={navRef}
        className={`navbar-container ${isTerminal ? 'navbar-terminal' : 'navbar-landing'} ${isScrolled ? 'navbar-scrolled' : ''} ${isTucked && !isMobileMenuOpen ? 'navbar-tucked' : ''}`}
        onFocus={() => setIsTucked(false)} // tabbing into a tucked bar brings it back
      >
      <Link to="/" style={{ textDecoration: 'none' }}>
        <div className="navbar-logo" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {showMark && <LogoMark size="1.9rem" />}
          <div style={{ fontSize: '1.5rem', color: 'var(--hm-text)' }}>
            <LogoText />
          </div>
          {isTerminal && <span className="navbar-badge">TERMINAL</span>}
        </div>
      </Link>
      {!isTerminal && (
        <div className="navbar-links">
          <Link to="/#how" style={{ textDecoration: 'none' }}>{t('nav.howItWorks')}</Link>
          <Link to="/#markets" style={{ textDecoration: 'none' }}>{t('nav.markets')}</Link>
          <Link to="/#faq" style={{ textDecoration: 'none' }}>{t('nav.faq')}</Link>
          <Link to="/docs" style={{ textDecoration: 'none' }}>{t('nav.docs')}</Link>
        </div>
      )}
      <div className="navbar-actions">
        {!isTerminal && <ChinaClock />}
        {!isTerminal && <MusicToggle />}
        {!isTerminal && <LanguageSwitch />}
        <ThemeToggle />
        {isTerminal && (
          <div className="net-toggle" style={{
            display: 'flex', 
            backgroundColor: 'var(--hm-card)', 
            borderRadius: '999px', 
            padding: '0.25rem',
            border: '1px solid rgba(var(--hm-line-c), 0.1)'
          }}>
            <span 
              onClick={() => setNetwork('mainnet')}
              style={{ 
                padding: '0.25rem 0.75rem', 
                fontSize: '0.75rem', 
                fontFamily: "'Montserrat', 'Inter Tight', sans-serif", 
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: network === 'mainnet' ? '#FFFFFF' : 'rgba(var(--hm-ink-c), 0.6)', 
                backgroundColor: network === 'mainnet' ? 'var(--hm-red)' : 'transparent',
                borderRadius: '999px',
                cursor: 'pointer' 
              }}>
              Mainnet
            </span>
            <span 
              onClick={() => setNetwork('testnet')}
              style={{ 
                padding: '0.25rem 0.75rem', 
                fontSize: '0.75rem', 
                fontFamily: "'Montserrat', 'Inter Tight', sans-serif", 
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: network === 'testnet' ? '#FFFFFF' : 'rgba(var(--hm-ink-c), 0.6)', 
                backgroundColor: network === 'testnet' ? 'var(--hm-red)' : 'transparent',
                borderRadius: '999px',
                cursor: 'pointer' 
              }}>
              Testnet
            </span>
          </div>
        )}
        {X_URL && (
        <a 
          href={X_URL} 
          target="_blank" 
          rel="noreferrer noopener" 
          aria-label={t('nav.onX')} 
          title={t('nav.onX')} 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            color: 'var(--hm-text)',
            marginRight: '12px',
            opacity: 0.8,
            transition: 'opacity 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '0.8'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>
        )}
        {!isTerminal && (
          <Link to="/terminal" className="navbar-launch">{t('nav.launchApp')} <span aria-hidden="true">→</span></Link>
        )}
        {actions}
        {!isTerminal && (
          <button 
            className="hamburger-btn" 
            aria-label={t(isMobileMenuOpen ? 'nav.closeMenu' : 'nav.openMenu')}
            aria-expanded={isMobileMenuOpen}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isMobileMenuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        )}
      </div>
    </nav>
    
    {!isTerminal && isMobileMenuOpen && (
      <div className="mobile-menu-overlay">
        <div className="mobile-menu-content">
          <Link to="/#how" onClick={() => setIsMobileMenuOpen(false)}>{t('nav.howItWorks')}</Link>
          <Link to="/#markets" onClick={() => setIsMobileMenuOpen(false)}>{t('nav.markets')}</Link>
          <Link to="/#faq" onClick={() => setIsMobileMenuOpen(false)}>{t('nav.faq')}</Link>
          <Link to="/docs" onClick={() => setIsMobileMenuOpen(false)}>{t('nav.docs')}</Link>
          <div className="mobile-menu-extras">
            <ChinaClock variant="menu" />
            <MusicToggle variant="menu" />
            <LanguageSwitch variant="menu" />
          </div>
          <Link to="/terminal" className="mobile-menu-launch" onClick={() => setIsMobileMenuOpen(false)}>{t('nav.launchApp')} →</Link>
        </div>
      </div>
    )}
    </>
  );
};
