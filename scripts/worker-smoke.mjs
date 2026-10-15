import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const storage = {}
const sessionStorage = {}
const alarms = new Set()
const fetchCalls = []
const nativeNotifications = new Map()
const openedTabs = []
const openedWindows = []
const COOKIE_API_KEY = 'cookie-smoke-token'
let messageListener
let connectListener
let alarmListener
let notificationButtonListener
let commandListener
let contextMenuClickListener
let idleStateListener
let lastSocket
let pushNumber = 1
let remotePushes = []
let badgeText = ''
let badgeColor = ''
let actionIconPath
const contextMenuItems = []

const event = () => ({ addListener(listener) { return listener } })

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (!keys) return { ...storage }
        const names = Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(names.filter((key) => key in storage).map((key) => [key, storage[key]]))
      },
      async set(values) {
        Object.assign(storage, values)
      },
      async remove(keys) {
        for (const key of (Array.isArray(keys) ? keys : [keys])) delete storage[key]
      }
    },
    sync: {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(names.filter((key) => key in storage).map((key) => [key, storage[key]]))
      },
      async remove(keys) {
        for (const key of (Array.isArray(keys) ? keys : [keys])) delete storage[key]
      }
    },
    session: {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(names.filter((key) => key in sessionStorage).map((key) => [key, sessionStorage[key]]))
      },
      async set(values) {
        Object.assign(sessionStorage, values)
      }
    }
  },
  runtime: {
    onInstalled: event(),
    onMessage: { addListener(listener) { messageListener = listener } },
    onConnect: { addListener(listener) { connectListener = listener } },
    sendMessage(_message, callback) { if (callback) callback() },
    getURL: (path) => `chrome-extension://smoke/${path}`,
    getManifest: () => ({ version: outputDirectory.startsWith('dist-classic') ? '367' : '0.1.1', action: { default_popup: outputDirectory.startsWith('dist-classic') ? 'classic-pages/panel.html' : 'popup.html' } }),
    getContexts: async () => [],
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
    lastError: undefined
  },
  alarms: {
    onAlarm: { addListener(listener) { alarmListener = listener } },
    create(name) { alarms.add(name) },
    clear(name) { alarms.delete(name) }
  },
  idle: { onStateChanged: { addListener(listener) { idleStateListener = listener } } },
  commands: { onCommand: { addListener(listener) { commandListener = listener } } },
  permissions: { contains(details, callback) { callback(details.permissions?.includes('contextMenus') === true) } },
  contextMenus: {
    onClicked: { addListener(listener) { contextMenuClickListener = listener } },
    create(item) { contextMenuItems.push(item); return item.id },
    removeAll(callback) { contextMenuItems.length = 0; callback?.() }
  },
  windows: { create: async (window) => { openedWindows.push(window); return window } },
  notifications: {
    onClicked: event(),
    onButtonClicked: { addListener(listener) { notificationButtonListener = listener } },
    onClosed: event(),
    create(key, options, callback) { nativeNotifications.set(key, options); callback?.(key) },
    clear(key, callback) { nativeNotifications.delete(key); callback?.(true) }
  },
  action: {
    setBadgeText: async ({ text }) => { badgeText = text },
    setBadgeBackgroundColor: async ({ color }) => { badgeColor = color },
    setIcon: async ({ path }) => { actionIconPath = path }
  },
  offscreen: { Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' }, createDocument: async () => undefined },
  tabs: { create: async (tab) => { openedTabs.push(tab); return tab } },
  cookies: { get: async ({ url, name }) => url === 'https://www.pushbullet.com/' && name === 'api_key' ? { value: COOKIE_API_KEY } : null }
}

