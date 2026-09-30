import { useCallback, useState } from 'react';

// Which terminal panels are open. A per-viewer layout preference, not account state, so it lives in
// localStorage (which can be empty or throw in a private window, hence the guards).

export type PanelKey = 'side' | 'right' | 'bottom' | 'trades';
export type Panels = Record<PanelKey, boolean>; // true = open

const KEY = 'hm-panels';
const ALL_OPEN: Panels = { side: true, right: true, bottom: true, trades: true };

function read(): Panels {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const next = { ...ALL_OPEN };
      for (const k of Object.keys(ALL_OPEN) as PanelKey[]) if (typeof saved[k] === 'boolean') next[k] = saved[k];
      return next;
    }
  } catch {
    // unreadable or blocked: start with everything open
  }
  return ALL_OPEN;
}

export function usePanels() {
  const [panels, setPanels] = useState<Panels>(read);
  /** Flips a panel, or forces it open/closed when `open` is given. */
  const setPanel = useCallback((key: PanelKey, open?: boolean) => {
    setPanels((prev) => {
      const next = { ...prev, [key]: open ?? !prev[key] };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // not persisted, which only means the layout lasts for this visit
      }
      return next;
    });
  }, []);
  return { panels, setPanel };
}
