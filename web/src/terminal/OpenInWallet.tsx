import { useEffect, useRef } from 'react';
import { WALLETCONNECT_ENABLED } from '../providers/WalletContextProvider';
import { useT } from '../i18n';

/**
 * A phone browser with no wallet inside it (Safari or Chrome on an iPhone, most Android browsers). Wallets there live
 * in their own apps, so the dapp has to be opened in the app's built-in browser. With a WalletConnect project id the
 * connect modal handles this itself; without one it has nothing to offer on a phone, so this sheet does.
 */
export const needsWalletApp = () =>
  !WALLETCONNECT_ENABLED &&
  typeof window !== 'undefined' &&
  !(window as { ethereum?: unknown }).ethereum &&
  window.matchMedia('(pointer: coarse)').matches;

/** Each wallet's documented link for opening a page inside its browser. */
const WALLETS = [
  { name: 'MetaMask', href: () => `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}` },
  { name: 'Coinbase Wallet', href: () => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(window.location.href)}` },
  { name: 'Trust Wallet', href: () => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(window.location.href)}` },
];

export function OpenInWallet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div className="tm-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tm-modal tm-wallet-app" role="dialog" aria-modal="true" aria-labelledby="tm-wa-title">
        <div className="tm-modal-h">
          <b id="tm-wa-title">{t('tm.openInWalletTitle')}</b>
          <button ref={closeRef} type="button" className="tm-link" onClick={onClose}>{t('tm.dismiss')}</button>
        </div>
        <p className="tm-note" style={{ marginTop: 0 }}>
          {t('tm.openInWalletBody')}
        </p>
        <div className="tm-wallet-app-list">
          {WALLETS.map((w) => (
            <a key={w.name} className="tm-cta neutral" href={w.href()} rel="noopener">{t('tm.openIn', { name: w.name })}</a>
          ))}
        </div>
        <p className="tm-note">{t('tm.noWalletApp')}</p>
      </div>
    </div>
  );
}