globalThis.WebSocket = class MockWebSocket {
  static OPEN = 1
  readyState = 0
  onopen
  onclose
  onerror
  onmessage

  constructor(url) {
    this.url = url
    lastSocket = this
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.()
    })
  }

  send() {}

  close() {
    this.readyState = 3
    this.onclose?.()
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

globalThis.fetch = async (url, init = {}) => {
  const parsed = new URL(url)
  const method = init.method || 'GET'
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
  const headers = new Headers(init.headers)
  fetchCalls.push({
    path: `${parsed.pathname}${parsed.search}`,
    method,
    body,
    userAgent: headers.get('X-User-Agent'),
    hasAccessTokenHeader: headers.has('Access-Token'),
    hasBearerAuthorization: headers.get('Authorization')?.startsWith('Bearer ') === true,
    usesCookieApiKey: headers.get('Authorization') === `Bearer ${COOKIE_API_KEY}`
  })

  if (parsed.pathname === '/v2/users/me') return jsonResponse({ iden: 'user-1', email: 'me@example.com', name: 'Smoke User', pro: true, max_upload_size: 1024 * 1024 * 1024 })
  if (parsed.pathname === '/v2/devices' && method === 'GET') return jsonResponse({ devices: [{ iden: 'phone-1', nickname: 'Phone', type: 'android', active: true, has_sms: true }] })
  if (parsed.pathname === '/v2/devices' && method === 'POST') return jsonResponse({ iden: 'chrome-1', nickname: 'Chrome', type: 'chrome', active: true })
  if (parsed.pathname === '/v2/chats') return jsonResponse({ chats: [{ iden: 'chat-1', active: true, with: { email: 'friend@example.com', email_normalized: 'friend@example.com', name: 'Friend' } }] })
  if (parsed.pathname === '/v2/subscriptions') return jsonResponse({ subscriptions: [{ iden: 'subscription-1', active: true, channel: { iden: 'channel-1', tag: 'updates', name: 'Updates' } }] })
  if (parsed.pathname === '/v2/pushes' && method === 'GET') {
    const cursor = parsed.searchParams.get('cursor')
    if (cursor === 'older-page-1') return jsonResponse({ pushes: [{ iden: 'older-push-1', direction: 'self', created: 10, body: 'Earlier push' }], cursor: 'older-page-2' })
    if (cursor === 'older-page-2') return jsonResponse({ pushes: [{ iden: 'older-push-2', direction: 'self', created: 5, body: 'Oldest push' }] })
    return jsonResponse({ pushes: remotePushes, cursor: 'older-page-1' })
  }
  if (parsed.pathname === '/v2/pushes' && method === 'POST') {
    return jsonResponse({ iden: `push-${pushNumber++}`, ...body, created: 100, modified: 100, target_device_iden: body.device_iden })
  }
  if (parsed.pathname === '/v2/upload-request' && method === 'POST') {
    return jsonResponse({ upload_url: 'https://upload.pushbullet.com/session-1', data: { token: 'upload-token' }, file_name: 'smoke.bin', file_type: 'application/octet-stream', file_url: 'https://cdn.pushbullet.com/smoke.bin' })
  }
  if (parsed.pathname === '/v3/start-upload' && method === 'POST') {
    return jsonResponse({ id: 'large-session', piece_size: 16 * 1024 * 1024, piece_urls: ['https://upload.pushbullet.com/piece-1', 'https://upload.pushbullet.com/piece-2', 'https://upload.pushbullet.com/piece-3'] })
  }
  if (parsed.pathname === '/v3/finish-upload' && method === 'POST') {
    if (body.id !== 'large-session') throw new Error('Chunked upload finish session smoke test failed.')
    return jsonResponse({ file_name: 'large.mp4', file_type: 'video/mp4', file_url: 'https://cdn.pushbullet.com/large.mp4' })
  }
  if (parsed.hostname === 'upload.pushbullet.com' && method === 'POST') return jsonResponse({})
  if (parsed.pathname === '/v3/get-permanent' && method === 'POST') {
    if (body.key === 'phone-1_threads') return jsonResponse({ data: { threads: [{ id: 'thread-1', recipients: [{ address: '+15550001', name: 'Friend' }] }] } })
    if (body.key === 'phone-1_thread_thread-1') return jsonResponse({ data: { thread: [{ iden: 'text-old', body: 'Earlier', direction: 'incoming', timestamp: 10 }] } })
    if (body.key === 'phonebook_phone-1') return jsonResponse({ data: { contacts: [] } })
  }
  if (parsed.pathname === '/v3/create-text' && method === 'POST') return jsonResponse({ data: { iden: 'text-new', body: body.data.message, direction: 'outgoing', guid: body.data.guid } })
  if (parsed.pathname === '/v2/ephemerals' && method === 'POST') return jsonResponse({})
  throw new Error(`Unexpected mocked request: ${method} ${parsed.pathname}${parsed.search}`)
}

const outputDirectory = process.argv[2] || 'dist-reborn'
const isClassicBuild = outputDirectory.startsWith('dist-classic')
await import(pathToFileURL(resolve(process.cwd(), outputDirectory, 'background.js')).href)
await new Promise((resolve) => setTimeout(resolve, 0))

function dispatch(message) {
  return new Promise((resolve) => messageListener(message, {}, resolve))
}

const authenticated = await dispatch({ type: 'set_token', token: 'smoke-token' })
if (!authenticated.ok || authenticated.state.user?.email !== 'me@example.com' || authenticated.state.user?.maxUploadSize !== 1024 * 1024 * 1024) throw new Error('Authentication smoke test failed.')
if (!contextMenuClickListener) throw new Error('Context-menu click listener was not registered.')
const linkMenu = contextMenuItems.find((item) => item.id === 'pushbullet-link')
const phoneLinkMenu = contextMenuItems.find((item) => item.id === 'pushbullet-link-device-phone-1')
if (!linkMenu || !phoneLinkMenu || phoneLinkMenu.parentId !== 'pushbullet-link' || !phoneLinkMenu.contexts.includes('link')) throw new Error('Push-link device submenu smoke test failed.')
const uploadAuth = await dispatch({ type: 'get_large_upload_auth' })
if (!uploadAuth.ok || !uploadAuth.available) throw new Error('Large upload cookie-auth status smoke test failed.')
if (!authenticated.state.device || Object.keys(authenticated.state.chats).length !== 1) throw new Error('Remote state smoke test failed.')
await new Promise((resolve) => setTimeout(resolve, 5))
await commandListener('pop-out-panel')
const expectedPanel = isClassicBuild ? 'classic-pages/panel.html' : 'popup.html'
if (!openedWindows.some((window) => window.url === `chrome-extension://smoke/${expectedPanel}`)) throw new Error('Pop-out route smoke test failed.')

const smsThreads = await dispatch({ type: 'get_sms_threads', deviceIden: 'phone-1' })
if (!smsThreads.ok || smsThreads.threads.length !== 1) throw new Error('SMS thread list smoke test failed.')
const smsThread = await dispatch({ type: 'get_sms_thread', deviceIden: 'phone-1', threadId: 'thread-1' })
if (!smsThread.ok || smsThread.messages.length !== 1) throw new Error('SMS thread smoke test failed.')
const phonebook = await dispatch({ type: 'get_phonebook', deviceIden: 'phone-1' })
if (!phonebook.ok) throw new Error('Phonebook smoke test failed.')
const sentSms = await dispatch({ type: 'send_sms', sms: { deviceIden: 'phone-1', addresses: ['+15550001'], body: 'Hello by SMS' } })
if (!sentSms.ok || Object.keys(sentSms.state.texts).length !== 1) throw new Error('SMS send smoke test failed.')
const storedSms = Object.values(sentSms.state.texts)[0]
if (storedSms?.target_device_iden !== 'phone-1' || storedSms?.addresses?.[0] !== '+15550001') throw new Error('SMS local-state smoke test failed.')

await dispatch({ type: 'set_active_chat', key: 'push:friend@example.com' })
await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'note', iden: 'active-chat-1', body: 'Visible in chat', sender_email_normalized: 'friend@example.com', direction: 'incoming' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
if (nativeNotifications.has('push_active-chat-1')) throw new Error('Active chat notification suppression smoke test failed.')
await dispatch({ type: 'clear_active_chat', key: 'push:friend@example.com' })

const testMirrorIcon = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const firstMirrorKey = 'mirror_com.example.messages_null_42_'
await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'mirror', iden: 'mirror-1', application_name: 'Messages', title: 'New message', body: 'Hello', package_name: 'com.example.messages', notification_id: '42', source_user_iden: 'user-1', source_device_iden: 'phone-1', icon: testMirrorIcon } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
if (!nativeNotifications.has(firstMirrorKey)) throw new Error(`Mirror notification smoke test failed. Active native keys: ${[...nativeNotifications.keys()].join(', ')}`)
if (nativeNotifications.get(firstMirrorKey)?.iconUrl !== `data:image/png;base64,${testMirrorIcon}`) throw new Error('Mirror app icon smoke test failed.')
if (!notificationButtonListener) throw new Error('Notification action listener was not registered.')
await notificationButtonListener(firstMirrorKey, 0)
await new Promise((resolve) => setTimeout(resolve, 5))
if (!nativeNotifications.has(firstMirrorKey) || nativeNotifications.get(firstMirrorKey)?.title !== 'Muted Messages') throw new Error('Mirror mute confirmation smoke test failed.')
if (!fetchCalls.some((call) => call.path === '/v2/ephemerals' && call.method === 'POST' && call.body.push?.type === 'mute' && call.body.push?.package_name === 'com.example.messages')) throw new Error('Mirror mute request smoke test failed.')
await notificationButtonListener(firstMirrorKey, 0)
await new Promise((resolve) => setTimeout(resolve, 5))
if (nativeNotifications.has(firstMirrorKey) || !fetchCalls.some((call) => call.path === '/v2/ephemerals' && call.method === 'POST' && call.body.push?.type === 'unmute')) throw new Error('Mirror unmute smoke test failed.')

