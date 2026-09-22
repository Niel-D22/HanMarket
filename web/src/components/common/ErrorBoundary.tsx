import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** changing this (e.g. the route) clears a previous error */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/** Keeps a rendering error in one page from blanking the whole site. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '120px 20px 60px',
          background: '#F6F2EB',
          color: 'rgba(28,22,18,0.8)',
          fontFamily: "'Inter Tight', system-ui, sans-serif",
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <h1 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 600, fontSize: '2.4rem', color: '#0B0B0B', margin: 0 }}>
            Something went wrong on this page
          </h1>
          <p style={{ lineHeight: 1.6, margin: '14px 0 0' }}>
            Reload to try again. If you switched networks, switching back to Testnet usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: 24, padding: '12px 22px', borderRadius: 999, border: 'none', background: '#AB000D', color: '#fff', fontFamily: "'Montserrat', sans-serif", fontWeight: 600, cursor: 'pointer' }}
          >
            Reload page
          </button>
        </div>
      </main>
    );
  }
}
