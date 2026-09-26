import { apiRequest } from './api'
import { broadcastState } from './events'
import { readState, updateState } from './state'
import { isChatActive } from './sms'
import { mirrorIdentity, type ExtensionState, type MirrorDetails, type NotificationRecord, type Push } from '../shared/models'
import { validateHttpUrl } from '../shared/validation'

const ICON_URL = 'icon_48.png'
const NOTIFICATION_ALARM_PREFIX = 'pb-notification-'
let offscreenPromise: Promise<void> | null = null

function safeHttpUrl(value: string | undefined): string | null {
  return value ? validateHttpUrl(value) : null
}

function chatUrl(email: string): string {
  const popup = chrome.runtime.getManifest().action?.default_popup || ''
  const classic = popup.startsWith('classic-pages/')
  const page = classic ? 'classic-pages/chat-window.html' : 'chat.html'
  const parameter = classic ? 'email' : 'target'
  return chrome.runtime.getURL(`${page}?mode=push&${parameter}=${encodeURIComponent(email)}`)
}

function notificationKey(push: Push): string {
  return push.type === 'mirror' ? `mirror_${mirrorIdentity(push.mirror, push.iden)}` : `push_${push.iden}`
}

function notificationAlarmName(key: string): string {
  return `${NOTIFICATION_ALARM_PREFIX}${encodeURIComponent(key)}`
}

function notificationKeyFromAlarm(name: string): string | null {
  if (!name.startsWith(NOTIFICATION_ALARM_PREFIX)) return null
  try {
    return decodeURIComponent(name.slice(NOTIFICATION_ALARM_PREFIX.length))
  } catch {
    return null
  }
}

function mirrorMessage(mirror: MirrorDetails | undefined): { title: string; message: string } {
  return {
    title: mirror?.applicationName || mirror?.packageName || 'Notification',
    message: [mirror?.title, mirror?.body].filter(Boolean).join('\n') || 'New notification'
  }
}

async function createNativeNotification(key: string, record: NotificationRecord): Promise<void> {
  if (!chrome.notifications) return
  const buttons = (record.buttons || []).map((button) => ({
    title: button.title,
    iconUrl: chrome.runtime.getURL(ICON_URL)
  }))
  await new Promise<void>((resolve) => {
    chrome.notifications.create(key, {
      type: 'basic',
      title: record.title,
      message: record.message,
      iconUrl: chrome.runtime.getURL(ICON_URL),
      priority: 0,
      isClickable: true,
      buttons
    }, () => {
      void chrome.runtime.lastError
      resolve()
    })
  })
}

async function clearNativeNotification(key: string): Promise<void> {
  if (!chrome.notifications) return
  await new Promise<void>((resolve) => {
    chrome.notifications.clear(key, () => {
      void chrome.runtime.lastError
      resolve()
    })
  })
}

async function updateBadge(state: ExtensionState): Promise<void> {
  if (!chrome.action) return
  const count = state.settings.showNotificationCount ? Object.keys(state.notifications).length : 0
  await chrome.action.setBadgeText({ text: count ? String(Math.min(count, 99)) : '' })
  if (count) await chrome.action.setBadgeBackgroundColor({ color: '#7edc99' })
}

async function playAlertSound(): Promise<void> {
  if (!chrome.offscreen) return
  try {
    if (!(await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length) {
      if (!offscreenPromise) {
        offscreenPromise = chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
          justification: 'Play Pushbullet notification sounds.'
        }).finally(() => {
          offscreenPromise = null
        })
      }
      await offscreenPromise
    }
    await chrome.runtime.sendMessage({ type: 'PLAY_ALERT_SOUND' })
  } catch (error) {
    console.warn('Notification sound is unavailable:', error)
  }
}

async function removeNotification(key: string, clearNative: boolean): Promise<ExtensionState> {
  if (clearNative) await clearNativeNotification(key)
  if (chrome.alarms) await chrome.alarms.clear(notificationAlarmName(key))
  const next = await updateState((state) => {
    if (!state.notifications[key]) return state
    const notifications = { ...state.notifications }
    delete notifications[key]
    return { ...state, notifications }
  })
  await updateBadge(next)
  await broadcastState(next)
  return next
}

async function dismissRemotePush(pushIden: string): Promise<void> {
  try {
    await apiRequest(`/v2/pushes/${encodeURIComponent(pushIden)}`, {
      method: 'POST',
      body: JSON.stringify({ dismissed: true })
    })
    await updateState((state) => {
      const push = state.pushes[pushIden]
      return push ? { ...state, pushes: { ...state.pushes, [pushIden]: { ...push, dismissed: true } } } : state
    })
  } catch (error) {
    console.warn('Could not dismiss Pushbullet push:', error)
  }
}

async function dismissMirror(mirror: MirrorDetails | undefined): Promise<void> {
  if (!mirror) return
  try {
    await apiRequest('/v2/ephemerals', {
      method: 'POST',
      body: JSON.stringify({
        type: 'push',
        push: {
          type: 'dismissal',
           source_user_iden: mirror.sourceUserIden,
          source_device_iden: mirror.sourceDeviceIden,
          package_name: mirror.packageName,
          notification_id: mirror.notificationId,
          notification_tag: mirror.notificationTag,
          conversation_iden: mirror.conversationIden
        }
      })
    })
  } catch (error) {
    console.warn('Could not dismiss mirrored notification:', error)
  }
}

