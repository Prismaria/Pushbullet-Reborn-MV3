import {
  createDefaultState,
  DEFAULT_SETTINGS,
  type Device,
  type EntityMap,
  type ExtensionSettings,
  type ExtensionState
} from '../shared/models.ts'
import { toExtensionUser } from '../shared/messages.ts'

export const STATE_KEY = 'extensionState'
const LEGACY_KEYS = [
  'user', 'device', 'devices', 'chats', 'subscriptions', 'channels',
    'grants', 'pushes', 'texts', 'notifications', 'settings', 'lastModified', 'connectionStatus', 'awake'
]

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      return parseRecord(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseMap<T>(value: unknown): EntityMap<T> {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.flatMap((item) => {
      if (!item || typeof item !== 'object' || !('iden' in item)) return []
      const iden = (item as { iden?: unknown }).iden
      return typeof iden === 'string' ? [[iden, item as T]] : []
    }))
  }
  return parseRecord(value) as EntityMap<T>
}

function normalizeDevice(value: unknown): Device | null {
  const raw = parseRecord(value)
  if (typeof raw.iden !== 'string') return null
  return {
    iden: raw.iden,
    nickname: typeof raw.nickname === 'string' ? raw.nickname : undefined,
    model: typeof raw.model === 'string' ? raw.model : undefined,
    manufacturer: typeof raw.manufacturer === 'string' ? raw.manufacturer : undefined,
    type: typeof raw.type === 'string' ? raw.type : undefined,
    icon: typeof raw.icon === 'string' ? raw.icon : undefined,
    active: raw.active !== false,
    pushable: raw.pushable !== false,
    hasSms: raw.hasSms === true || raw.has_sms === true,
    hasMms: raw.hasMms === true || raw.has_mms === true,
    appVersion: typeof raw.appVersion === 'number' ? raw.appVersion : typeof raw.app_version === 'number' ? raw.app_version : undefined,
    created: typeof raw.created === 'number' ? raw.created : undefined
  }
}

function normalizeDeviceMap(value: unknown): EntityMap<Device> {
  return Object.fromEntries(Object.values(parseMap<unknown>(value)).flatMap((item) => {
    const device = normalizeDevice(item)
    return device ? [[device.iden, device]] : []
  }))
}

function normalizeState(value: unknown): ExtensionState {
  const saved = parseRecord(value) as Partial<ExtensionState>
  const state = createDefaultState()
  return {
    ...state,
    ...saved,
    user: toExtensionUser(saved.user),
    device: normalizeDevice(saved.device),
    devices: normalizeDeviceMap(saved.devices),
    chats: parseMap(saved.chats),
    subscriptions: parseMap(saved.subscriptions),
    channels: parseMap(saved.channels),
    grants: parseRecord(saved.grants),
    pushes: parseMap(saved.pushes),
    texts: parseRecord(saved.texts),
    notifications: parseMap(saved.notifications),
    settings: {
      ...DEFAULT_SETTINGS,
      ...parseRecord(saved.settings) as Partial<ExtensionSettings>
    }
  }
}

function hasLegacyState(stored: Record<string, unknown>): boolean {
  return LEGACY_KEYS.some((key) => stored[key] !== undefined)
}

function migrateLegacyState(stored: Record<string, unknown>): ExtensionState {
  const state = createDefaultState()
  const legacySettings = parseRecord(stored.settings)
  const settings = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = stored[key] ?? legacySettings[key]
    if (value !== undefined) (settings as Record<string, unknown>)[key] = value
  }

  return {
    ...state,
    schemaVersion: 2,
    user: toExtensionUser(stored.user),
    device: normalizeDevice(stored.device),
    devices: normalizeDeviceMap(stored.devices),
    chats: parseMap(stored.chats),
    subscriptions: parseMap(stored.subscriptions),
    channels: parseMap(stored.channels),
    grants: parseRecord(stored.grants),
    pushes: parseMap(stored.pushes),
    texts: parseRecord(stored.texts),
    notifications: parseMap(stored.notifications),
    connectionStatus: stored.connectionStatus === 'connected' || stored.connectionStatus === 'connecting' ? stored.connectionStatus : 'disconnected',
    awake: stored.awake === true,
    lastModified: Number(stored.lastModified) || 0,
    settings
  }
}

export async function readState(): Promise<ExtensionState> {
  const stored = await chrome.storage.local.get([STATE_KEY, ...LEGACY_KEYS])
  if (stored[STATE_KEY]) return normalizeState(stored[STATE_KEY])

  const state = hasLegacyState(stored) ? migrateLegacyState(stored) : createDefaultState()
  if (hasLegacyState(stored)) await writeState(state)
  return state
}

export async function writeState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state })
}

export async function updateState(update: (state: ExtensionState) => ExtensionState): Promise<ExtensionState> {
  const nextState = update(await readState())
  await writeState(nextState)
  return nextState
}

export async function readToken(): Promise<string | null> {
  const local = await chrome.storage.local.get(['apiKey', 'accessToken'])
  if (typeof local.apiKey === 'string' && local.apiKey.trim()) return local.apiKey.trim()
  if (typeof local.accessToken === 'string' && local.accessToken.trim()) return local.accessToken.trim()

  const sync = await chrome.storage.sync.get('accessToken')
  if (typeof sync.accessToken === 'string' && sync.accessToken.trim()) return sync.accessToken.trim()
  return null
}

export async function writeToken(token: string): Promise<void> {
  await chrome.storage.local.set({ apiKey: token.trim() })
  await chrome.storage.local.remove('accessToken')
  await chrome.storage.sync.remove('accessToken')
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(['apiKey', 'accessToken'])
  await chrome.storage.sync.remove('accessToken')
}
