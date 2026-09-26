import type { PushDraft, SmsSendDraft } from './models'

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const UPLOAD_CHUNK_BYTES = 256 * 1024

export type UploadStart = {
  type: 'start'
  fileName: string
  mimeType: string
  size: number
  target: Pick<PushDraft, 'deviceIden' | 'email' | 'channelIden'>
  delivery?: 'push' | 'sms'
  sms?: Omit<SmsSendDraft, 'fileUrl' | 'fileType'>
}

export type UploadChunk = {
  type: 'chunk'
  buffer: ArrayBuffer
}

export type UploadComplete = { type: 'complete' } | { type: 'cancel' }
export type UploadPortMessage = UploadStart | UploadChunk | UploadComplete

export type UploadProgress = {
  type: 'progress'
  loaded: number
  total: number
}

export type UploadResult = {
  type: 'complete'
  state: unknown
  push: unknown
}

export type UploadFailure = {
  type: 'error'
  error: string
}

export function isUploadPortMessage(value: unknown): value is UploadPortMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false
  const message = value as { type?: unknown; buffer?: unknown; fileName?: unknown; mimeType?: unknown; size?: unknown; target?: unknown }
  if (message.type === 'cancel' || message.type === 'complete') return true
  if (message.type === 'chunk') return message.buffer instanceof ArrayBuffer
  if (message.type !== 'start') return false
  return typeof message.fileName === 'string'
    && typeof message.mimeType === 'string'
    && typeof message.size === 'number'
    && !!message.target
    && typeof message.target === 'object'
}
