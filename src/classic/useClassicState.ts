import { useEffect, useState } from 'react'
import { sendExtensionMessage } from '../shared/messages'
import type { ExtensionState } from '../shared/models'

export function useClassicState(initialState?: ExtensionState, startupState?: Promise<ExtensionState | undefined>) {
  const [state, setState] = useState<ExtensionState | null>(initialState ?? null)
  const [loading, setLoading] = useState(!initialState)

  useEffect(() => {
    if (!state) return
    try {
      localStorage.setItem('classicPanelDarkMode', String(state.settings.darkMode))
      localStorage.setItem('classicPanelShowSentPushes', String(state.settings.showSentPushesInDeviceHistory !== false))
    } catch {
      // Keep the popup's first-paint preference in sync with other Classic pages.
    }
  }, [state?.settings.darkMode, state?.settings.showSentPushesInDeviceHistory])

  useEffect(() => {
    let cancelled = false
    let receivedUpdate = false
    const load = async () => {
      try {
        if (startupState) {
          const stored = await startupState
          if (stored) {
            if (!cancelled && !receivedUpdate) setState(stored)
            // Wake the worker for its connection maintenance, without copying the full state again.
            await sendExtensionMessage({ type: 'ping' })
            return
          }
        }
        const response = await sendExtensionMessage({ type: 'get_state' })
        if (response.ok && !cancelled && !receivedUpdate) setState(response.state)
      } catch (error) {
        console.warn('Could not refresh Classic extension state:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const listener = (message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'state_changed' && 'state' in message) {
        receivedUpdate = true
        setState((message as { state: ExtensionState }).state)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => {
      cancelled = true
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [])

  return { state, setState, loading }
}
