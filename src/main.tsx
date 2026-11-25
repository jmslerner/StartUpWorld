import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CAREER_SAVE_KEY } from './state/careerSave.ts'
import { SAVE_KEY } from './state/save.ts'
import { ErrorBoundary } from './ui/components/ErrorBoundary.tsx'

/** After a crash, start clean: a save that breaks the app must not break it again on reload. Both saves go, each on its own. */
const forgetSave = () => {
  for (const key of [SAVE_KEY, CAREER_SAVE_KEY]) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Storage is blocked: there is no save to forget.
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onReset={forgetSave}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
