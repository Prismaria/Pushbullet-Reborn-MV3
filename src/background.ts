import {
  isExtensionMessage,
  type ExtensionMessage,
  type ExtensionResponse
} from './shared/messages'
import { ApiError, validateToken } from './background/api'
import { clearToken, readState, readToken, updateState, writeState, writeToken } from './background/state'
import { broadcastState } from './background/events'
import { connectWebSocket, disconnectWebSocket, handleAlarm, handleIdleState, initializeConnection } from './background/connection'
import { loadMorePushHistory, refreshRemoteState } from './background/remote'
import { clearNativeNotifications, dismissNotification, refreshNotificationBadge, registerNotificationListeners } from './background/notifications'
import { registerUploadPort } from './background/upload-port'
import { clearActiveChat, getPhonebook, getSmsThread, getSmsThreads, sendSms, setActiveChat } from './background/sms'
import { handleCommand, registerContextMenuEvents, setupContextMenus } from './background/context'
import { sendPush } from './background/pushes'
import type { ExtensionState } from './shared/models'

async function applyActionIcon(state: ExtensionState): Promise<void> {
  if (!chrome.action?.setIcon) return
  try {
    await chrome.action.setIcon({
      path: state.settings.useDarkIcon
        ? { 19: 'icon_19_gray.png', 38: 'icon_38_gray.png' }
        : { 16: 'icon_16.png', 48: 'icon_48.png' }
    })
  } catch (error) {
    console.warn('Could not update the toolbar icon:', error)
  }
}

async function initialize(): Promise<void> {
  const state = await readState()
  if (!state.installedAt) {
    await writeState({ ...state, installedAt: new Date().toISOString() })
  }
  await initializeConnection()
  await setupContextMenus()
  await refreshNotificationBadge()
  await applyActionIcon(state)
}

async function setToken(token: string): Promise<ExtensionState> {
  const user = await validateToken(token)
  await writeToken(token)
  let state = await updateState((current) => ({
    ...current,
    user,
    connectionStatus: 'connected'
  }))
  await broadcastState(state)
  try {
    state = await refreshRemoteState({ notify: false })
    await connectWebSocket()
    await setupContextMenus()
  } catch (error) {
    console.warn('Authenticated, but remote state could not be loaded:', error)
  }
  await applyActionIcon(state)
  return state
}

async function signOut(): Promise<ExtensionState> {
  await disconnectWebSocket()
  await clearToken()
  const previous = await readState()
  await clearNativeNotifications(Object.keys(previous.notifications))
  const state = await updateState((current) => ({
    ...current,
    user: null,
    device: null,
    devices: {},
    chats: {},
    subscriptions: {},
    channels: {},
    grants: {},
    pushes: {},
    pushHistoryCursor: null,
    pushHistoryLoadedPages: 0,
    texts: {},
    notifications: {},
    connectionStatus: 'disconnected',
    awake: false
  }))
  await broadcastState(state)
  await setupContextMenus()
  await refreshNotificationBadge()
  await applyActionIcon(state)
  return state
}

async function refreshState(): Promise<ExtensionState> {
  const token = await readToken()
  if (!token) return signOut()

  try {
    const state = await refreshRemoteState({ notify: false })
    await connectWebSocket()
    return state
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return signOut()
    throw error
  }
}

async function saveSettings(settings: ExtensionMessage & { type: 'save_settings' }): Promise<ExtensionState> {
  const state = await updateState((current) => ({
    ...current,
    settings: { ...current.settings, ...settings.settings }
  }))
  await broadcastState(state)
  await setupContextMenus()
  await refreshNotificationBadge()
  await applyActionIcon(state)
  return state
}

async function setSnooze(enabled: boolean): Promise<ExtensionState> {
  const state = await updateState((current) => ({
    ...current,
    settings: { ...current.settings, snoozedUntil: enabled ? Date.now() + 60 * 60 * 1000 : 0 }
  }))
  await broadcastState(state)
  return state
}

async function handleMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'ping':
      return { ok: true, service: 'background' }
    case 'get_state':
      return { ok: true, state: await readState() }
    case 'set_token':
      return { ok: true, state: await setToken(message.token) }
    case 'sign_out':
      return { ok: true, state: await signOut() }
    case 'refresh_state':
      return { ok: true, state: await refreshState() }
    case 'load_more_push_history':
      return { ok: true, state: await loadMorePushHistory() }
    case 'save_settings':
      return { ok: true, state: await saveSettings(message) }
    case 'send_push': {
      const result = await sendPush(message.push)
      return { ok: true, state: result.state, push: result.push }
    }
    case 'dismiss_notification':
      await dismissNotification(message.key)
      return { ok: true, state: await readState() }
    case 'set_snooze':
      return { ok: true, state: await setSnooze(message.enabled) }
    case 'get_sms_threads':
      return { ok: true, threads: await getSmsThreads(message.deviceIden) }
    case 'get_sms_thread':
      return { ok: true, messages: await getSmsThread(message.deviceIden, message.threadId) }
    case 'get_phonebook':
      return { ok: true, data: await getPhonebook(message.deviceIden) }
    case 'send_sms': {
      const result = await sendSms(message.sms)
      return { ok: true, state: result.state, sms: result.sms }
    }
    case 'set_active_chat':
      await setActiveChat(message.key)
      return { ok: true, state: await readState() }
    case 'clear_active_chat':
      await clearActiveChat(message.key)
      return { ok: true, state: await readState() }
    default:
      return { ok: false, error: 'Unknown extension message.' }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initialize().catch((error: unknown) => {
    console.error('Could not initialize extension state:', error)
  })
})

registerNotificationListeners()
registerContextMenuEvents()

void initialize().catch((error: unknown) => {
  console.error('Could not load extension state:', error)
})

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isExtensionMessage(message)) return

  void (async () => {
    try {
      sendResponse(await handleMessage(message))
    } catch (error: unknown) {
      console.error('Extension message failed:', error)
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown service-worker error'
      })
    }
  })()

  return true
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'upload') registerUploadPort(port)
})

if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    void handleAlarm(alarm.name).catch((error: unknown) => console.error('Pushbullet alarm failed:', error))
  })
}

if (chrome.idle) {
  chrome.idle.onStateChanged.addListener(handleIdleState)
}

if (chrome.commands) {
  chrome.commands.onCommand.addListener((command, tab) => {
    void handleCommand(command, tab).catch((error) => console.error('Command failed:', error))
  })
}
