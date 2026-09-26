import { useEffect, useState } from 'react'
import { isStateChangedEvent, sendExtensionMessage } from './messages'
import type { ExtensionState } from './models'

export function useExtensionState() {
  const [state, setState] = useState<ExtensionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    try {
      const response = await sendExtensionMessage({ type: 'get_state' })
      if (!response.ok) throw new Error(response.error)
      setState(response.state)
      setError('')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not load extension state.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()

    const onMessage = (message: unknown) => {
      if (isStateChangedEvent(message)) setState(message.state)
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  return { state, setState, loading, error, refresh }
}
