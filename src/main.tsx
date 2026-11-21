import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LeaderboardPage from './LeaderboardPage.tsx'
import { ErrorBoundary } from './ui/components/ErrorBoundary.tsx'
import { useGameStore } from './state/useGameStore.ts'

const path = window.location.pathname;

// Dev-only sandboxes for the 3D world (stripped from production builds).
const WorldPreview = import.meta.env.DEV ? lazy(() => import('./world/dev/WorldPreview.tsx')) : null;
const PropGallery = import.meta.env.DEV ? lazy(() => import('./world/dev/PropGallery.tsx')) : null;

const Root =
  path === '/leaderboard'
    ? LeaderboardPage
    : path === '/world-preview' && WorldPreview
      ? WorldPreview
      : path === '/world-gallery' && PropGallery
        ? PropGallery
        : App;

// A crash in the game offers "new game", which wipes the saved run. The leaderboard
// page and the dev sandboxes never touch the save, so a crash there only reloads.
const handleErrorReset = Root === App ? () => useGameStore.getState().resetGame() : undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onReset={handleErrorReset}>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
)
