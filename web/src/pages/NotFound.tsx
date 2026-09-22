import type { FC } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';

export const NotFound: FC = () => {
  const { pathname } = useLocation();
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '120px 20px 60px',
        background: 'linear-gradient(rgba(var(--hm-bg-c), var(--hm-paper-veil)), rgba(var(--hm-bg-c), var(--hm-paper-veil))), var(--hm-bg) url("/hero/bg-paper.webp") right bottom / cover no-repeat',
        fontFamily: "'Inter Tight', system-ui, sans-serif",
        color: 'rgba(28,22,18,0.8)',
        textAlign: 'center',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        style={{ maxWidth: 520 }}
      >
        <div style={{ fontFamily: "'Noto Serif SC', serif", fontWeight: 700, fontSize: 64, color: 'var(--hm-red)', lineHeight: 1 }}>迷路</div>
        <h1 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 600, fontSize: 'clamp(2.4rem, 6vw, 3.6rem)', color: 'var(--hm-text)', margin: '18px 0 0', lineHeight: 1 }}>
          This page does not exist
        </h1>
        <p style={{ margin: '16px 0 0', lineHeight: 1.6 }}>
          Nothing lives at <code style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.9em' }}>{pathname}</code>. Check the address, or head back to the markets.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 28 }}>
          <Link to="/" style={{ padding: '12px 22px', borderRadius: 999, background: 'var(--hm-red)', color: '#fff', textDecoration: 'none', fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: 14 }}>
            Back to home
          </Link>
          <Link to="/terminal" style={{ padding: '12px 22px', borderRadius: 999, border: '1px solid rgba(var(--hm-line-c), 0.3)', color: 'var(--hm-text)', textDecoration: 'none', fontFamily: "'Montserrat', sans-serif", fontWeight: 600, fontSize: 14 }}>
            Open the terminal
          </Link>
        </div>
      </motion.div>
    </main>
  );
};
