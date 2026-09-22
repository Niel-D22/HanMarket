import type { Board } from '../data/assets';

// Regular trading sessions of the underlying exchanges (exchange holidays are not modelled).
//   HKEX:          Mon–Fri 09:30–12:00 and 13:00–16:00, Asia/Hong_Kong
//   NYSE / NASDAQ: Mon–Fri 09:30–16:00, America/New_York (China ADRs)
//
// These hours only say when the underlying share price moves. HanMarket options are onchain and can be
// bought, sold and settled at any hour, so the terminal shows this as information, never as a block.
const SESSIONS: Record<Board, { tz: string; label: string; sessions: [number, number][] }> = {
  HK: { tz: 'Asia/Hong_Kong', label: 'Hong Kong exchange', sessions: [[570, 720], [780, 960]] },
  ADR: { tz: 'America/New_York', label: 'US exchange', sessions: [[570, 960]] },
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function localClock(tz: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function isMarketOpen(board: Board, now = new Date()): boolean {
  const { tz, sessions } = SESSIONS[board];
  const { weekday, minutes } = localClock(tz, now);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return sessions.some(([open, close]) => minutes >= open && minutes < close);
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** "opens in 48 minutes (09:30 HKT)" — when the underlying starts trading again. */
export function nextOpenLabel(board: Board, now = new Date()): string {
  const { tz, sessions } = SESSIONS[board];
  const { weekday, minutes } = localClock(tz, now);
  const zone = board === 'HK' ? 'HKT' : 'ET';
  const dayIndex = DAYS.indexOf(weekday);

  const laterToday = weekday !== 'Sat' && weekday !== 'Sun' ? sessions.find(([open]) => open > minutes) : undefined;
  if (laterToday) {
    const inMinutes = laterToday[0] - minutes;
    const when = inMinutes < 60 ? `in ${inMinutes} minute${inMinutes === 1 ? '' : 's'}` : `in ${Math.round(inMinutes / 60)} hour${Math.round(inMinutes / 60) === 1 ? '' : 's'}`;
    return `opens ${when} (${hhmm(laterToday[0])} ${zone})`;
  }

  // next weekday's first session
  let daysAhead = 1;
  while ([0, 6].includes((dayIndex + daysAhead) % 7)) daysAhead++;
  const dayName = daysAhead === 1 ? 'tomorrow' : DAYS[(dayIndex + daysAhead) % 7];
  return `opens ${dayName} at ${hhmm(sessions[0][0])} ${zone}`;
}

export function closedMessage(board: Board, now = new Date()): string {
  const { label } = SESSIONS[board];
  return `${label} is closed — ${nextOpenLabel(board, now)}. Options here still trade around the clock; only the share price stops moving.`;
}