await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'mirror', iden: 'mirror-2', application_name: 'Messages', title: 'Another message', body: 'Dismiss me', package_name: 'com.example.messages', notification_id: '43', source_user_iden: 'user-1', source_device_iden: 'phone-1', icon: testMirrorIcon } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
const secondMirrorKey = 'mirror_com.example.messages_null_43_'
await notificationButtonListener(secondMirrorKey, 1)
await new Promise((resolve) => setTimeout(resolve, 5))
const mirrorDismissCall = fetchCalls.find((call) => call.path === '/v2/ephemerals' && call.method === 'POST' && call.body.push?.type === 'dismissal' && call.body.push?.notification_id === '43')
if (nativeNotifications.has(secondMirrorKey) || !mirrorDismissCall) throw new Error('Mirror dismissal smoke test failed.')
if (JSON.stringify(mirrorDismissCall.body.push) !== JSON.stringify({ type: 'dismissal', source_user_iden: 'user-1', package_name: 'com.example.messages', notification_id: '43' })) throw new Error('Mirror dismissal protocol payload smoke test failed.')

const thirdMirrorKey = 'mirror_com.example.messages_null_44_'
await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'mirror', iden: 'mirror-3', application_name: 'Messages', title: 'Dismiss remotely', package_name: 'com.example.messages', notification_id: '44', source_user_iden: 'user-1', source_device_iden: 'phone-1' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
if (!nativeNotifications.has(thirdMirrorKey)) throw new Error('Remote mirror dismissal setup smoke test failed.')
await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'dismissal', iden: 'unrelated-dismissal-iden', package_name: 'com.example.messages', notification_id: '44' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
if (nativeNotifications.has(thirdMirrorKey)) throw new Error('Remote mirror dismissal identity smoke test failed.')
if (openedTabs.length) throw new Error('Mirror smoke test opened an unexpected tab.')

