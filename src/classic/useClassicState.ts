import { useEffect, useState } from 'react'
import { sendExtensionMessage } from '../shared/messages'
import type { ExtensionState } from '../shared/models'

export function useClassicState() {
  const [state, setState] = useState<ExtensionState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const response = await sendExtensionMessage({ type: 'get_state' })
        if (response.ok) setState(response.state)
      } finally {
        setLoading(false)
      }
    }
    void load()
    const listener = (message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'state_changed' && 'state' in message) setState((message as { state: ExtensionState }).state)
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  return { state, setState, loading }
}
