import { useEffect, useId, useRef, useState } from 'react';
import { LANGS, useI18n } from './index';
import './LanguageSwitch.css';

/* The language switch: a globe with the current language's mark (EN, 简, 繁, 日, 한), opening a short list of the
   languages in their own script. Closes on a pick, a click outside or Escape. Same three looks as the clock and
   the music player: a pill in the landing bar, a square in the terminal, a full row in the phone menu. */

type Variant = 'landing' | 'terminal' | 'menu';

export function LanguageSwitch({ variant = 'landing', className = '' }: { variant?: Variant; className?: string }) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={`ls ls-${variant} ${className}`}>
      <button
        type="button"
        className="ls-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${t('lang.label')}: ${current.label}`}
        title={t('lang.label')}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
        </svg>
        <span className="ls-short">{variant === 'menu' ? current.label : current.short}</span>
      </button>
      {open && (
        <ul id={listId} className="ls-list" role="listbox" aria-label={t('lang.label')}>
          {LANGS.map((l) => (
            <li key={l.code} role="option" aria-selected={l.code === lang}>
              <button
                type="button"
                lang={l.code}
                className={l.code === lang ? 'is-current' : ''}
                onClick={() => { setLang(l.code); setOpen(false); }}
              >
                {l.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
