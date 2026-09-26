import { useEffect, useState } from 'react'
import { sendExtensionMessage } from '../shared/messages'
import type { ExtensionSettings, ExtensionState } from '../shared/models'
import { ClassicAuth } from './ClassicAuth'
import { useClassicState } from './useClassicState'
import { CLASSIC_VERSION } from './version'

function containsPermission(permission: string): Promise<boolean> {
  if (!chrome.permissions) return Promise.resolve(false)
  return new Promise((resolve) => chrome.permissions.contains({ permissions: [permission] }, resolve))
}

function containsOrigin(origin: string): Promise<boolean> {
  if (!chrome.permissions) return Promise.resolve(false)
  return new Promise((resolve) => chrome.permissions.contains({ origins: [origin] }, resolve))
}

function requestPermission(permission: string): Promise<boolean> {
  if (!chrome.permissions) return Promise.resolve(false)
  return new Promise((resolve) => chrome.permissions.request({ permissions: [permission] }, resolve))
}

function ClassicToggle({ id, labelId, descId, label, description, checked, onChange, disabled = false }: { id: string; labelId: string; descId: string; label: string; description: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className="option"><label className="option-label"><div className="switch"><input type="checkbox" id={id} checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} /><span className="slider round" /></div><span id={labelId} className="option-title">{label}</span></label><div id={descId} className="option-desc">{description}</div></div>
}

