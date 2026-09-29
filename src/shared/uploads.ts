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
  data: string
  size: number
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

export function encodeUploadChunk(bytes: Uint8Array): string {
  let binary = ''
  const segmentSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += segmentSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + segmentSize, bytes.length)))
  }
  return btoa(binary)
}

export function decodeUploadChunk(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function decodedBase64Length(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return data.length / 4 * 3 - padding
}

export function isUploadPortMessage(value: unknown): value is UploadPortMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false
  const message = value as { type?: unknown; data?: unknown; buffer?: unknown; fileName?: unknown; mimeType?: unknown; size?: unknown; target?: unknown }
  if (message.type === 'cancel' || message.type === 'complete') return true
  if (message.type === 'chunk') {
    if (typeof message.data !== 'string' || typeof message.size !== 'number' || !Number.isInteger(message.size)) return false
    if (message.size < 1 || message.size > UPLOAD_CHUNK_BYTES) return false
    if (message.data.length !== Math.ceil(message.size / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) return false
    return decodedBase64Length(message.data) === message.size
  }
  if (message.type !== 'start') return false
  return typeof message.fileName === 'string'
    && typeof message.mimeType === 'string'
    && typeof message.size === 'number'
    && !!message.target
    && typeof message.target === 'object'
}
