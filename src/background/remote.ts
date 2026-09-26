import { apiRequest } from './api'
import { broadcastState } from './events'
import { notifyForPushes } from './notifications'
import { readState, updateState } from './state'
import { mirrorIdentity, type Chat, type Device, type EntityMap, type ExtensionState, type MirrorDetails, type Push, type Subscription } from '../shared/models'

type DeviceResponse = { devices?: unknown[] }
type ChatResponse = { chats?: unknown[] }
type SubscriptionResponse = { subscriptions?: unknown[] }
type PushResponse = { pushes?: unknown[] }

let refreshPromise: Promise<ExtensionState> | null = null

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeDevice(value: unknown): Device | null {
  const raw = record(value)
  const iden = stringValue(raw.iden)
  if (!iden) return null
  return {
    iden,
    nickname: stringValue(raw.nickname),
    model: stringValue(raw.model),
    manufacturer: stringValue(raw.manufacturer),
    type: stringValue(raw.type),
    icon: stringValue(raw.icon),
    active: raw.active !== false,
    pushable: raw.pushable !== false,
    hasSms: raw.has_sms === true,
    hasMms: raw.has_mms === true,
    appVersion: typeof raw.app_version === 'number' ? raw.app_version : undefined,
    created: typeof raw.created === 'number' ? raw.created : undefined
  }
}

export function normalizePush(value: unknown): Push | null {
  const raw = record(value)
  const mirror: MirrorDetails | undefined = raw.type === 'mirror' ? {
    iden: stringValue(raw.iden),
    sourceUserIden: stringValue(raw.source_user_iden),
    applicationName: stringValue(raw.application_name),
    title: stringValue(raw.title),
    body: stringValue(raw.body),
    packageName: stringValue(raw.package_name),
    notificationId: stringValue(raw.notification_id),
    notificationTag: stringValue(raw.notification_tag),
    sourceDeviceIden: stringValue(raw.source_device_iden),
    conversationIden: stringValue(raw.conversation_iden),
    icon: stringValue(raw.icon),
    image: stringValue(raw.image),
    actions: Array.isArray(raw.actions) ? raw.actions.flatMap((value) => {
      const action = record(value)
      return typeof action.label === 'string' ? [{ label: action.label, id: stringValue(action.id) }] : []
    }) : undefined
  } : undefined
  const iden = stringValue(raw.iden) || (mirror ? mirrorIdentity(mirror) : undefined)
  if (!iden) return null
  return {
    iden,
    type: stringValue(raw.type),
    title: stringValue(raw.title),
    body: stringValue(raw.body),
    url: stringValue(raw.url),
    fileName: stringValue(raw.file_name),
    fileType: stringValue(raw.file_type),
    fileUrl: stringValue(raw.file_url),
    direction: stringValue(raw.direction),
    senderEmailNormalized: stringValue(raw.sender_email_normalized),
    receiverEmailNormalized: stringValue(raw.receiver_email_normalized),
    sourceDeviceIden: stringValue(raw.source_device_iden),
    targetDeviceIden: stringValue(raw.target_device_iden),
    deviceIden: stringValue(raw.device_iden),
    streamDeviceIden: stringValue(raw.stream_device_iden),
    channelIden: stringValue(raw.channel_iden),
    clientIden: stringValue(raw.client_iden),
    channelTag: stringValue(raw.channel_tag),
    mirror,
    created: typeof raw.created === 'number' ? raw.created : undefined,
    modified: typeof raw.modified === 'number' ? raw.modified : undefined,
    dismissed: raw.dismissed === true,
    active: raw.active !== false
  }
}

function normalizeChat(value: unknown): Chat | null {
  const raw = record(value)
  const iden = stringValue(raw.iden)
  const withUser = record(raw.with)
  if (!iden) return null
  return {
    iden,
    active: raw.active !== false,
    with: {
      email: stringValue(withUser.email),
      emailNormalized: stringValue(withUser.email_normalized),
      name: stringValue(withUser.name),
      imageUrl: stringValue(withUser.image_url)
    }
  }
}