export function ClassicOptions() {
  const { state: loadedState, setState, loading } = useClassicState()
  const [contextMenusGranted, setContextMenusGranted] = useState(false)
  const [tabsGranted, setTabsGranted] = useState(false)
  const [hostsGranted, setHostsGranted] = useState(false)

  useEffect(() => {
    const loadPermissions = async () => {
      setContextMenusGranted(await containsPermission('contextMenus'))
      setTabsGranted(await containsPermission('tabs'))
      setHostsGranted(await containsOrigin('https://api.pushbullet.com/*'))
    }
    void loadPermissions()
  }, [])

  useEffect(() => {
    document.body.classList.toggle('signed-in', Boolean(loadedState?.user))
    document.body.classList.toggle('not-signed-in', Boolean(loadedState && !loadedState.user))
    document.body.classList.toggle('darkmode', Boolean(loadedState?.settings.darkMode))
    return () => document.body.classList.remove('signed-in', 'not-signed-in', 'darkmode')
  }, [loadedState?.user, loadedState?.settings.darkMode])

  if (loading && !loadedState) return <div id="header" />
  if (!loadedState) return <div id="header" />

  const state = loadedState
  const updateSetting = async <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => {
    const response = await sendExtensionMessage({ type: 'save_settings', settings: { [key]: value } })
    if (response.ok) setState(response.state)
  }

  const enableContextMenus = async () => {
    const granted = await requestPermission('contextMenus')
    setContextMenusGranted(granted)
    if (granted) await updateSetting('showContextMenu', true)
  }

  return (
    <>
      <div id="header"><div className="inner"><div><a id="logo-link" href="#"><div id="logo" /></a><div style={{ marginLeft: '245px', marginTop: '-10px' }} id="version">v{CLASSIC_VERSION}</div></div><div id="account-holder" style={{ display: state.user ? 'block' : 'none' }}><img id="account-image" src={state.user?.imageUrl || '../classic-assets/chip_person.png'} alt="" /></div><img id="ribbon" style={{ display: state.user?.pro ? 'block' : 'none' }} src="../classic-assets/ribbon.png" alt="" /></div></div>
      <div style={{ position: 'relative', height: '100%' }}><div className="inner" style={{ marginBottom: '100px' }}><div id="options">
        <ClassicAuth state={state} onStateChange={setState} options />
        <div id="category-general"><p id="heading-general" className="section-heading">General</p>
          <ClassicToggle id="darkmode-checkbox" labelId="darkmode-label" descId="darkmode-desc" label="Dark mode" description="Use the dark Pushbullet interface." checked={state.settings.darkMode} onChange={(value) => void updateSetting('darkMode', value)} />
          <ClassicToggle id="dark-icon-checkbox" labelId="dark-icon-label" descId="dark-icon-desc" label="Dark icon" description="Use the dark toolbar icon." checked={state.settings.useDarkIcon} onChange={(value) => void updateSetting('useDarkIcon', value)} />
          <ClassicToggle id="notification-count-checkbox" labelId="notification-count-label" descId="notification-count-desc" label="Notification count" description="Show the number of active notifications on the toolbar icon." checked={state.settings.showNotificationCount} onChange={(value) => void updateSetting('showNotificationCount', value)} />
          <ClassicToggle id="open-automatically-checkbox" labelId="open-automatically-label" descId="open-automatically-desc" label="Open links automatically" description="Open incoming links in a background tab." checked={state.settings.openMyLinksAutomatically} onChange={(value) => void updateSetting('openMyLinksAutomatically', value)} />
          <ClassicToggle id="auto-attach-link-checkbox" labelId="auto-attach-link-label" descId="auto-attach-link-desc" label="Attach current link" description="Start link pushes with the active tab." checked={state.settings.automaticallyAttachLink} onChange={(value) => void updateSetting('automaticallyAttachLink', value)} />
        </div>
        <div id="category-notifications"><p id="heading-notifications" className="section-heading">Notifications</p>
          <ClassicToggle id="show-notifications-checkbox" labelId="show-notifications-label" descId="show-notifications-desc" label="Show notifications" description="Display mirrored notifications from your devices." checked={state.settings.showMirrors} onChange={(value) => void updateSetting('showMirrors', value)} />
          <ClassicToggle id="titles-only-checkbox" labelId="titles-only-label" descId="titles-only-desc" label="Titles only" description="Keep notification previews compact." checked={state.settings.onlyShowTitles} onChange={(value) => void updateSetting('onlyShowTitles', value)} />
          <ClassicToggle id="play-sound-checkbox" labelId="play-sound-label" descId="play-sound-desc" label="Play sound" description="Play the Pushbullet notification sound." checked={state.settings.playSound} onChange={(value) => void updateSetting('playSound', value)} />
        </div>
        <div id="category-advanced"><p id="heading-advanced" className="section-heading">Advanced</p>
          <ClassicToggle id="context-menu-checkbox" labelId="context-menu-label" descId="context-menu-desc" label="Context menu" description={contextMenusGranted ? 'Context-menu actions are enabled.' : 'Enable Pushbullet actions on pages, links, and selections.'} checked={state.settings.showContextMenu && contextMenusGranted} onChange={(value) => { if (value) void enableContextMenus(); else void updateSetting('showContextMenu', false) }} />
          <ClassicToggle id="tabs-permission-checkbox" labelId="tabs-permission-label" descId="tabs-permission-desc" label="Tabs permission" description="Read the active tab URL for explicit push actions." checked={tabsGranted} onChange={() => undefined} disabled />
          <ClassicToggle id="hosts-permission-checkbox" labelId="hosts-permission-label" descId="hosts-permission-desc" label="Pushbullet API access" description="Use the scoped Pushbullet API hosts." checked={hostsGranted} onChange={() => undefined} disabled />
          <ClassicToggle id="instant-push-checkbox" labelId="instant-push-label" descId="instant-push-desc" label="Instant push" description="Allow the configured keyboard command to send the active tab." checked={state.settings.allowInstantPush} onChange={(value) => void updateSetting('allowInstantPush', value)} />
          {state.settings.allowInstantPush && <label className="option-label" htmlFor="instant-push-devices"><span className="option-title">Instant push device</span><select id="instant-push-devices" value={state.settings.instantPushIden} onChange={(event) => void updateSetting('instantPushIden', event.target.value)}>{Object.values(state.devices).map((device) => <option key={device.iden} value={device.iden}>{device.nickname || device.model || device.iden}</option>)}<option value="*">All devices</option></select></label>}
        </div>
        <div id="category-faqs"><p id="heading-faqs" className="section-heading">FAQs</p><div style={{ marginLeft: '48px' }}><div id="question1" className="option-label">Where is my access token?</div><div id="answer1">Open Pushbullet account settings and create or copy an access token.</div></div></div>
      </div></div></div>
    </>
  )
}
