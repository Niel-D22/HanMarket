// Trading sessions of the underlying exchanges (exchange holidays are not modelled).
//   HK:  HKEX, Mon–Fri 09:30–12:00 and 13:00–16:00 Asia/Hong_Kong
//   ADR: NYSE / NASDAQ, Mon–Fri 09:30–16:00 America/New_York
// Shared by the terminal (information banner), the pricing service (wider spreads while closed) and the
// keeper (opens and closes perp markets).

export type Board = 'HK' | 'ADR';

export const SESSIONS: Record<Board, { tz: string; label: string; sessions: [number, number][] }> = {
  HK: { tz: 'Asia/Hong_Kong', label: 'Hong Kong exchange', sessions: [[570, 720], [780, 960]] },
  ADR: { tz: 'America/New_York', label: 'US exchange', sessions: [[570, 960]] },
};

/**
 * Robinhood's tokenized US shares trade around the clock on weekdays, and the Chainlink "Robinhood X / USD"
 * feeds follow them, so perps on those shares stay open Mon 04:00 – Fri 20:00 New York time.
 */
export const EXTENDED_US: [number, number] = [240, 1200];

export function localClock(tz: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function isSessionOpen(board: Board, now = new Date()): boolean {
  const { tz, sessions } = SESSIONS[board];
  const { weekday, minutes } = localClock(tz, now);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return sessions.some(([open, close]) => minutes >= open && minutes < close);
}

/** Whether a perp on a Robinhood-tokenized US share should accept trades now (Mon 04:00 → Fri 20:00 ET). */
export function isPerpSessionOpen(now = new Date()): boolean {
  const { weekday, minutes } = localClock('America/New_York', now);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  if (weekday === 'Mon' && minutes < EXTENDED_US[0]) return false;
  if (weekday === 'Fri' && minutes >= EXTENDED_US[1]) return false;
  return true;
}