await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'mirror', iden: 'mirror-self', application_name: 'Messages', title: 'Self mirror', source_device_iden: 'chrome-1' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
if (nativeNotifications.has('mirror_mirror_self_null_notification_')) throw new Error('Self mirror filtering smoke test failed.')

await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'link', iden: 'link-1', title: 'Example', url: 'https://example.com', direction: 'incoming' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
if (!nativeNotifications.has('push_link-1') || !openedTabs.some((tab) => tab.url === 'https://example.com/')) throw new Error('Link notification smoke test failed.')
if (badgeText !== '1') throw new Error('Notification badge smoke test failed.')
await notificationButtonListener('push_link-1', 0)
await new Promise((resolve) => setTimeout(resolve, 5))
if (nativeNotifications.has('push_link-1')) throw new Error('Link notification action smoke test failed.')

await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'note', iden: 'clear-all-1', title: 'Clear one', direction: 'incoming' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'note', iden: 'clear-all-2', title: 'Clear two', direction: 'incoming' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'mirror', iden: 'clear-all-mirror', application_name: 'Messages', title: 'Clear mirrored device alert', package_name: 'com.example.messages', notification_id: '50', source_user_iden: 'user-1', source_device_iden: 'phone-1' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
const clearAllMirrorKey = 'mirror_com.example.messages_null_50_'
if (!nativeNotifications.has('push_clear-all-1') || !nativeNotifications.has('push_clear-all-2') || !nativeNotifications.has(clearAllMirrorKey)) throw new Error('Clear-all setup smoke test failed.')
const dismissalCallsBeforeClearAll = fetchCalls.filter((call) => call.path === '/v2/ephemerals' && call.body.push?.type === 'dismissal').length
const clearedAll = await dispatch({ type: 'clear_all_notifications' })
if (!clearedAll.ok || Object.keys(clearedAll.state.notifications).length || nativeNotifications.has('push_clear-all-1') || nativeNotifications.has('push_clear-all-2') || nativeNotifications.has(clearAllMirrorKey)) throw new Error('Clear-all notification smoke test failed.')
const clearAllDismissCalls = fetchCalls.filter((call) => call.path === '/v2/ephemerals' && call.body.push?.type === 'dismissal')
if (clearAllDismissCalls.length !== dismissalCallsBeforeClearAll + 1 || clearAllDismissCalls.at(-1)?.body.push?.notification_id !== '50') throw new Error('Clear-all device dismissal smoke test failed.')

