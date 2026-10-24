import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'

// Keep the installed app current: a new build activates immediately and the
// page reloads once, so phones never keep showing an old cached version.
if ('serviceWorker' in navigator) {
  const update = registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => void registration.update().catch(() => undefined)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      setInterval(check, 60 * 60 * 1000)
    },
  })
  void update
}

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
