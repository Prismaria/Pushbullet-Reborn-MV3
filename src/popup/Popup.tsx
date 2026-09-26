import { useState } from 'react'
import { sendExtensionMessage, type ExtensionResponse } from '../shared/messages'

type ConnectionState = 'idle' | 'checking' | 'connected' | 'error'

export function Popup() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [error, setError] = useState('')

  const checkBackground = async () => {
    setConnectionState('checking')
    setError('')

    try {
      const response = await sendExtensionMessage<ExtensionResponse>({ type: 'ping' })
      if (!response.ok) throw new Error('The service worker did not confirm the connection.')
      setConnectionState('connected')
    } catch (caughtError) {
      setConnectionState('error')
      setError(caughtError instanceof Error ? caughtError.message : 'Could not reach the service worker.')
    }
  }

  const status = connectionState === 'connected'
    ? 'Service worker connected'
    : connectionState === 'checking'
      ? 'Checking connection...'
      : connectionState === 'error'
        ? error
        : 'The new extension shell is ready.'

  return (
    <main className="surface popup-surface">
      <div className="eyebrow">Manifest V3</div>
      <h1>Pushbullet Reborn</h1>
      <p className="lede">A clean foundation for the next generation of the Pushbullet client.</p>

      <div className={`status status-${connectionState}`} aria-live="polite">
        <span className="status-dot" />
        {status}
      </div>

      <button className="primary-button" type="button" onClick={checkBackground} disabled={connectionState === 'checking'}>
        {connectionState === 'checking' ? 'Checking...' : 'Check service worker'}
      </button>
    </main>
  )
}
