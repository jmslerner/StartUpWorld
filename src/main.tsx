import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LeaderboardPage from './LeaderboardPage.tsx'

const path = window.location.pathname;
const Root = path === '/leaderboard' ? LeaderboardPage : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
