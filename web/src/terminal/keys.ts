import { useEffect, useRef } from 'react';

// Keyboard navigation for the terminal: jump between the bottom panels, the views and the layout without
// leaving the keys. Single keys only, and never while typing in a field or with a dialog (the wallet
// picker, this help) open, so an amount typed into the order ticket can't trigger anything.

export const SHORTCUT_GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Bottom panel',
    items: [
      { keys: ['C'], label: 'Options chain' },
      { keys: ['F'], label: 'Options flow' },
      { keys: ['U'], label: 'Funding & open interest' },
      { keys: ['P'], label: 'Perpetual positions' },
      { keys: ['O'], label: 'Option positions' },
      { keys: ['H'], label: 'History' },
    ],
  },
  {
    title: 'Views',
    items: [
      { keys: ['1'], label: 'Trade' },
      { keys: ['2'], label: 'Markets' },
      { keys: ['3'], label: 'Portfolio' },
      { keys: ['4'], label: 'Vault' },
      { keys: ['5'], label: 'Strategies' },
      { keys: ['6'], label: 'Activity' },
      { keys: ['/'], label: 'Search markets' },
    ],
  },
  {
    title: 'Layout',
    items: [
      { keys: ['['], label: 'Show / hide the sidebar' },
      { keys: [']'], label: 'Show / hide the order terminal' },
      { keys: ['B'], label: 'Show / hide the bottom panel' },
      { keys: ['T'], label: 'Show / hide recent trades' },
      { keys: ['?'], label: 'This list' },
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
