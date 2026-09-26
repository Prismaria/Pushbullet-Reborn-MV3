import { useState } from 'react'
import { AuthCard } from '../shared/AuthCard'
import { sendExtensionMessage } from '../shared/messages'
import { useExtensionState } from '../shared/useExtensionState'
import { getStreamTargets, StreamList, type PopupMode, type StreamTarget } from './StreamList'
import { PushComposer } from './PushComposer'
import type { Push } from '../shared/models'

function pushMatchesTarget(push: Push, target: StreamTarget | null): boolean {
  if (!target || target.id === '*') return true
  if (target.deviceIden) return push.targetDeviceIden === target.deviceIden || push.sourceDeviceIden === target.deviceIden
  if (target.email) return push.senderEmailNormalized === target.email || push.receiverEmailNormalized === target.email
  if (target.channelIden) return push.channelTag === target.channelIden
  return true
}

export function Popup() {
  const { state, setState, loading, error, refresh } = useExtensionState()
  const [mode, setMode] = useState<PopupMode>('me')
  const [selectedId, setSelectedId] = useState('*')

  if (loading && !state) {
    return <main className="surface popup-surface loading-surface">Loading Pushbullet state...</main>
  }

  if (!state) {
    return (
      <main className="surface popup-surface">
        <div className="status status-error" role="alert">{error || 'Extension state is unavailable.'}</div>
        <button className="primary-button" type="button" onClick={() => void refresh()}>Retry</button>
      </main>
    )
  }

  if (!state.user) {
    return (
      <main className={`surface popup-surface ${state.settings.darkMode ? 'theme-dark' : 'theme-light'}`}>
        {state.settings.hideSignInReminder ? (
          <section className="auth-card">
            <div className="eyebrow">Pushbullet Reborn</div>
            <h2>Account disconnected</h2>
            <p className="auth-copy">Sign-in reminders are hidden in Settings.</p>
            <button className="primary-button" type="button" onClick={() => void chrome.runtime.openOptionsPage()}>Open Settings</button>
          </section>
        ) : <AuthCard onStateChange={setState} />}
      </main>
    )
  }

  const targets = getStreamTargets(state, mode)
  const target = targets.find((item) => item.id === selectedId) || targets[0] || null
  const pushes = Object.values(state.pushes)
    .filter((push) => pushMatchesTarget(push, target))
    .sort((first, second) => (second.modified || second.created || 0) - (first.modified || first.created || 0))
    .slice(0, 20)
  const notifications = Object.values(state.notifications).sort((first, second) => second.createdAt - first.createdAt)
  const snoozed = state.settings.snoozedUntil > Date.now()

  const signOut = async () => {
    try {
      const response = await sendExtensionMessage({ type: 'sign_out' })
      if (response.ok) setState(response.state)
    } catch (caughtError) {
      console.warn('Could not sign out:', caughtError)
    }
  }

  const toggleSnooze = async () => {
    try {
      const response = await sendExtensionMessage({ type: 'set_snooze', enabled: !snoozed })
      if (response.ok) setState(response.state)
    } catch (caughtError) {
      console.warn('Could not update snooze state:', caughtError)
    }
  }

  const dismiss = async (key: string) => {
    try {
      const response = await sendExtensionMessage({ type: 'dismiss_notification', key })
      if (response.ok) setState(response.state)
    } catch (caughtError) {
      console.warn('Could not dismiss notification:', caughtError)
    }
  }

  const openFullView = async () => {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') })
    } catch (caughtError) {
      console.warn('Could not open the full view:', caughtError)
    }
  }

  const openSettings = async () => {
    try {
      await chrome.runtime.openOptionsPage()
    } catch (caughtError) {
      console.warn('Could not open settings:', caughtError)
    }
  }

  const selectMode = (nextMode: PopupMode) => {
    setMode(nextMode)
    setSelectedId('')
  }

  const openSmsChat = () => {
    if (!target?.deviceIden) return
    void chrome.windows.create({
      url: chrome.runtime.getURL(`chat.html?mode=sms&deviceIden=${encodeURIComponent(target.deviceIden)}`),
      type: 'popup',
      width: 460,
      height: 680
    })
  }

  return (
    <main className={`surface popup-surface popup-app ${state.settings.darkMode ? 'theme-dark' : 'theme-light'}`}>
      <header className="app-header">
        <div>
          <div className="eyebrow">Pushbullet Reborn</div>
          <h1>Pushes</h1>
        </div>
        <div className="header-actions">
          <div className="connection-chip"><span className="status-dot" />{state.connectionStatus}</div>
          <button className="small-button" type="button" onClick={() => void toggleSnooze()}>{snoozed ? 'Wake' : 'Snooze'}</button>
           <button className="small-button" type="button" onClick={() => void openFullView()}>Full view</button>
           <button className="small-button" type="button" onClick={() => void openSettings()}>Settings</button>
          <button className="icon-button" type="button" onClick={() => void signOut()} aria-label="Disconnect">×</button>
        </div>
      </header>

      <nav className="mode-tabs" aria-label="Push streams">
        {(['friends', 'me', 'following', 'sms'] as PopupMode[]).map((item) => (
          <button className={mode === item ? 'mode-tab-selected' : ''} key={item} type="button" onClick={() => selectMode(item)}>
            {item === 'me' ? 'My devices' : item === 'sms' ? 'SMS' : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      <div className="popup-layout">
        <aside className="stream-panel">
          <div className="panel-label">Streams</div>
          <StreamList targets={targets} selectedId={target?.id || ''} onSelect={(next: StreamTarget) => setSelectedId(next.id)} />
        </aside>
        <section className="chat-panel">
          {notifications.length > 0 && (
            <section className="notification-panel">
              <div className="notification-heading">
                <div className="panel-label">Notifications</div>
                <span className="notification-count">{notifications.length}</span>
              </div>
              {notifications.slice(0, 3).map((notification) => (
                <div className="notification-row" key={notification.key}>
                  <div>
                    <strong>{notification.title}</strong>
                    <p>{notification.message}</p>
                  </div>
                  <button className="dismiss-button" type="button" onClick={() => void dismiss(notification.key)}>Dismiss</button>
                </div>
              ))}
            </section>
          )}
          <div className="history-panel">
            <div className="panel-label">Recent pushes</div>
            {pushes.length ? pushes.map((push) => (
              <article className="push-row" key={push.iden}>
                <span className="push-type">{push.type || 'note'}</span>
                <div>
                  <strong>{push.title || push.body || push.url || push.fileName || 'Push'}</strong>
                  {push.body && push.title && <p>{push.body}</p>}
                </div>
              </article>
            )) : <div className="empty-history">No pushes cached yet.</div>}
          </div>
          {mode === 'sms' ? (
            <section className="composer">
              <div className="card-kicker">SMS</div>
              <h2>{target?.label || 'Select an SMS device'}</h2>
              <p className="auth-copy">Open the SMS window to browse threads, reply, and attach MMS files.</p>
              <button className="primary-button" type="button" onClick={openSmsChat} disabled={!target}>Open SMS</button>
            </section>
          ) : <PushComposer target={target} automaticallyAttachLink={state.settings.automaticallyAttachLink} onStateChange={setState} />}
        </section>
      </div>
    </main>
  )
}