function normalizeSubscription(value: unknown): Subscription | null {
  const raw = record(value)
  const iden = stringValue(raw.iden)
  if (!iden) return null
  const channel = record(raw.channel)
  return {
    iden,
    active: raw.active !== false,
    channel: raw.channel ? {
      iden: stringValue(channel.iden),
      name: stringValue(channel.name),
      tag: stringValue(channel.tag),
      imageUrl: stringValue(channel.image_url)
    } : undefined
  }
}

function mapById<T extends { iden: string }>(values: unknown[], normalize: (value: unknown) => T | null): EntityMap<T> {
  return Object.fromEntries(values.flatMap((value) => {
    const item = normalize(value)
    return item ? [[item.iden, item]] : []
  }))
}

async function fetchDevices(): Promise<EntityMap<Device>> {
  const response = await apiRequest<DeviceResponse>('/v2/devices')
  return mapById(response.devices || [], normalizeDevice)
}

async function ensureChromeDevice(devices: EntityMap<Device>): Promise<Device | null> {
  const existing = Object.values(devices).find((device) => device.active !== false && device.type === 'chrome')
  if (existing) return existing

  if (!Object.keys(devices).length) return null
  const created = await apiRequest<Record<string, unknown>>('/v2/devices', {
    method: 'POST',
    body: JSON.stringify({
      nickname: 'Chrome',
      type: 'chrome',
      model: 'Chrome',
      manufacturer: 'Google',
      icon: 'browser',
      app_version: 1
    })
  })
  const device = normalizeDevice(created)
  if (device) devices[device.iden] = device
  return device
}

async function fetchOptional<T>(request: () => Promise<T>, label: string): Promise<T | null> {
  try {
    return await request()
  } catch (error) {
    console.warn(`Pushbullet ${label} are unavailable:`, error)
    return null
  }
}

export async function refreshRemoteState(options: { notify?: boolean } = {}): Promise<ExtensionState> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const current = await readState()
    const user = await apiRequest<Record<string, unknown>>('/v2/users/me')
    const [devicesResponse, chatsResponse, subscriptionsResponse, pushesResponse] = await Promise.all([
      fetchOptional(fetchDevices, 'devices'),
      fetchOptional(async () => apiRequest<ChatResponse>('/v2/chats?active=true'), 'chats'),
      fetchOptional(async () => apiRequest<SubscriptionResponse>('/v2/subscriptions?active=true'), 'subscriptions'),
      fetchOptional(async () => apiRequest<PushResponse>('/v2/pushes?active=true&limit=100'), 'push history')
    ])

    const devices = devicesResponse || current.devices
    let device = current.device
    try {
      device = await ensureChromeDevice(devices)
    } catch (error) {
      console.warn('Could not register the Chrome device:', error)
    }

    const chats = chatsResponse ? mapById(chatsResponse.chats || [], normalizeChat) : current.chats
    const subscriptions = subscriptionsResponse ? mapById(subscriptionsResponse.subscriptions || [], normalizeSubscription) : current.subscriptions
    const channels = Object.fromEntries(Object.values(subscriptions).flatMap((subscription) => {
      const channel = subscription.channel
      return channel?.iden ? [[channel.iden, channel]] : []
    }))
    const pushes = pushesResponse ? mapById(pushesResponse.pushes || [], normalizePush) : current.pushes
    const lastModified = Math.max(current.lastModified, ...Object.values(pushes).map((push) => push.modified || 0))
    const next = await updateState((state) => ({
      ...state,
      user: {
        iden: stringValue(user.iden),
        email: stringValue(user.email),
        emailNormalized: stringValue(user.email_normalized),
        name: stringValue(user.name),
         imageUrl: stringValue(user.image_url),
         pro: user.pro === true,
         replyCountQuota: typeof user.reply_count_quota === 'number' || typeof user.reply_count_quota === 'string' ? user.reply_count_quota : undefined
      },
      device,
      devices,
      chats,
      subscriptions,
      channels,
      pushes,
      lastModified,
      connectionStatus: 'connected'
    }))
    await broadcastState(next)
    if (options.notify) {
      const newPushes = Object.values(pushes).filter((push) => !current.pushes[push.iden])
      await notifyForPushes(newPushes)
    }
    return next
  })().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}
