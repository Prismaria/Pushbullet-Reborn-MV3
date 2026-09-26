import { broadcastState, setConnectionStatus } from './events'
import { normalizePush, refreshRemoteState } from './remote'
import { clearNotification, handleNotificationAlarm, notifyForPush } from './notifications'
import { readState, readToken, updateState } from './state'
import { mirrorIdentity } from '../shared/models'

let socket: WebSocket | null = null
let generation = 0
let connectionPromise: Promise<void> | null = null

export async function disconnectWebSocket(): Promise<void> {
  generation += 1
  if (socket) socket.close(1000, 'signed out')
  socket = null
  await setConnectionStatus('disconnected')
}

export async function connectWebSocket(): Promise<void> {
  if (connectionPromise) return connectionPromise
  connectionPromise = connectWebSocketInternal().finally(() => {
    connectionPromise = null
  })
  return connectionPromise
}

async function connectWebSocketInternal(): Promise<void> {
  const token = await readToken()
  if (!token) return
  const state = await readState()
  if (state.connectionStatus === 'connected' && socket?.readyState === WebSocket.OPEN) return

  const currentGeneration = ++generation
  await setConnectionStatus('connecting')
  socket = new WebSocket(`wss://stream.pushbullet.com/websocket/${encodeURIComponent(token)}`)

  socket.onopen = () => {
    if (currentGeneration !== generation) return
    void (async () => {
      await setConnectionStatus('connected')
      await chrome.storage.local.set({ reconnectAttempts: 0 })
      try {
        await refreshRemoteState({ notify: false })
      } catch (error) {
        console.warn('Could not refresh state after connecting:', error)
      }
    })()
  }

  socket.onmessage = (event) => {
    if (currentGeneration !== generation) return
    void (async () => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; subtype?: string; push?: { type?: string; iden?: string; package_name?: string; notification_id?: string; notification_tag?: string; conversation_iden?: string; source_device_iden?: string; target_device_iden?: string } }
        if (message.type === 'tickle' && message.subtype === 'push') await refreshRemoteState({ notify: true })
        if (message.type === 'push' && message.push?.type === 'dismissal') {
          const push = message.push
          const currentDeviceIden = (await readState()).device?.iden
          if (currentDeviceIden && (push.source_device_iden === currentDeviceIden || (push.target_device_iden && push.target_device_iden !== currentDeviceIden))) return
          await clearNotification(`mirror_${mirrorIdentity({ packageName: push.package_name, notificationId: push.notification_id, notificationTag: push.notification_tag, conversationIden: push.conversation_iden }, push.iden)}`)
        } else if (message.type === 'push' && message.push) {
          const currentDeviceIden = (await readState()).device?.iden
          if (currentDeviceIden && (message.push.source_device_iden === currentDeviceIden || (message.push.target_device_iden && message.push.target_device_iden !== currentDeviceIden))) return
          const push = normalizePush(message.push)
          if (push) await notifyForPush(push)
        }
      } catch (error) {
        console.warn('Could not process Pushbullet stream message:', error)
      }
    })()
  }

  socket.onerror = () => {
    if (currentGeneration === generation) void setConnectionStatus('disconnected')
  }

  socket.onclose = () => {
    if (currentGeneration !== generation) return
    socket = null
    void (async () => {
      const attempts = await chrome.storage.local.get('reconnectAttempts')
      const nextAttempt = Math.min(Number(attempts.reconnectAttempts || 0) + 1, 8)
      await chrome.storage.local.set({ reconnectAttempts: nextAttempt })
      await setConnectionStatus('disconnected')
      if (chrome.alarms) {
        await chrome.alarms.create('pb-reconnect', { delayInMinutes: Math.min(5, Math.max(1, nextAttempt * 0.5)) })
      }
    })()
  }
}

export async function initializeConnection(): Promise<void> {
  if (chrome.alarms) {
    await chrome.alarms.create('pb-refresh', { periodInMinutes: 5 })
    await chrome.alarms.create('pb-heartbeat', { periodInMinutes: 1 })
  }
  if (!await readToken()) return
  try {
    await refreshRemoteState({ notify: false })
    await connectWebSocket()
  } catch (error) {
    console.warn('Pushbullet connection initialization failed:', error)
    await setConnectionStatus('disconnected')
  }
}

export async function handleAlarm(name: string): Promise<void> {
  if (name.startsWith('pb-notification-')) {
    await handleNotificationAlarm(name)
  } else if (name === 'pb-heartbeat' && socket?.readyState === WebSocket.OPEN) {
    socket.send('keepalive')
  } else if (name === 'pb-refresh' && await readToken()) {
    try {
      await refreshRemoteState({ notify: true })
    } catch (error) {
      console.warn('Scheduled Pushbullet refresh failed:', error)
    }
  } else if (name === 'pb-reconnect') {
    await connectWebSocket()
  }
}

export function handleIdleState(state: string): void {
  if (state === 'locked') {
    void disconnectWebSocket()
  } else if (state === 'active') {
    void connectWebSocket()
  }
}
