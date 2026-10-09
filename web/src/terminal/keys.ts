import { useEffect, useRef } from 'react';
import type { MsgKey } from '../i18n';

// Keyboard navigation for the terminal: jump between the bottom panels, the views and the layout without
// leaving the keys. Single keys only, and never while typing in a field or with a dialog (the wallet
// picker, this help) open, so an amount typed into the order ticket can't trigger anything.

export const SHORTCUT_GROUPS: { title: MsgKey; items: { keys: string[]; label: MsgKey }[] }[] = [
  {
    title: 'tm.kb.bottomPanel',
    items: [
      { keys: ['C'], label: 'tm.tab.chainTitle' },
      { keys: ['F'], label: 'tm.tab.flowTitle' },
      { keys: ['U'], label: 'tm.kb.fundingOi' },
      { keys: ['P'], label: 'tm.tab.positionsTitle' },
      { keys: ['O'], label: 'tm.tab.optionsTitle' },
      { keys: ['H'], label: 'tm.history' },
    ],
  },
  {
    title: 'tm.kb.views',
    items: [
      { keys: ['1'], label: 'tm.view.trade' },
      { keys: ['2'], label: 'tm.view.markets' },
      { keys: ['3'], label: 'tm.view.portfolio' },
      { keys: ['4'], label: 'tm.view.vault' },
      { keys: ['5'], label: 'tm.view.strategies' },
      { keys: ['6'], label: 'tm.view.activity' },
      { keys: ['/'], label: 'tm.search' },
    ],
  },
  {
    title: 'tm.kb.layout',
    items: [
      { keys: ['['], label: 'tm.kb.toggleSide' },
      { keys: [']'], label: 'tm.kb.toggleOrder' },
      { keys: ['B'], label: 'tm.kb.toggleBottom' },
      { keys: ['T'], label: 'tm.kb.toggleTrades' },
      { keys: ['?'], label: 'tm.kb.thisList' },
    ],
  },
];

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** Runs `map[key]` on a plain key press. `map` may change every render; the listener is bound once. */
export function useShortcuts(map: Record<string, () => void>) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const fn = ref.current[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
