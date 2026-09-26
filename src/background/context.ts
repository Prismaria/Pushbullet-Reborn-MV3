import { dismissNotification } from './notifications'
import { sendPush } from './pushes'
import { readState } from './state'

let contextEventsRegistered = false
const CONTEXT_FEEDBACK_ICON = 'icon_48.png'

async function showContextFeedback(message: string): Promise<void> {
  if (!chrome.notifications) return
  await new Promise<void>((resolve) => {
    chrome.notifications.create(`context_${Date.now()}`, {
      type: 'basic',
      title: 'Pushbullet',
      message,
      iconUrl: chrome.runtime.getURL(CONTEXT_FEEDBACK_ICON)
    }, () => {
      void chrome.runtime.lastError
      resolve()
    })
  })
}

function hasContextMenuPermission(): Promise<boolean> {
  if (!chrome.permissions) return Promise.resolve(false)
  return new Promise((resolve) => chrome.permissions.contains({ permissions: ['contextMenus'] }, resolve))
}

function removeAllContextMenus(): Promise<void> {
  if (!chrome.contextMenus) return Promise.resolve()
  return new Promise((resolve) => chrome.contextMenus.removeAll(resolve))
}

function menuTargetId(prefix: string, value: string): string {
  return `${prefix}${encodeURIComponent(value)}`
}

function readMenuTarget(id: string, prefix: string): string | null {
  return id.startsWith(prefix) ? decodeURIComponent(id.slice(prefix.length)) : null
}

export async function setupContextMenus(): Promise<void> {
  if (!chrome.contextMenus || !(await hasContextMenuPermission())) return
  await removeAllContextMenus()
  const state = await readState()
  if (!state.user || state.settings.showContextMenu === false) return

  chrome.contextMenus.create({ id: 'pushbullet-page', title: 'Push this page', contexts: ['page'] })
  chrome.contextMenus.create({ id: 'pushbullet-selection', title: 'Push selected text', contexts: ['selection'] })
  chrome.contextMenus.create({ id: 'pushbullet-link', title: 'Push this link', contexts: ['link'] })

  for (const device of Object.values(state.devices)) {
    if (device.active === false || device.pushable === false) continue
    chrome.contextMenus.create({
      id: menuTargetId('pushbullet-device-', device.iden),
      parentId: 'pushbullet-page',
      title: device.nickname || device.model || device.iden,
      contexts: ['page']
    })
  }
  for (const chat of Object.values(state.chats)) {
    const email = chat.with?.emailNormalized
    if (!email || chat.active === false) continue
    chrome.contextMenus.create({
      id: menuTargetId('pushbullet-person-', email),
      parentId: 'pushbullet-page',
      title: chat.with?.name || email,
      contexts: ['page']
    })
  }
}

async function handleContextMenu(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  const deviceIden = readMenuTarget(String(info.menuItemId), 'pushbullet-device-')
  const email = readMenuTarget(String(info.menuItemId), 'pushbullet-person-')
  if (info.menuItemId === 'pushbullet-selection') {
    await sendPush({ type: 'note', body: info.selectionText || '' })
    await showContextFeedback('Selected text sent.')
    return
  }
  if (info.menuItemId === 'pushbullet-link') {
    await sendPush({ type: 'link', url: info.linkUrl || '', title: tab?.title })
    await showContextFeedback('Link sent.')
    return
  }
  if (info.menuItemId === 'pushbullet-page' || deviceIden || email) {
    await sendPush({ type: 'link', url: tab?.url || '', title: tab?.title, deviceIden: deviceIden || undefined, email: email || undefined })
    await showContextFeedback('Page sent.')
  }
}

export function registerContextMenuEvents(): void {
  if (contextEventsRegistered || !chrome.contextMenus) return
  contextEventsRegistered = true
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleContextMenu(info, tab).catch((error) => console.error('Context-menu push failed:', error))
  })
}

export async function handleCommand(command: string, tab?: chrome.tabs.Tab): Promise<void> {
  if (command === 'dismiss-most-recent-notification') {
    const state = await readState()
    const latest = Object.values(state.notifications).sort((first, second) => second.createdAt - first.createdAt)[0]
    if (latest) await dismissNotification(latest.key)
    return
  }
  if (command === 'instant-push-current-tab') {
    const state = await readState()
    if (!state.settings.allowInstantPush) return
    await sendPush({ type: 'link', url: tab?.url || '', title: tab?.title, deviceIden: state.settings.instantPushIden === '*' ? undefined : state.settings.instantPushIden })
    return
  }
  if (command === 'pop-out-panel') {
    const popupPath = chrome.runtime.getManifest().action?.default_popup || 'popup.html'
    await chrome.windows.create({ url: chrome.runtime.getURL(popupPath), type: 'popup', width: 660, height: 700 })
  }
}
