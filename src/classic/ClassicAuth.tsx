import { useState, type FormEvent } from 'react'
import { sendExtensionMessage } from '../shared/messages'
import type { ExtensionState } from '../shared/models'

type ClassicAuthProps = {
  state: ExtensionState
  onStateChange: (state: ExtensionState) => void
  options?: boolean
}

export function ClassicAuth({ state, onStateChange, options = false }: ClassicAuthProps) {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState('')
  const [statusKind, setStatusKind] = useState<'idle' | 'success' | 'error' | 'connecting'>('idle')
  const [busy, setBusy] = useState(false)
  const accountStatus = status || (state.user ? `Authenticated as ${state.user.email || state.user.name || 'Pushbullet user'}.` : '')
  const accountStatusKind = status ? statusKind : state.user ? 'success' : 'idle'

  const connect = async (event: FormEvent) => {
    event.preventDefault()
    if (!token.trim()) {
      setStatus('Paste your access token first.')
      setStatusKind('error')
      return
    }
    setBusy(true)
    setStatus('Validating access token...')
    setStatusKind('connecting')
    try {
      const response = await sendExtensionMessage({ type: 'set_token', token: token.trim() })
      if (!response.ok) throw new Error(response.error)
      setToken('')
      setStatus('')
      setStatusKind('success')
      onStateChange(response.state)
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not connect.')
      setStatusKind('error')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      const response = await sendExtensionMessage({ type: 'sign_out' })
      if (!response.ok) throw new Error(response.error)
      setStatus('Disconnected.')
      setStatusKind('idle')
      onStateChange(response.state)
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not disconnect.')
      setStatusKind('error')
    } finally {
      setBusy(false)
    }
  }

  if (options) {
    return (
      <div id="access-token-option" className="token-auth-card">
        <h2>Pushbullet account</h2>
        <p>Enter an access token from <a href="https://www.pushbullet.com/#settings/account" target="_blank" rel="noreferrer">Pushbullet account settings</a>.</p>
        <form onSubmit={connect}>
          <p><input id="access-token" className="token-auth-input" type="password" autoComplete="off" placeholder={state.user ? 'Access token is configured' : 'Access token'} value={token} onChange={(event) => setToken(event.target.value)} disabled={busy} /></p>
          <button id="save-access-token" className="token-auth-button" type="submit" disabled={busy}>Connect</button>
          <button id="clear-access-token" className="token-auth-button gray" type="button" onClick={() => void disconnect()} disabled={busy}>Disconnect</button>
          <span id="access-token-status" className="token-auth-status" data-state={accountStatusKind} aria-live="polite">{accountStatus}</span>
        </form>
      </div>
    )
  }

  return (
    <div className="not-signed-in" style={{ height: '100%' }}>
      <div id="header">
        <a id="logo-link" href="https://www.pushbullet.com" target="_blank" rel="noreferrer"><div id="logo" /></a>
      </div>
      <div className="auth-panel">
        <form id="login-token-option" className="token-auth-card" onSubmit={connect}>
          <div className="token-auth-mark"><img src="../classic-assets/icon.png" alt="Pushbullet" /></div>
          <h1>Connect Pushbullet</h1>
          <p>Use an access token to connect this extension to your Pushbullet account.</p>
          <a className="token-auth-help" href="https://www.pushbullet.com/#settings/account" target="_blank" rel="noreferrer">Find your access token in account settings</a>
          <label className="token-auth-label" htmlFor="login-access-token">Access token</label>
          <div className="token-auth-row">
            <input id="login-access-token" className="token-auth-input" type="password" autoComplete="off" placeholder="Paste your access token" value={token} onChange={(event) => setToken(event.target.value)} disabled={busy} />
            <button id="login-connect" className="token-auth-button" type="submit" disabled={busy}>Connect</button>
          </div>
          <div id="login-token-status" className="token-auth-status" aria-live="polite">{status}</div>
          <p className="token-auth-footnote">Your token stays in the extension and is used only to connect to Pushbullet.</p>
        </form>
      </div>
    </div>
  )
}
