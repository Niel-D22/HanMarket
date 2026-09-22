import { lazy, Suspense } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Navbar } from './components/Navbar';
import { Docs } from './pages/Docs';
import { Terms } from './pages/Terms';
import { Privacy } from './pages/Privacy';
import { NotFound } from './pages/NotFound';
import './index.css';

import Landing from './pages/Landing';

const TerminalApp = lazy(() => import('./pages/TerminalApp'));

const TerminalLoading = () => (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#F6F2EB', fontFamily: "'Montserrat', sans-serif", letterSpacing: '0.3em', fontSize: 12, color: 'rgba(40,33,28,0.55)' }}>
    LOADING TERMINAL
  </div>
);

function App() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
    <Routes>
      <Route path="/" element={<><Navbar variant="landing" /><Landing /></>} />
      <Route path="/terminal" element={<Suspense fallback={<TerminalLoading />}><TerminalApp /></Suspense>} />
      <Route path="/docs" element={<><Navbar variant="landing" /><Docs /></>} />
      <Route path="/terms" element={<><Navbar variant="landing" /><Terms /></>} />
      <Route path="/privacy" element={<><Navbar variant="landing" /><Privacy /></>} />
      <Route path="*" element={<><Navbar variant="landing" /><NotFound /></>} />
    </Routes>
    </ErrorBoundary>
  );
}

export default App;