const disabledDeviceDismissals = await dispatch({ type: 'save_settings', settings: { dismissMirrorsOnClearAll: false } })
if (!disabledDeviceDismissals.ok || disabledDeviceDismissals.state.settings.dismissMirrorsOnClearAll) throw new Error('Clear-all device dismissal setting smoke test failed.')
await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'mirror', iden: 'clear-all-mirror-disabled', application_name: 'Messages', title: 'Keep on device', package_name: 'com.example.messages', notification_id: '51', source_user_iden: 'user-1', source_device_iden: 'phone-1' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
const ephemeralCallsBeforeDisabledClear = fetchCalls.filter((call) => call.path === '/v2/ephemerals').length
const clearedWithoutDeviceDismissal = await dispatch({ type: 'clear_all_notifications' })
if (!clearedWithoutDeviceDismissal.ok || fetchCalls.filter((call) => call.path === '/v2/ephemerals').length !== ephemeralCallsBeforeDisabledClear) throw new Error('Disabled clear-all device dismissal smoke test failed.')

await import(`${pathToFileURL(resolve(process.cwd(), outputDirectory, 'background.js')).href}?restart=${Date.now()}`)
await new Promise((resolve) => setTimeout(resolve, 5))
const restarted = await dispatch({ type: 'get_state' })
if (!restarted.ok || restarted.state.user?.email !== 'me@example.com' || !restarted.state.device) throw new Error('Worker restart persistence smoke test failed.')

const notificationSettings = await dispatch({ type: 'save_settings', settings: { onlyShowTitles: true, showNotificationCount: false, notificationDuration: 30, useDarkIcon: true } })
if (!notificationSettings.ok) throw new Error('Notification settings smoke test failed.')
const greenBadgeSetting = await dispatch({ type: 'save_settings', settings: { useGreenNotificationBadge: true } })
if (!greenBadgeSetting.ok || badgeColor !== '#7edc99') throw new Error('Green notification badge setting smoke test failed.')
const redBadgeSetting = await dispatch({ type: 'save_settings', settings: { useGreenNotificationBadge: false } })
if (!redBadgeSetting.ok || badgeColor !== '#e85845') throw new Error('Classic red notification badge setting smoke test failed.')
await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'note', iden: 'title-only-1', title: 'Title only', body: 'Hidden preview', direction: 'incoming' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
if (nativeNotifications.get('push_title-only-1')?.message !== 'Title only' || badgeText !== '' || !alarms.has('pb-notification-push_title-only-1') || actionIconPath?.[19] !== 'icon_19_gray.png') throw new Error('Notification preference smoke test failed.')
await alarmListener({ name: 'pb-notification-push_title-only-1' })
await new Promise((resolve) => setTimeout(resolve, 5))
if (nativeNotifications.has('push_title-only-1') || alarms.has('pb-notification-push_title-only-1')) throw new Error('Notification expiry smoke test failed.')

class MockPort {
  name = 'upload'
  outbound = []
  messageListener
  disconnectListener
  onMessage = { addListener: (listener) => { this.messageListener = listener } }
  onDisconnect = { addListener: (listener) => { this.disconnectListener = listener } }
  postMessage(message) { this.outbound.push(message) }
  sendFromClient(message) { this.messageListener?.(message) }
  disconnect() { this.disconnectListener?.() }
}

