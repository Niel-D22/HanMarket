import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LanguageCurtain, type CurtainPhase } from './LanguageCurtain';
import { en, type Messages } from './locales/en';

/* The site's languages, without a library: one dictionary per language, English bundled with the page and the rest
   fetched only when picked (a few kilobytes each). The visitor's browser language decides the first visit; a pick
   in the language switch is remembered. `t('hero.tagline')` returns the current language's words, falling back to
   English for anything not translated yet, and TypeScript checks every key against the English dictionary. */

export const LANGS = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'zh-CN', label: '简体中文', short: '简' },
  { code: 'zh-TW', label: '繁體中文', short: '繁' },
  { code: 'ja', label: '日本語', short: '日' },
  { code: 'ko', label: '한국어', short: '한' },
  { code: 'vi', label: 'Tiếng Việt', short: 'VI' },
  { code: 'th', label: 'ไทย', short: 'TH' },
  { code: 'es', label: 'Español', short: 'ES' },
  { code: 'pt', label: 'Português', short: 'PT' },
  { code: 'ru', label: 'Русский', short: 'RU' },
  { code: 'tr', label: 'Türkçe', short: 'TR' },
] as const;
export type Lang = (typeof LANGS)[number]['code'];

const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Messages }>> = {
  'zh-CN': () => import('./locales/zh-CN'),
  'zh-TW': () => import('./locales/zh-TW'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
  vi: () => import('./locales/vi'),
  th: () => import('./locales/th'),
  es: () => import('./locales/es'),
  pt: () => import('./locales/pt'),
  ru: () => import('./locales/ru'),
  tr: () => import('./locales/tr'),
};

const STORE_KEY = 'hm-lang';

/** every dotted path to a string in the English dictionary: 'hero.tagline', 'faq.safe.q', … */
type Path<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Path<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MsgKey = Path<Messages>;
export type Vars = Record<string, string | number>;

const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.code === v);

/** A remembered pick, else the first browser language we have: Traditional Chinese for TW/HK/MO and Hant, else zh-CN. */
function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // no storage (private window): fall through to the browser's languages
  }
  const prefs = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
  for (const raw of prefs) {
    const tag = raw.toLowerCase();
    if (tag.startsWith('zh')) return /hant|-tw|-hk|-mo/.test(tag) ? 'zh-TW' : 'zh-CN';
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('en')) return 'en';
    // the rest share their code with the browser's tag (ko, vi, th, es, pt, ru, tr); Indonesian and others fall to English
    const base = tag.split('-')[0];
    const match = LANGS.find((l) => l.code === base);
    if (match) return match.code;
  }
  return 'en';
}

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === 'string' ? node : undefined;
}

export function format(text: string, vars?: Vars) {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Dictionaries already fetched; English is bundled. */
const cache = new Map<Lang, Messages>([['en', en]]);
function load(lang: Lang): Promise<Messages> {
  const hit = cache.get(lang);
  if (hit) return Promise.resolve(hit);
  return LOADERS[lang as Exclude<Lang, 'en'>]()
    .then((m) => { cache.set(lang, m.default); return m.default; })
    .catch(() => en);
}

const initialLang = detect();
/**
 * The first visit's dictionary. main.tsx waits for it (one ~25 KB file, English needs none) before the first render,
 * so a Japanese or Russian visitor does not see the page flash in English first.
 */
export const i18nReady: Promise<unknown> = load(initialLang);

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** The language curtain's timeline (LanguageCurtain.css matches these): clouds close, the coin turns, clouds part. */
export const CURTAIN_MS = { cover: 650, hold: 700, reveal: 1100 };

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MsgKey, vars?: Vars) => string;
  /** goes up each time a language change finishes behind the curtain; the landing page keys its intro on it to replay it */
  introKey: number;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => ({ lang: initialLang, messages: cache.get(initialLang) ?? en, introKey: 0 }));
  const [curtain, setCurtain] = useState<{ to: Lang; phase: CurtainPhase } | null>(null);
  const switching = useRef(false);

  useEffect(() => {
    document.documentElement.lang = state.lang;
  }, [state.lang]);

  // only if the first dictionary had not arrived by the first render (main.tsx waits, so a slow or failed fetch)
  useEffect(() => {
    if (state.messages !== en || state.lang === 'en') return;
    let live = true;
    load(state.lang).then((messages) => { if (live) setState((s) => (s.lang === state.lang ? { ...s, messages } : s)); });
    return () => { live = false; };
  }, [state.lang, state.messages]);

  /**
   * A new language opens like a first visit: clouds close over the page with the coin turning in the middle (the
   * dictionary loads meanwhile), the page changes language and restarts its intro unseen, and the clouds part again.
   * With reduced motion it is a plain swap.
   */
  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {
      // not remembered, which only means the next visit detects the language again
    }
    const ready = load(next);
    const apply = (messages: Messages) => setState((s) => ({ lang: next, messages, introKey: s.introKey + 1 }));
    if (reducedMotion()) {
      void ready.then(apply);
      return;
    }
    if (switching.current) return; // the curtain already covers the page; the stored pick wins next visit
    switching.current = true;
    setCurtain({ to: next, phase: 'cover' });
    void wait(CURTAIN_MS.cover)
      .then(() => {
        setCurtain({ to: next, phase: 'hold' });
        return Promise.all([ready, wait(CURTAIN_MS.hold)]);
      })
      .then(([messages]) => {
        apply(messages);
        setCurtain({ to: next, phase: 'reveal' });
        return wait(CURTAIN_MS.reveal);
      })
      .then(() => {
        setCurtain(null);
        switching.current = false;
      });
  }, []);

  const { lang, messages, introKey } = state;
  const t = useCallback((key: MsgKey, vars?: Vars) => format(lookup(messages, key) ?? lookup(en, key) ?? key, vars), [messages]);
  const value = useMemo(() => ({ lang, setLang, t, introKey }), [lang, setLang, t, introKey]);
  return (
    <I18nContext.Provider value={value}>
      {children}
      {curtain && <LanguageCurtain lang={curtain.to} label={LANGS.find((l) => l.code === curtain.to)?.label ?? ''} phase={curtain.phase} />}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** shorthand: const t = useT(); t('hero.tagline') */
export const useT = () => useI18n().t;

/** Text with `\n` line breaks, as React nodes. */
export function lines(text: string): ReactNode[] {
  return text.split('\n').flatMap((part, i) => (i === 0 ? [part] : [<br key={i} />, part]));
}

/**
 * Text with marked-up words, as React nodes: `rich('Click a <up>Call Ask</up>', { up: (s) => <span className="up">{s}</span> })`.
 * The tags stay inside the translated sentence, so each language can put the coloured words where its grammar wants.
 */
export function rich(text: string, tags: Record<string, (chunk: string) => ReactNode>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const render = tags[m[1]];
    out.push(<Fragment key={m.index}>{render ? render(m[2]) : m[2]}</Fragment>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
