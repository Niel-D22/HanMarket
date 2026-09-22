import type { FC } from 'react';

export const KYCDisclaimer: FC = () => {
  return (
    <div style={{
      marginTop: '2rem',
      padding: '1rem',
      borderTop: '1px solid rgba(11,11,11, 0.1)',
      textAlign: 'center',
      fontSize: '0.75rem',
      color: 'rgba(40,33,28,0.42)',
      fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    }}>
      <p style={{ margin: 0 }}>
        <strong>DISCLAIMER:</strong> HanMarket options are synthetic, cash-settled derivatives on Hong Kong and China equities.
        They do not give ownership of any share. Not offered to persons in restricted jurisdictions, including the United States,
        mainland China and Hong Kong. By connecting your wallet you confirm you are legally permitted to trade them.
      </p>
    </div>
  );
};