const uploadPort = new MockPort()
connectListener(uploadPort)
uploadPort.sendFromClient({ type: 'start', fileName: 'smoke.bin', mimeType: 'application/octet-stream', size: 4, target: { deviceIden: 'phone-1' } })
uploadPort.sendFromClient({ type: 'chunk', data: 'AQIDBA==', size: 4 })
uploadPort.sendFromClient({ type: 'complete' })
await new Promise((resolve) => setTimeout(resolve, 10))
if (!uploadPort.outbound.some((message) => message.type === 'complete')) throw new Error('File upload smoke test failed.')
if (!fetchCalls.some((call) => call.path === '/v2/upload-request' && call.method === 'POST') || !fetchCalls.some((call) => call.path === '/session-1' && call.method === 'POST')) throw new Error('Signed upload request smoke test failed.')
const uploadedFilePush = fetchCalls.find((call) => call.path === '/v2/pushes' && call.method === 'POST' && call.body.type === 'file')
if (uploadedFilePush?.body.source_device_iden !== 'chrome-1' || uploadedFilePush?.body.device_iden !== 'phone-1') throw new Error('File push source and target routing smoke test failed.')

const largeUploadSize = 40 * 1024 * 1024 + 1
const largeUploadPort = new MockPort()
connectListener(largeUploadPort)
largeUploadPort.sendFromClient({ type: 'start', fileName: 'large.mp4', mimeType: 'video/mp4', size: largeUploadSize, target: { deviceIden: 'phone-1' } })
for (let offset = 0; offset < largeUploadSize; offset += 256 * 1024) {
  const size = Math.min(256 * 1024, largeUploadSize - offset)
  largeUploadPort.sendFromClient({ type: 'chunk', data: Buffer.alloc(size).toString('base64'), size })
}
largeUploadPort.sendFromClient({ type: 'complete' })
for (let attempt = 0; attempt < 200 && !largeUploadPort.outbound.some((message) => message.type === 'complete'); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10))
}
if (!largeUploadPort.outbound.some((message) => message.type === 'complete')) throw new Error('Large-file upload smoke test failed.')
const largeUploadStart = fetchCalls.find((call) => call.path === '/v3/start-upload' && call.method === 'POST')
const largeUploadFinish = fetchCalls.find((call) => call.path === '/v3/finish-upload' && call.method === 'POST')
const largeUploadPieces = fetchCalls.filter((call) => /^\/piece-\d+$/.test(call.path))
if (largeUploadStart?.body.name !== 'large.mp4' || largeUploadStart?.body.size !== largeUploadSize || !largeUploadFinish || largeUploadPieces.length !== 3) throw new Error('Chunked upload protocol smoke test failed.')
if (largeUploadStart.userAgent !== 'Pushbullet Chrome 366' || largeUploadStart.hasAccessTokenHeader || !largeUploadStart.hasBearerAuthorization) throw new Error('Legacy upload authorization headers smoke test failed.')
if (!largeUploadStart.usesCookieApiKey || !largeUploadFinish.usesCookieApiKey) throw new Error('Cookie-derived legacy upload authentication smoke test failed.')
if (largeUploadPieces.reduce((total, call) => total + (call.body instanceof Blob ? call.body.size : 0), 0) !== largeUploadSize) throw new Error('Chunked upload byte coverage smoke test failed.')

const smsUploadPort = new MockPort()
connectListener(smsUploadPort)
smsUploadPort.sendFromClient({ type: 'start', fileName: 'mms.bin', mimeType: 'application/octet-stream', size: 2, delivery: 'sms', target: {}, sms: { deviceIden: 'phone-1', addresses: ['+15550001'], body: 'MMS' } })
smsUploadPort.sendFromClient({ type: 'chunk', data: 'BQY=', size: 2 })
smsUploadPort.sendFromClient({ type: 'complete' })
await new Promise((resolve) => setTimeout(resolve, 10))
if (!smsUploadPort.outbound.some((message) => message.type === 'complete' && message.sms)) throw new Error('SMS attachment upload smoke test failed.')

const note = await dispatch({ type: 'send_push', push: { type: 'note', body: 'Hello from smoke test', deviceIden: 'phone-1' } })
if (!note.ok || Object.keys(note.state.pushes).length !== 3) throw new Error('Note push smoke test failed.')
const targetedNoteRequest = fetchCalls.find((call) => call.path === '/v2/pushes' && call.method === 'POST' && call.body.body === 'Hello from smoke test')
if (targetedNoteRequest?.body.device_iden !== 'phone-1' || targetedNoteRequest?.body.source_device_iden !== 'chrome-1') throw new Error('Targeted push routing smoke test failed.')