export async function dismissNotification(key: string): Promise<void> {
  const state = await readState()
  const record = state.notifications[key]
  if (!record) return
  if (record.pushIden) await dismissRemotePush(record.pushIden)
  else await dismissMirror(record.mirror)
  await removeNotification(key, true)
}

export async function notifyForPushes(pushes: Push[]): Promise<void> {
  for (const push of pushes) await notifyForPush(push)
}

export async function notifyForPush(push: Push): Promise<void> {
  if (!push.iden || push.direction === 'self' || push.dismissed || !chrome.notifications) return
  const state = await readState()
  if (!state.user || (push.type === 'mirror' && state.settings.showMirrors === false)) return
  if (state.device?.iden && (push.sourceDeviceIden === state.device.iden || (push.targetDeviceIden && push.targetDeviceIden !== state.device.iden))) return
  if (state.settings.snoozedUntil > Date.now()) return
  const chatEmail = push.senderEmailNormalized || push.receiverEmailNormalized
  if (push.type !== 'mirror' && chatEmail && await isChatActive(`push:${chatEmail}`)) return

  const key = notificationKey(push)
  if (state.notifications[key]) return
  const mirror = mirrorMessage(push.mirror)
  const url = safeHttpUrl(push.url)
  const titleOnly = state.settings.onlyShowTitles
  const record: NotificationRecord = {
    key,
    title: push.type === 'mirror' ? mirror.title : push.title || 'Pushbullet',
    message: titleOnly
      ? (push.type === 'mirror' ? mirror.title : push.title || 'New push')
      : (push.type === 'mirror' ? mirror.message : push.body || push.url || push.fileName || 'New push'),
    pushIden: push.type === 'mirror' ? undefined : push.iden,
    chatEmail: push.type === 'mirror' ? undefined : chatEmail,
    url: url || undefined,
    mirror: push.mirror,
    actionId: url ? `open_${push.iden}` : `dismiss_${push.iden}`,
    buttons: [
      ...(url ? [{ title: 'Open', actionId: `open_${push.iden}` }] : []),
      { title: 'Dismiss', actionId: `dismiss_${key}` }
    ],
    createdAt: Date.now()
  }
  const next = await updateState((current) => ({
    ...current,
    notifications: { ...current.notifications, [key]: record }
  }))
  await createNativeNotification(key, record)
  await updateBadge(next)
  await broadcastState(next)
  if (state.settings.playSound !== false) await playAlertSound()
  if (state.settings.notificationDuration > 0) {
    await chrome.alarms?.create(notificationAlarmName(key), {
      delayInMinutes: state.settings.notificationDuration / 60
    })
  }

  if (state.settings.openMyLinksAutomatically && push.type === 'link' && url) {
    await chrome.tabs.create({ url, active: false })
  }
}

export async function refreshNotificationBadge(): Promise<void> {
  await updateBadge(await readState())
}

export async function clearNativeNotifications(keys: string[]): Promise<void> {
  await Promise.all(keys.map(async (key) => {
    await clearNativeNotification(key)
    if (chrome.alarms) await chrome.alarms.clear(notificationAlarmName(key))
  }))
}

export async function handleNotificationAlarm(name: string): Promise<void> {
  const key = notificationKeyFromAlarm(name)
  if (key) await clearNotification(key)
}

export async function handleNotificationClick(key: string): Promise<void> {
  const state = await readState()
  const record = state.notifications[key]
  if (!record) return
  const url = safeHttpUrl(record.url)
  if (url) await chrome.tabs.create({ url, active: true })
  else if (record.chatEmail) await chrome.windows.create({ url: chatUrl(record.chatEmail), type: 'popup', width: 630, height: 520 })
  await removeNotification(key, true)
}

export async function handleNotificationButton(key: string, index: number): Promise<void> {
  const state = await readState()
  const record = state.notifications[key]
  const button = record?.buttons?.[index]
  if (!record || !button) return

  if (button.actionId.startsWith('open_')) {
    const url = safeHttpUrl(record.url)
    if (url) await chrome.tabs.create({ url, active: true })
  } else if (button.actionId.startsWith('chat_') && record.chatEmail) {
    await chrome.windows.create({ url: chatUrl(record.chatEmail), type: 'popup', width: 630, height: 520 })
  } else {
    await dismissNotification(key)
    return
  }
  await removeNotification(key, true)
}

export async function handleNotificationClosed(key: string): Promise<void> {
  await removeNotification(key, false)
}

export async function clearNotification(key: string): Promise<void> {
  await removeNotification(key, true)
}

export function registerNotificationListeners(): void {
  if (!chrome.notifications) return
  chrome.notifications.onClicked.addListener((key) => {
    void handleNotificationClick(key).catch((error) => console.warn('Notification click failed:', error))
  })
  chrome.notifications.onButtonClicked.addListener((key, index) => {
    void handleNotificationButton(key, index).catch((error) => console.warn('Notification action failed:', error))
  })
  chrome.notifications.onClosed.addListener((key) => {
    void handleNotificationClosed(key).catch((error) => console.warn('Notification close failed:', error))
  })
}
