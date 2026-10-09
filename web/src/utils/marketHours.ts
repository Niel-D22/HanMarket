import type { Board } from '../data/assets';
import type { MsgKey, Vars } from '../i18n';

// Regular trading sessions of the underlying exchanges (exchange holidays are not modelled).
//   HKEX:          Mon–Fri 09:30–12:00 and 13:00–16:00, Asia/Hong_Kong
//   NYSE / NASDAQ: Mon–Fri 09:30–16:00, America/New_York (China ADRs)
//
// These hours only say when the underlying share price moves. HanMarket options are onchain and can be
// bought, sold and settled at any hour, so the terminal shows this as information, never as a block.
const SESSIONS: Record<Board, { tz: string; sessions: [number, number][] }> = {
  HK: { tz: 'Asia/Hong_Kong', sessions: [[570, 720], [780, 960]] },
  ADR: { tz: 'America/New_York', sessions: [[570, 960]] },
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

type T = (key: MsgKey, vars?: Vars) => string;

/** "opens in 48 min (09:30 HKT)": when the underlying starts trading again, worded in the reader's language. */
export function nextOpenLabel(board: Board, t: T, lang: string, now = new Date()): string {
  const { tz, sessions } = SESSIONS[board];
  const { weekday, minutes } = localClock(tz, now);
  const zone = board === 'HK' ? 'HKT' : 'ET';
  const dayIndex = DAYS.indexOf(weekday);

  const laterToday = weekday !== 'Sat' && weekday !== 'Sun' ? sessions.find(([open]) => open > minutes) : undefined;
  if (laterToday) {
    const inMinutes = laterToday[0] - minutes;
    const time = `${hhmm(laterToday[0])} ${zone}`;
    return inMinutes < 60
      ? t('tm.session.inMin', { n: inMinutes, time })
      : t('tm.session.inHours', { n: Math.round(inMinutes / 60), time });
  }

  // next weekday's first session
  let daysAhead = 1;
  while ([0, 6].includes((dayIndex + daysAhead) % 7)) daysAhead++;
  const time = `${hhmm(sessions[0][0])} ${zone}`;
  if (daysAhead === 1) return t('tm.session.tomorrow', { time });
  // the weekday's name in the reader's language: 7 Jan 2024 was a Sunday, so day i of the week is 7 + i
  const day = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + ((dayIndex + daysAhead) % 7))));
  return t('tm.session.onDay', { day, time });
}

export function closedMessage(board: Board, t: T, lang: string, now = new Date()): string {
  return t('tm.session.closed', { exchange: t(board === 'HK' ? 'tm.session.hk' : 'tm.session.us'), next: nextOpenLabel(board, t, lang, now) });
}
