import { useEffect, useRef } from 'react';
import { SHORTCUT_GROUPS } from './keys';

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
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
          <b id="tm-kb-title">Keyboard shortcuts</b>
          <button ref={closeRef} type="button" className="tm-link" onClick={onClose}>Close (Esc)</button>
        </div>
        <div className="tm-kb-grid">
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="tm-side-h" style={{ padding: '0 0 6px' }}>{g.title.toUpperCase()}</div>
              {g.items.map((it) => (
                <div key={it.label} className="tm-kv">
                  <span>{it.label}</span>
                  <span>{it.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="tm-note">Shortcuts pause while you type in a field, so an amount can't trigger one.</div>
      </div>
    </div>
  );
}
