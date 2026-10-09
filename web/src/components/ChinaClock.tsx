import { useEffect, useState, useSyncExternalStore } from 'react';
import { isMarketOpen } from '../utils/marketHours';
import { useT } from '../i18n';
import './ChinaClock.css';

/* Beijing time in the navigation bar, with the music switch beside it.

   The clock is the time in China (UTC+8, the same as Hong Kong), ticking on the second. Its dot is lit while the
   Hong Kong exchange is in session; exchange holidays are not modelled, as everywhere else on the site.

   The music is a short playlist in public/audio (TRACKS below). The player only shows the tracks whose files exist,
   and disappears if none do. Nothing plays until the visitor presses it (browsers block sound before a click anyway).
   While it plays, the switch opens up to show the track and a "next" button; the playlist moves on by itself when a
   track ends. The player lives at module level, so the music carries on from the landing page into the terminal. */

const BEIJING = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** landing: the site's bar · terminal: the terminal's top bar · menu: the phone menu, where nothing is hidden */
type Variant = 'landing' | 'terminal' | 'menu';

export function ChinaClock({ variant = 'landing', className = '' }: { variant?: Variant; className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // tick on the second boundary, so the seconds change together with every other clock on the screen
    let timer = 0;
    const tick = () => {
      setNow(new Date());
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => window.clearTimeout(timer);
  }, []);

  const open = isMarketOpen('HK', now);
  const t = useT();
  return (
    <div
      className={`cn-clock cn-${variant} ${className}`}
      title={t('clock.tooltip', { state: t(open ? 'clock.inSession' : 'clock.closed') })}
    >
      <span className={`cn-dot ${open ? 'is-open' : ''}`} aria-hidden="true" />
      <time className="cn-time" dateTime={now.toISOString()}>{BEIJING.format(now)}</time>
      <span className="cn-city">{t('clock.city')}</span>
    </div>
  );
}

// ---------------------------------------------------------------- music

/** The playlist. Royalty-free tracks from Pixabay; the artist shows in each track's tooltip. */
const TRACKS = [
  { src: '/audio/theme-1.mp3', title: 'Chinese Asian Music', artist: 'Tunetank', numeral: '壹' },
  { src: '/audio/theme-2.mp3', title: 'A Love Story in China', artist: 'DF Wahyu Music Production', numeral: '贰' },
  { src: '/audio/theme-3.mp3', title: 'Chinese Asian Music', artist: 'Monda Music', numeral: '叁' },
];
const VOLUME = 0.35;
const FADE_MS = 900;
const TRACK_KEY = 'hm-music-track';

let player: HTMLAudioElement | null = null;
let playing = false;
/** indexes into TRACKS whose files exist; null until probed */
let available: number[] | null = null;
let current = readTrack();
/** the track whose file is loaded into the player, so a pause and play resumes instead of restarting */
let loaded = -1;
let fadeId = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readTrack() {
  try {
    const i = Number(localStorage.getItem(TRACK_KEY));
    return Number.isInteger(i) && i >= 0 && i < TRACKS.length ? i : 0;
  } catch {
    return 0;
  }
}
function saveTrack(i: number) {
  try {
    localStorage.setItem(TRACK_KEY, String(i));
  } catch {
    // not remembered, which only means the next visit starts on the first track
  }
}

/** Which tracks exist and are audio: a missing file comes back as the site's index.html (text/html), not a 404. */
function probe() {
  if (available !== null) return;
  available = [];
  Promise.all(TRACKS.map((t, i) =>
    fetch(t.src, { method: 'HEAD' })
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').startsWith('audio') ? i : -1))
      .catch(() => -1),
  )).then((found) => {
    available = found.filter((i) => i >= 0);
    if (!available.includes(current)) current = available[0] ?? 0;
    emit();
  });
}

/** Ramp the volume; a newer fade cancels an older one, so pressing quickly never leaves two fighting. */
function fade(to: number, then?: () => void) {
  if (!player) return;
  const id = ++fadeId;
  const from = player.volume;
  const start = performance.now();
  const step = (t: number) => {
    if (!player || id !== fadeId) return;
    // a frame's timestamp can be a little earlier than `start`, so clamp, or the volume dips below 0 and throws
    const k = Math.min(1, Math.max(0, (t - start) / FADE_MS));
    player.volume = Math.min(1, Math.max(0, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else then?.();
  };
  requestAnimationFrame(step);
}

function start() {
  if (!player) {
    player = new Audio();
    player.preload = 'auto';
    player.addEventListener('ended', () => nextTrack()); // the playlist moves on by itself
  }
  if (loaded !== current) {
    player.src = TRACKS[current].src;
    loaded = current;
  }
  player.volume = 0;
  playing = true;
  emit();
  player.play().then(() => fade(VOLUME)).catch(() => { playing = false; emit(); });
}

function stop() {
  playing = false;
  emit();
  fade(0, () => player?.pause());
}

function toggleMusic() {
  if (playing) stop();
  else start();
}

function nextTrack() {
  const list = available ?? [];
  if (!list.length) return;
  current = list[(list.indexOf(current) + 1) % list.length];
  saveTrack(current);
  emit();
  if (!playing) return;
  // fade the old track out, then bring the new one in
  fade(0, () => {
    if (!player) return;
    player.pause();
    player.src = TRACKS[current].src;
    loaded = current;
    player.play().then(() => fade(VOLUME)).catch(() => { playing = false; emit(); });
  });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export function MusicToggle({ variant = 'landing', className = '' }: { variant?: Variant; className?: string }) {
  useEffect(probe, []);
  const on = useSyncExternalStore(subscribe, () => playing);
  const count = useSyncExternalStore(subscribe, () => available?.length ?? 0);
  const index = useSyncExternalStore(subscribe, () => current);
  const t = useT();
  if (!count) return null;
  const track = TRACKS[index];
  return (
    <div className={`cn-player cn-${variant} ${on ? 'is-on' : ''} ${className}`}>
      <button
        type="button"
        className="cn-music"
        aria-pressed={on}
        aria-label={t(on ? 'music.pause' : 'music.play')}
        title={t(on ? 'music.pause' : 'music.play')}
        onClick={toggleMusic}
      >
        {on ? (
          <span className="cn-bars" aria-hidden="true"><i /><i /><i /></span>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V5l11-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="17" cy="16" r="3" />
          </svg>
        )}
      </button>
      {on && (
        <>
          <span className="cn-track" title={`${track.title} · ${track.artist}`} aria-live="polite">
            <b>{track.numeral}</b>
            <span className="cn-track-title">{track.title}</span>
          </span>
          {count > 1 && (
            <button type="button" className="cn-next" aria-label={t('music.next')} title={t('music.next')} onClick={nextTrack}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M5 5.5v13a1 1 0 0 0 1.5.86L16 13.7V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.3L6.5 4.64A1 1 0 0 0 5 5.5z" />
              </svg>
            </button>
          )}
        </>
      )}
    </div>
  );
}
