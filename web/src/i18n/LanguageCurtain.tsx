import './LanguageCurtain.css';

/* The curtain a language change plays behind (see setLang in ./index.tsx): the hero's cloud banks close in from the
   top and the bottom, the coin turns in the middle with the wordmark and the language being opened, then the clouds
   part on the page in its new language. Its timing lives in CURTAIN_MS; the CSS animations are cut to match. */

export type CurtainPhase = 'cover' | 'hold' | 'reveal';

const WORD = 'HANMARKET'.split('');

export function LanguageCurtain({ lang, label, phase }: { lang: string; label: string; phase: CurtainPhase }) {
  return (
    <div className={`lc lc--${phase}`} role="status" aria-live="polite" aria-label={label}>
      {/* the same paper and cloud art as the hero, so dark mode's filters apply to them too (theme.css) */}
      <img className="lc-paper" src="/hero/bg-paper.webp" alt="" />
      <div className="lc-bank lc-bank--top" aria-hidden="true">
        <img src="/hero/clouds-back.webp" alt="" />
        <div className="lc-fill" />
      </div>
      <div className="lc-bank lc-bank--bottom" aria-hidden="true">
        <img src="/hero/clouds-back.webp" alt="" />
        <div className="lc-fill" />
      </div>
      <div className="lc-mark">
        <div className="lc-coin">
          <img src="/brand/hanmarket-mark.png" alt="" width={238} height={238} />
        </div>
        <div className="lc-word" lang="en" aria-hidden="true">
          {WORD.map((ch, i) => (
            <span key={i} style={{ ['--i' as string]: i }}>{ch}</span>
          ))}
        </div>
        <div className="lc-lang" lang={lang}>{label}</div>
        <div className="lc-loader" aria-hidden="true" />
      </div>
    </div>
  );
}
