import { useState, useEffect } from 'react';
import type { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useNetwork } from '../contexts/NetworkContext';
import { ThemeToggle } from '../theme/ThemeProvider';
import './Navbar.css';

// The brand's X account; the icon stays hidden until this is set in web/.env
const X_URL = import.meta.env.VITE_X_URL as string | undefined;

interface NavbarProps {
  variant?: 'landing' | 'terminal';
  /** extra controls on the right, e.g. the terminal's wallet button */
  actions?: ReactNode;
}

export const LogoText: FC = () => (
  <span className="logo-text" style={{ fontFamily: "'Montserrat', 'Inter Tight', sans-serif", letterSpacing: '0.32em', fontWeight: 500, fontSize: '0.78em' }}>
    HANMARKET
  </span>
);

/** The gold coin mark. Decorative wherever the name is written next to it. */
export const LogoMark: FC<{ size?: number | string; alt?: string }> = ({ size = 28, alt = '' }) => (
  <img src="/brand/hanmarket-mark.png" alt={alt} width={238} height={238} style={{ width: size, height: size, display: 'block', flexShrink: 0 }} />
);

export const Navbar: FC<NavbarProps> = ({ variant = 'landing', actions }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const isTerminal = variant === 'terminal';
  const { network, setNetwork } = useNetwork();

  useEffect(() => {
    if (isTerminal) return;
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isTerminal]);

  return (
    <>
      <nav className={`navbar-container ${isTerminal ? 'navbar-terminal' : 'navbar-landing'} ${isScrolled ? 'navbar-scrolled' : ''}`}>
      <Link to="/" style={{ textDecoration: 'none' }}>
        <div className="navbar-logo" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <LogoMark size="1.9rem" />
          <div style={{ fontSize: '1.5rem', color: 'var(--hm-text)' }}>
            <LogoText />
          </div>
          {isTerminal && <span className="navbar-badge">TERMINAL</span>}
        </div>
      </Link>
      {!isTerminal && (
        <div className="navbar-links">
          <Link to="/#how" style={{ textDecoration: 'none' }}>How It Works</Link>
          <Link to="/#markets" style={{ textDecoration: 'none' }}>Markets</Link>
          <Link to="/#faq" style={{ textDecoration: 'none' }}>FAQ</Link>
          <Link to="/docs" style={{ textDecoration: 'none' }}>Docs</Link>
        </div>
      )}
      <div className="navbar-actions">
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
          rel="noreferrer" 
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
          <Link to="/terminal" className="navbar-launch">Launch App <span aria-hidden="true">→</span></Link>
        )}
        {actions}
        {!isTerminal && (
          <button 
            className="hamburger-btn" 
            aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
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
          <Link to="/#how" onClick={() => setIsMobileMenuOpen(false)}>How It Works</Link>
          <Link to="/#markets" onClick={() => setIsMobileMenuOpen(false)}>Markets</Link>
          <Link to="/#faq" onClick={() => setIsMobileMenuOpen(false)}>FAQ</Link>
          <Link to="/docs" onClick={() => setIsMobileMenuOpen(false)}>Docs</Link>
          <Link to="/terminal" className="mobile-menu-launch" onClick={() => setIsMobileMenuOpen(false)}>Launch App →</Link>
        </div>
      </div>
    )}
    </>
  );
};
