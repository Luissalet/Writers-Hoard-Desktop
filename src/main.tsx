import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// AI bridge: only the desktop shell has one, and only this window serves it.
// Loaded dynamically so its tool table stays out of the entry chunk (the
// bundle budget gate watches that one), and at module scope rather than in an
// effect so StrictMode cannot wire the IPC listener twice.
if (typeof window !== 'undefined' && window.electronAPI?.aiBridge) {
  void import('./services/aiBridge/dispatch')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
