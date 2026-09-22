import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// Light / dark theme for the whole site. index.html applies the theme before first paint; this keeps
// <html data-theme> in sync afterwards, follows the system setting until the visitor picks one, and remembers
// the pick. Components that draw on canvas / WebGL read `theme` here, everything else uses the CSS tokens.

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

const KEY = 'hm-theme';
const media = () => (typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null);

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // storage blocked: follow the system
  }
  return 'system';
}

const resolve = (p: ThemePreference): Theme => (p === 'system' ? (media()?.matches ? 'dark' : 'light') : p);

interface ThemeState {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(readPreference);
  const [theme, setTheme] = useState<Theme>(() => resolve(readPreference()));

  // follow the system while no explicit choice is saved
  useEffect(() => {
    const mq = media();
    if (!mq || preference !== 'system') return;
    const onChange = () => setTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme === theme) return;
    root.classList.add('theme-switching');
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#13110F' : '#F6F2EB');
    const t = setTimeout(() => root.classList.remove('theme-switching'), 300);
    return () => clearTimeout(t);
  }, [theme]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    setTheme(resolve(p));
    try {
      if (p === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch {
      // not persisted; the choice lasts for this visit
    }
  }, []);

  const toggle = useCallback(() => setPreference(theme === 'dark' ? 'light' : 'dark'), [theme, setPreference]);

  return <ThemeContext.Provider value={{ theme, preference, setPreference, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/** Sun / moon button that flips the theme. */
export function ThemeToggle({ className = 'theme-toggle' }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className={className} onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7z" />
        </svg>
      )}
    </button>
  );
}
