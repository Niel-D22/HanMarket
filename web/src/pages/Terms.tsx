import type { FC } from 'react';
import { SilkBackground } from '../components/SilkBackground';
import { LogoText } from '../components/Navbar';

export const Terms: FC = () => {
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
            Terms & Conditions
          </h1>
          <p style={{ color: '#A3A3A3', marginBottom: '3rem', fontSize: '1.1rem' }}>
            Last updated: August 2026
          </p>

          <h2 style={{ borderBottom: '1px solid rgba(var(--hm-card-c), 0.1)', paddingBottom: '0.5rem', marginBottom: '1.5rem', color: '#FFF' }}>
            1. Introduction
          </h2>
          <p style={{ marginBottom: '2rem' }}>
            Welcome to <LogoText />. By accessing or using our decentralized protocol and website, you agree to be bound by these Terms & Conditions. If you do not agree to all the terms and conditions, then you may not access the protocol.
          </p>

          <h2 style={{ borderBottom: '1px solid rgba(var(--hm-card-c), 0.1)', paddingBottom: '0.5rem', marginBottom: '1.5rem', color: '#FFF' }}>
            2. Decentralized Protocol
          </h2>
          <p style={{ marginBottom: '2rem' }}>
            <LogoText /> is a decentralized application (dApp) built on Robinhood Chain. We do not hold your funds, take custody of your assets, or execute trades on your behalf. All transactions are peer-to-peer and governed entirely by smart contracts.
          </p>

          <h2 style={{ borderBottom: '1px solid rgba(var(--hm-card-c), 0.1)', paddingBottom: '0.5rem', marginBottom: '1.5rem', color: '#FFF' }}>
            3. Risk Assumption
          </h2>
          <p style={{ marginBottom: '2rem' }}>
            Trading synthetic derivatives involves significant risk of capital loss. Options and perpetual contracts can expire worthless. By using this protocol, you acknowledge that you are fully aware of these risks and solely responsible for any losses incurred.
          </p>
        </div>
      </div>
    </>
  );
};
