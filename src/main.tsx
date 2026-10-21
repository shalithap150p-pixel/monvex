import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Apply the last used theme immediately to avoid a flash before data loads.
try {
  const theme = localStorage.getItem('monvex.theme')
  if (theme === 'navy' || theme === 'noir') document.documentElement.dataset.theme = theme
} catch {
  /* storage unavailable */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
