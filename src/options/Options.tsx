import { useEffect, useState } from 'react'
import { AuthCard } from '../shared/AuthCard'
import { sendExtensionMessage } from '../shared/messages'
import type { ExtensionSettings } from '../shared/models'
import { useExtensionState } from '../shared/useExtensionState'

type BooleanSettingKey = {
  [K in keyof ExtensionSettings]-?: ExtensionSettings[K] extends boolean ? K : never
}[keyof ExtensionSettings]

type BooleanSetting = {
  key: BooleanSettingKey
  title: string
  description: string
}

const appearanceSettings: BooleanSetting[] = [
  { key: 'darkMode', title: 'Dark mode', description: 'Use the dark Pushbullet interface.' },
  { key: 'useDarkIcon', title: 'Dark toolbar icon', description: 'Use the dark icon variant in the browser toolbar.' },
  { key: 'onlyShowTitles', title: 'Only show titles', description: 'Keep notification previews compact.' }
]

const notificationSettings: BooleanSetting[] = [
  { key: 'playSound', title: 'Play notification sounds', description: 'Play the alert sound through the offscreen audio document.' },
  { key: 'showMirrors', title: 'Show mirrored notifications', description: 'Allow notifications mirrored from mobile devices.' },
  { key: 'showNotificationCount', title: 'Show notification count', description: 'Keep the action badge synchronized with active notifications.' },
  { key: 'openMyLinksAutomatically', title: 'Open incoming links', description: 'Open incoming link pushes in a background tab.' }
]

const behaviorSettings: BooleanSetting[] = [
  { key: 'automaticallyAttachLink', title: 'Attach the active link', description: 'Prefer the current tab when composing a link push.' },
  { key: 'showContextMenu', title: 'Show context-menu actions', description: 'Expose Pushbullet actions on pages, links, and selected text.' },
  { key: 'allowInstantPush', title: 'Allow instant push command', description: 'Allow the configured keyboard command to send the active tab.' },
  { key: 'disableAnalytics', title: 'Disable analytics', description: 'Do not send optional usage analytics.' },
  { key: 'hideSignInReminder', title: 'Hide sign-in reminders', description: 'Do not show reminders when the account is disconnected.' },
  { key: 'needsDataApproval', title: 'Require data approval', description: 'Keep privacy approval explicit before optional account data is used.' }
]

function permissionContains(permission: string): Promise<boolean> {
  if (!chrome.permissions) return Promise.resolve(false)
  return new Promise((resolve) => chrome.permissions.contains({ permissions: [permission] }, resolve))
}

function requestPermission(permission: string): Promise<boolean> {
  if (!chrome.permissions) return Promise.resolve(false)
  return new Promise((resolve) => chrome.permissions.request({ permissions: [permission] }, resolve))
}

export function Options() {
  const { state, setState, loading, error, refresh } = useExtensionState()
  const [saving, setSaving] = useState(false)
  const [contextMenusGranted, setContextMenusGranted] = useState<boolean | null>(null)

  useEffect(() => {
    const loadPermission = async () => {
      setContextMenusGranted(await permissionContains('contextMenus'))
    }
    void loadPermission()
  }, [])

  if (loading && !state) {
    return <main className="surface options-surface loading-surface">Loading Pushbullet settings...</main>
  }

  if (!state) {
    return (
      <main className="surface options-surface">
        <div className="status status-error" role="alert">{error || 'Extension state is unavailable.'}</div>
        <button className="primary-button" type="button" onClick={() => void refresh()}>Retry</button>
      </main>
    )
  }

  const updateSetting = async <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => {
    setSaving(true)
    try {
      const response = await sendExtensionMessage({ type: 'save_settings', settings: { [key]: value } })
      if (response.ok) setState(response.state)
    } catch (caughtError) {
      console.warn('Could not save setting:', caughtError)
    } finally {
      setSaving(false)
    }
  }

  const requestContextMenus = async () => {
    const granted = await requestPermission('contextMenus')
    setContextMenusGranted(granted)
    if (granted) await updateSetting('showContextMenu', true)
  }

  const renderSettings = (settings: BooleanSetting[]) => settings.map((setting) => (
    <label className="setting-row" key={setting.key}>
      <span>
        <strong>{setting.title}</strong>
        <small>{setting.description}</small>
      </span>
      <input
        type="checkbox"
        checked={Boolean(state.settings[setting.key])}
        onChange={(event) => void updateSetting(setting.key, event.target.checked)}
        disabled={saving}
      />
    </label>
  ))

  return (
    <main className={`surface options-surface ${state.settings.darkMode ? 'theme-dark' : 'theme-light'}`}>
      <header className="options-header">
        <div>
          <div className="eyebrow">Pushbullet Reborn</div>
          <h1>Settings</h1>
          <p className="lede">Worker-owned authentication, notifications, uploads, chat, and settings for the MV3 extension.</p>
        </div>
      </header>

      {!state.user ? (
        <AuthCard onStateChange={setState} />
      ) : (
        <section className="settings-card" aria-labelledby="account-heading">
          <div className="card-kicker">Connected account</div>
          <h2 id="account-heading">{state.user.name || state.user.email || 'Pushbullet user'}</h2>
          <p>{state.user.email}</p>
          <button className="ghost-button" type="button" onClick={async () => {
            const response = await sendExtensionMessage({ type: 'sign_out' })
            if (response.ok) setState(response.state)
          }}>Disconnect</button>
        </section>
      )}

      <section className="settings-card" aria-labelledby="appearance-heading">
        <div className="card-kicker">Preferences</div>
        <h2 id="appearance-heading">Appearance</h2>
        {renderSettings(appearanceSettings)}
      </section>

      <section className="settings-card" aria-labelledby="notifications-heading">
        <div className="card-kicker">Notifications</div>
        <h2 id="notifications-heading">Alerts and previews</h2>
        {renderSettings(notificationSettings)}
        <label className="setting-row">
          <span><strong>Notification duration</strong><small>Automatically clear alerts after a short delay.</small></span>
          <select value={state.settings.notificationDuration} onChange={(event) => void updateSetting('notificationDuration', Number(event.target.value))} disabled={saving}>
            <option value={0}>System default</option>
            <option value={30}>30 seconds</option>
            <option value={60}>60 seconds</option>
          </select>
        </label>
      </section>

      <section className="settings-card" aria-labelledby="behavior-heading">
        <div className="card-kicker">Behavior</div>
        <h2 id="behavior-heading">Commands and context menu</h2>
        {renderSettings(behaviorSettings)}
        {state.settings.allowInstantPush && (
          <label className="setting-row setting-input-row">
            <span><strong>Instant push device</strong><small>Use `*` for all devices or enter a device identifier.</small></span>
            <input className="inline-setting-input" value={state.settings.instantPushIden} onChange={(event) => void updateSetting('instantPushIden', event.target.value)} disabled={saving} />
          </label>
        )}
        {contextMenusGranted === false && (
          <div className="permission-row">
            <span>Context-menu permission is optional and currently disabled.</span>
            <button className="ghost-button" type="button" onClick={() => void requestContextMenus()}>Enable</button>
          </div>
        )}
        {contextMenusGranted && <div className="permission-ok">Context-menu permission is enabled.</div>}
      </section>
    </main>
  )
}
