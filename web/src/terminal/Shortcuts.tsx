import { useEffect, useRef } from 'react';
import { SHORTCUT_GROUPS } from './keys';
import { useT } from '../i18n';

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div className="tm-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tm-modal" role="dialog" aria-modal="true" aria-labelledby="tm-kb-title">
        <div className="tm-modal-h">
          <b id="tm-kb-title">{t('tm.shortcuts')}</b>
          <button ref={closeRef} type="button" className="tm-link" onClick={onClose}>{t('tm.closeEsc')}</button>
        </div>
        <div className="tm-kb-grid">
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="tm-side-h" style={{ padding: '0 0 6px' }}>{t(g.title).toUpperCase()}</div>
              {g.items.map((it) => (
                <div key={it.label} className="tm-kv">
                  <span>{t(it.label)}</span>
                  <span>{it.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="tm-note">{t('tm.kb.pauseNote')}</div>
      </div>
    </div>
  );
}
