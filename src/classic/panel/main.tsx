import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClassicPanel } from '../ClassicPanel'
import { normalizeState } from '../../background/state'

async function mountPanel() {
  performance.mark('classic-popup-react-entry')
  const popupWindow = window as Window & { classicPanelStartup?: Promise<unknown>; classicPanelCachedState?: unknown }
  const startupState = popupWindow.classicPanelStartup ? readStartupState(popupWindow.classicPanelStartup) : undefined
  const cachedState = normalizeStoredState(popupWindow.classicPanelCachedState)
  const initialState = cachedState || await startupState
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ClassicPanel initialState={initialState} startupState={startupState} />
    </StrictMode>
  )
}

function normalizeStoredState(state: unknown) {
  return state && typeof state === 'object' ? normalizeState(state) : undefined
}

async function readStartupState(startup: Promise<unknown>) {
  return normalizeStoredState(await startup)
}

void mountPanel()
