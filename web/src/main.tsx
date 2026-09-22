import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import './theme/theme.css'
import { NetworkProvider } from './contexts/NetworkContext.tsx'
import { ThemeProvider } from './theme/ThemeProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <NetworkProvider>
          <App />
        </NetworkProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
