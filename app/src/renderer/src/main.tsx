import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { SetupWindow } from './components/setup/SetupWindow'
import { isMockMode } from './env'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'

async function boot() {
  const params = new URLSearchParams(window.location.search)
  // Mocks exist only in dev builds (npm run web / dev:mock); production drops the MSW chunk and fixtures.
  if (import.meta.env.DEV && isMockMode()) {
    const { startMockWorker } = await import('./mocks/browser')
    await startMockWorker()
    const { applyMockScenarios } = await import('./mocks/scenarios')
    applyMockScenarios(params)
  }
  // Main opens Setup (its ACTIVATE step for beta access, then first-run model installs) as index.html?window=setup
  // (same bundle, same preload).
  const root = params.get('window') === 'setup' ? <SetupWindow /> : <App />
  createRoot(document.getElementById('root')!).render(<StrictMode>{root}</StrictMode>)
}

void boot()
