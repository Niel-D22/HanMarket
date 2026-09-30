import { useEffect, useState } from 'react';

/** Whether a media query matches, kept up to date as it changes (rotation, window resize, a mouse plugged in). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** A mouse or trackpad: effects that follow a cursor are only worth running here, never on touch screens. */
export const FINE_POINTER = '(hover: hover) and (pointer: fine)';

/** Touch-first devices get lighter canvases: fewer pixels drawn per frame on a phone's GPU. */
export const isCoarsePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
