import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LeaderboardPage from './LeaderboardPage.tsx'
import { ErrorBoundary } from './ui/components/ErrorBoundary.tsx'
import { useGameStore } from './state/useGameStore.ts'

const path = window.location.pathname;
const Root = path === '/leaderboard' ? LeaderboardPage : App;

const handleErrorReset = () => {
  useGameStore.getState().resetGame();
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary onReset={handleErrorReset}>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
)