const link = await dispatch({ type: 'send_push', push: { type: 'link', title: 'Example', url: 'https://example.com', deviceIden: 'phone-1' } })
if (!link.ok || Object.keys(link.state.pushes).length !== 4) throw new Error('Link push smoke test failed.')
contextMenuClickListener({ menuItemId: 'pushbullet-link-device-phone-1', linkUrl: 'https://context.example.com/article' }, { title: 'Context link' })
await new Promise((resolve) => setTimeout(resolve, 10))
const contextLinkRequest = fetchCalls.find((call) => call.path === '/v2/pushes' && call.method === 'POST' && call.body.url === 'https://context.example.com/article')
if (contextLinkRequest?.body.device_iden !== 'phone-1' || contextLinkRequest?.body.title !== 'Context link') throw new Error('Push-link device target smoke test failed.')
const contextFeedbackKey = [...nativeNotifications.keys()].find((key) => key.startsWith('context_'))
if (!contextFeedbackKey) throw new Error('Context-menu confirmation smoke test failed.')
nativeNotifications.delete(contextFeedbackKey)

const olderPageOne = await dispatch({ type: 'load_more_push_history' })
if (!olderPageOne.ok || olderPageOne.state.pushes['older-push-1']?.body !== 'Earlier push' || olderPageOne.state.pushHistoryCursor !== 'older-page-2') throw new Error('First push history page smoke test failed.')
const olderPageTwo = await dispatch({ type: 'load_more_push_history' })
if (!olderPageTwo.ok || olderPageTwo.state.pushes['older-push-2']?.body !== 'Oldest push' || olderPageTwo.state.pushHistoryCursor !== null) throw new Error('Final push history page smoke test failed.')
const historyRequestCount = fetchCalls.filter((call) => call.path.startsWith('/v2/pushes?active=true&limit=100&cursor=')).length
await dispatch({ type: 'load_more_push_history' })
if (fetchCalls.filter((call) => call.path.startsWith('/v2/pushes?active=true&limit=100&cursor=')).length !== historyRequestCount) throw new Error('Exhausted push history made an extra API request.')

const originalConsoleError = console.error
console.error = () => undefined
const invalidUrl = await dispatch({ type: 'send_push', push: { type: 'link', url: 'javascript:alert(1)', deviceIden: 'phone-1' } })
console.error = originalConsoleError
if (invalidUrl.ok || !invalidUrl.error.includes('HTTP')) throw new Error('URL validation smoke test failed.')

if (!alarms.has('pb-refresh') || !alarms.has('pb-heartbeat')) throw new Error('Alarm registration smoke test failed.')
if (!fetchCalls.some((call) => call.path === '/v2/pushes' && call.method === 'POST' && call.body.type === 'link')) throw new Error('Push request smoke test failed.')

remotePushes = [{ iden: 'sleep-pending-1', type: 'note', title: 'Pending while asleep', body: 'Startup recovery', direction: 'incoming', created: 500 }]
await import(`${pathToFileURL(resolve(process.cwd(), outputDirectory, 'background.js')).href}?wake-startup=${Date.now()}`)
await new Promise((resolve) => setTimeout(resolve, 20))
if (!nativeNotifications.has('push_sleep-pending-1')) throw new Error('Pending push recovery on worker startup smoke test failed.')

remotePushes = [...remotePushes, { iden: 'sleep-pending-2', type: 'note', title: 'Pending on wake', body: 'Idle recovery', direction: 'incoming', created: 501 }]
idleStateListener?.('active')
await new Promise((resolve) => setTimeout(resolve, 20))
if (!nativeNotifications.has('push_sleep-pending-2')) throw new Error('Pending push recovery on wake smoke test failed.')

const signedOut = await dispatch({ type: 'sign_out' })
if (!signedOut.ok || signedOut.state.user !== null || storage.apiKey || nativeNotifications.size || alarms.has('pb-notification-push_title-only-1')) throw new Error('Sign-out smoke test failed.')

console.log('Worker smoke test passed.')
