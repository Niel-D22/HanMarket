import type { FC } from 'react';
import { SilkBackground } from '../components/SilkBackground';
import { LogoText } from '../components/Navbar';

export const Privacy: FC = () => {
  return (
    <>
      <SilkBackground color="#FF8703" speed={1.0} intensity={0.25} scale={2.0} />
      
      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '8rem 2rem 4rem',
        color: '#FFF',
        fontFamily: "'Space Mono', monospace",
        lineHeight: '1.8'
      }}>
        <div className="glass-panel" style={{ padding: '3rem', borderRadius: '24px' }}>
          <h1 style={{ color: '#5EEAD4', fontSize: '2.5rem', marginBottom: '1rem', textShadow: '0 0 20px rgba(94,234,212,0.3)' }}>
            Privacy Policy
          </h1>
          <p style={{ color: '#A3A3A3', marginBottom: '3rem', fontSize: '1.1rem' }}>
            Last updated: August 2026
          </p>

          <h2 style={{ borderBottom: '1px solid rgba(var(--hm-card-c), 0.1)', paddingBottom: '0.5rem', marginBottom: '1.5rem', color: '#FFF' }}>
            1. Information We Do Not Collect
          </h2>
          <p style={{ marginBottom: '2rem' }}>
            As a decentralized application (dApp), <LogoText /> respects your privacy. We do not require you to create an account, provide an email address, or submit KYC (Know Your Customer) information to interact with our smart contracts.
          </p>

          <h2 style={{ borderBottom: '1px solid rgba(var(--hm-card-c), 0.1)', paddingBottom: '0.5rem', marginBottom: '1.5rem', color: '#FFF' }}>
            2. Blockchain Data
          </h2>
          <p style={{ marginBottom: '2rem' }}>
            By using the <LogoText /> protocol, you understand that all transaction data—including your public wallet address and trading history—is permanently recorded on the Robinhood Chain blockchain, which is a public and immutable ledger. We have no control over this data.
          </p>

          <h2 style={{ borderBottom: '1px solid rgba(var(--hm-card-c), 0.1)', paddingBottom: '0.5rem', marginBottom: '1.5rem', color: '#FFF' }}>
            3. Local Storage
          </h2>
          <p style={{ marginBottom: '2rem' }}>
            Our website may use local storage or session storage within your browser to save UI preferences (e.g., active tabs, RPC network preferences). This data is stored locally on your device and is not transmitted to any centralized servers.
          </p>
        </div>
      </div>
    </>
  );
};
