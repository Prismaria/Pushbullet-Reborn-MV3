import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const storage = {}
const sessionStorage = {}
const alarms = new Set()
const fetchCalls = []
const nativeNotifications = new Map()
const openedTabs = []
const openedWindows = []
let messageListener
let connectListener
let alarmListener
let notificationButtonListener
let commandListener
let lastSocket
let pushNumber = 1
let badgeText = ''
let actionIconPath

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
    getManifest: () => ({ action: { default_popup: outputDirectory === 'dist-classic' ? 'classic-pages/panel.html' : 'popup.html' } }),
    getContexts: async () => [],
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
    lastError: undefined
  },
  alarms: {
    onAlarm: { addListener(listener) { alarmListener = listener } },
    create(name) { alarms.add(name) },
    clear(name) { alarms.delete(name) }
  },
  idle: { onStateChanged: event() },
  commands: { onCommand: { addListener(listener) { commandListener = listener } } },
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
    setBadgeBackgroundColor: async () => undefined,
    setIcon: async ({ path }) => { actionIconPath = path }
  },
  offscreen: { Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' }, createDocument: async () => undefined },
  tabs: { create: async (tab) => { openedTabs.push(tab); return tab } }
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
  fetchCalls.push({ path: `${parsed.pathname}${parsed.search}`, method, body })

  if (parsed.pathname === '/v2/users/me') return jsonResponse({ iden: 'user-1', email: 'me@example.com', name: 'Smoke User' })
  if (parsed.pathname === '/v2/devices' && method === 'GET') return jsonResponse({ devices: [{ iden: 'phone-1', nickname: 'Phone', type: 'android', active: true, has_sms: true }] })
  if (parsed.pathname === '/v2/devices' && method === 'POST') return jsonResponse({ iden: 'chrome-1', nickname: 'Chrome', type: 'chrome', active: true })
  if (parsed.pathname === '/v2/chats') return jsonResponse({ chats: [{ iden: 'chat-1', active: true, with: { email: 'friend@example.com', email_normalized: 'friend@example.com', name: 'Friend' } }] })
  if (parsed.pathname === '/v2/subscriptions') return jsonResponse({ subscriptions: [{ iden: 'subscription-1', active: true, channel: { iden: 'channel-1', tag: 'updates', name: 'Updates' } }] })
  if (parsed.pathname === '/v2/pushes' && method === 'GET') return jsonResponse({ pushes: [] })
  if (parsed.pathname === '/v2/pushes' && method === 'POST') {
    return jsonResponse({ iden: `push-${pushNumber++}`, ...body, created: 100, modified: 100, target_device_iden: body.device_iden })
  }
  if (parsed.pathname === '/v2/upload-request' && method === 'POST') {
    return jsonResponse({ upload_url: 'https://upload.pushbullet.com/session-1', data: { token: 'upload-token' }, file_name: 'smoke.bin', file_type: 'application/octet-stream', file_url: 'https://cdn.pushbullet.com/smoke.bin' })
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
await import(pathToFileURL(resolve(process.cwd(), outputDirectory, 'background.js')).href)
await new Promise((resolve) => setTimeout(resolve, 0))

function dispatch(message) {
  return new Promise((resolve) => messageListener(message, {}, resolve))
}

const authenticated = await dispatch({ type: 'set_token', token: 'smoke-token' })
if (!authenticated.ok || authenticated.state.user?.email !== 'me@example.com') throw new Error('Authentication smoke test failed.')
if (!authenticated.state.device || Object.keys(authenticated.state.chats).length !== 1) throw new Error('Remote state smoke test failed.')
await new Promise((resolve) => setTimeout(resolve, 5))
await commandListener('pop-out-panel')
const expectedPanel = outputDirectory === 'dist-classic' ? 'classic-pages/panel.html' : 'popup.html'
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

await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'mirror', iden: 'mirror-1', application_name: 'Messages', title: 'New message', body: 'Hello', package_name: 'com.example.messages', notification_id: '42', source_device_iden: 'phone-1' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
if (!nativeNotifications.has('mirror_mirror-1')) throw new Error('Mirror notification smoke test failed.')
if (!notificationButtonListener) throw new Error('Notification action listener was not registered.')
await notificationButtonListener('mirror_mirror-1', 0)
await new Promise((resolve) => setTimeout(resolve, 5))
if (nativeNotifications.has('mirror_mirror-1')) throw new Error('Mirror dismissal smoke test failed.')
if (openedTabs.length) throw new Error('Mirror smoke test opened an unexpected tab.')

await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'mirror', iden: 'mirror-self', application_name: 'Messages', title: 'Self mirror', source_device_iden: 'chrome-1' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
if (nativeNotifications.has('mirror_mirror-self')) throw new Error('Self mirror filtering smoke test failed.')

await lastSocket.onmessage({ data: JSON.stringify({ type: 'push', push: { type: 'link', iden: 'link-1', title: 'Example', url: 'https://example.com', direction: 'incoming' } }) })
await new Promise((resolve) => setTimeout(resolve, 5))
if (!nativeNotifications.has('push_link-1') || !openedTabs.some((tab) => tab.url === 'https://example.com/')) throw new Error('Link notification smoke test failed.')
if (badgeText !== '1') throw new Error('Notification badge smoke test failed.')
await notificationButtonListener('push_link-1', 0)
await new Promise((resolve) => setTimeout(resolve, 5))
if (nativeNotifications.has('push_link-1')) throw new Error('Link notification action smoke test failed.')

await import(`${pathToFileURL(resolve(process.cwd(), outputDirectory, 'background.js')).href}?restart=${Date.now()}`)
await new Promise((resolve) => setTimeout(resolve, 5))
const restarted = await dispatch({ type: 'get_state' })
if (!restarted.ok || restarted.state.user?.email !== 'me@example.com' || !restarted.state.device) throw new Error('Worker restart persistence smoke test failed.')

const notificationSettings = await dispatch({ type: 'save_settings', settings: { onlyShowTitles: true, showNotificationCount: false, notificationDuration: 30, useDarkIcon: true } })
if (!notificationSettings.ok) throw new Error('Notification settings smoke test failed.')
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
uploadPort.sendFromClient({ type: 'chunk', buffer: Uint8Array.from([1, 2, 3, 4]).buffer })
uploadPort.sendFromClient({ type: 'complete' })
await new Promise((resolve) => setTimeout(resolve, 10))
if (!uploadPort.outbound.some((message) => message.type === 'complete')) throw new Error('File upload smoke test failed.')
if (!fetchCalls.some((call) => call.path === '/v2/upload-request' && call.method === 'POST') || !fetchCalls.some((call) => call.path === '/session-1' && call.method === 'POST')) throw new Error('Signed upload request smoke test failed.')

const smsUploadPort = new MockPort()
connectListener(smsUploadPort)
smsUploadPort.sendFromClient({ type: 'start', fileName: 'mms.bin', mimeType: 'application/octet-stream', size: 2, delivery: 'sms', target: {}, sms: { deviceIden: 'phone-1', addresses: ['+15550001'], body: 'MMS' } })
smsUploadPort.sendFromClient({ type: 'chunk', buffer: Uint8Array.from([5, 6]).buffer })
smsUploadPort.sendFromClient({ type: 'complete' })
await new Promise((resolve) => setTimeout(resolve, 10))
if (!smsUploadPort.outbound.some((message) => message.type === 'complete' && message.sms)) throw new Error('SMS attachment upload smoke test failed.')

const note = await dispatch({ type: 'send_push', push: { type: 'note', body: 'Hello from smoke test', deviceIden: 'phone-1' } })
if (!note.ok || Object.keys(note.state.pushes).length !== 2) throw new Error('Note push smoke test failed.')

const link = await dispatch({ type: 'send_push', push: { type: 'link', title: 'Example', url: 'https://example.com', deviceIden: 'phone-1' } })
if (!link.ok || Object.keys(link.state.pushes).length !== 3) throw new Error('Link push smoke test failed.')

const originalConsoleError = console.error
console.error = () => undefined
const invalidUrl = await dispatch({ type: 'send_push', push: { type: 'link', url: 'javascript:alert(1)', deviceIden: 'phone-1' } })
console.error = originalConsoleError
if (invalidUrl.ok || !invalidUrl.error.includes('HTTP')) throw new Error('URL validation smoke test failed.')

if (!alarms.has('pb-refresh') || !alarms.has('pb-heartbeat')) throw new Error('Alarm registration smoke test failed.')
if (!fetchCalls.some((call) => call.path === '/v2/pushes' && call.method === 'POST' && call.body.type === 'link')) throw new Error('Push request smoke test failed.')

const signedOut = await dispatch({ type: 'sign_out' })
if (!signedOut.ok || signedOut.state.user !== null || storage.apiKey || nativeNotifications.size || alarms.has('pb-notification-push_title-only-1')) throw new Error('Sign-out smoke test failed.')

console.log('Worker smoke test passed.')
