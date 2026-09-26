import { apiRequest } from './api'
import { broadcastState } from './events'
import { readState, updateState } from './state'
import type { ExtensionState, SmsMessage, SmsSendDraft, SmsThread } from '../shared/models'

type PermanentResponse = { data?: unknown }
const ACTIVE_CHATS_KEY = 'activeChatKeys'

async function readActiveChats(): Promise<string[]> {
  if (!chrome.storage.session) return []
  const stored = await chrome.storage.session.get(ACTIVE_CHATS_KEY)
  return Array.isArray(stored[ACTIVE_CHATS_KEY])
    ? stored[ACTIVE_CHATS_KEY].filter((value): value is string => typeof value === 'string')
    : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function permanentData(value: unknown): Record<string, unknown> {
  const response = record(value)
  const data = record(response.data)
  return Object.keys(data).length ? data : response
}

function normalizeThread(value: unknown): SmsThread | null {
  const raw = record(value)
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : null
  const recipients = Array.isArray(raw.recipients) ? raw.recipients.flatMap((item) => {
    const recipient = record(item)
    const address = typeof recipient.address === 'string' ? recipient.address : null
    return address ? [{ address, name: typeof recipient.name === 'string' ? recipient.name : undefined }] : []
  }) : []
  if (!id || !recipients.length) return null
  return {
    id,
    recipients,
    latest: typeof raw.latest === 'number' ? raw.latest : undefined
  }
}

function normalizeMessage(value: unknown): SmsMessage {
  const raw = record(value)
  return {
    iden: typeof raw.iden === 'string' ? raw.iden : undefined,
    body: typeof raw.body === 'string' ? raw.body : typeof raw.message === 'string' ? raw.message : undefined,
    direction: typeof raw.direction === 'string' ? raw.direction : undefined,
    addresses: Array.isArray(raw.addresses) ? raw.addresses.filter((address): address is string => typeof address === 'string') : undefined,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : undefined,
    created: typeof raw.created === 'number' ? raw.created : undefined,
    fileUrl: typeof raw.file_url === 'string' ? raw.file_url : undefined,
    fileType: typeof raw.file_type === 'string' ? raw.file_type : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    guid: typeof raw.guid === 'string' ? raw.guid : undefined
  }
}

async function getPermanent(key: string): Promise<Record<string, unknown> | null> {
  const response = await apiRequest<PermanentResponse>('/v3/get-permanent', {
    method: 'POST',
    body: JSON.stringify({ key })
  })
  const data = permanentData(response)
  return Object.keys(data).length ? data : null
}

export async function getSmsThreads(deviceIden: string): Promise<SmsThread[]> {
  const data = await getPermanent(`${deviceIden}_threads`)
  const values = Array.isArray(data?.threads) ? data.threads : []
  return values.flatMap((value) => {
    const thread = normalizeThread(value)
    return thread ? [thread] : []
  })
}

export async function getSmsThread(deviceIden: string, threadId: string): Promise<SmsMessage[]> {
  const data = await getPermanent(`${deviceIden}_thread_${threadId}`)
  const values = Array.isArray(data?.thread) ? data.thread : []
  return values.map(normalizeMessage).sort((first, second) => (first.timestamp || first.created || 0) - (second.timestamp || second.created || 0))
}

export async function getPhonebook(deviceIden: string): Promise<unknown> {
  return getPermanent(`phonebook_${deviceIden}`)
}

function guid(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function sendSms(sms: SmsSendDraft): Promise<{ state: ExtensionState; sms: unknown }> {
  if (!sms.deviceIden || !sms.addresses.length) throw new Error('An SMS needs a device and at least one recipient.')
  if (!sms.body?.trim() && !sms.fileUrl) throw new Error('An SMS needs a message or attachment.')
  const payload = {
    addresses: sms.addresses,
    message: sms.body || '',
    target_device_iden: sms.deviceIden,
    guid: guid(),
    file_type: sms.fileType
  }
  const response = await apiRequest<Record<string, unknown>>('/v3/create-text', {
    method: 'POST',
    body: JSON.stringify({ data: payload, file_url: sms.fileUrl })
  })
  const result = response.data || response
  const resultRecord = record(result)
  const text = {
    ...resultRecord,
    target_device_iden: sms.deviceIden,
    addresses: sms.addresses,
    message: sms.body || '',
    guid: typeof resultRecord.guid === 'string' ? resultRecord.guid : payload.guid,
    status: typeof resultRecord.status === 'string' ? resultRecord.status : 'sent',
    created: typeof resultRecord.created === 'number' ? resultRecord.created : Date.now() / 1000
  }
  const state = await updateState((current) => ({
    ...current,
    texts: { ...current.texts, [String(resultRecord.iden || payload.guid)]: text }
  }))
  await broadcastState(state)
  return { state, sms: result }
}

export async function setActiveChat(key: string): Promise<void> {
  if (!chrome.storage.session) return
  const activeChats = await readActiveChats()
  if (!activeChats.includes(key)) activeChats.push(key)
  await chrome.storage.session.set({ [ACTIVE_CHATS_KEY]: activeChats })
}

export async function clearActiveChat(key: string): Promise<void> {
  if (!chrome.storage.session) return
  const activeChats = await readActiveChats()
  await chrome.storage.session.set({ [ACTIVE_CHATS_KEY]: activeChats.filter((item) => item !== key) })
}

export async function isChatActive(key: string): Promise<boolean> {
  return (await readActiveChats()).includes(key)
}
