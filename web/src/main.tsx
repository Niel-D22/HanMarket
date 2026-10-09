import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import './theme/theme.css'
import { NetworkProvider } from './contexts/NetworkContext.tsx'
import { ThemeProvider } from './theme/ThemeProvider.tsx'
import { I18nProvider, i18nReady } from './i18n'

// a visitor whose language is not English gets their dictionary first (one small file), so the page opens in it
void i18nReady.then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
      <ThemeProvider>
        <NetworkProvider>
          <App />
        </NetworkProvider>
      </ThemeProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
))
