import { apiRequest } from './api'
import { broadcastState } from './events'
import { normalizePush } from './remote'
import { sendSms } from './sms'
import { readState, updateState } from './state'
import type { ExtensionState, PushDraft, SmsSendDraft } from '../shared/models'
import { formatUploadLimit, maxUploadBytesForUser, MAX_SINGLE_POST_UPLOAD_BYTES, MAX_UPLOAD_BYTES } from '../shared/uploads'
import { cleanUploadFileName, validateSignedUploadUrl } from '../shared/validation'

type UploadRequest = {
  upload_url?: string
  data?: Record<string, string>
  file_name?: string
  file_type?: string
  file_url?: string
}

type ChunkedUploadRequest = {
  id?: string | number
  piece_size?: number
  piece_urls?: string[]
}

function targetPayload(target: Pick<PushDraft, 'deviceIden' | 'email' | 'channelIden'>): Record<string, string> {
  return {
    ...(target.deviceIden ? { device_iden: target.deviceIden } : {}),
    ...(target.email ? { email: target.email } : {}),
    ...(target.channelIden ? { channel_tag: target.channelIden } : {})
  }
}

type UploadInput = {
  fileName: string
  mimeType: string
  bytes: Uint8Array[]
  size: number
  signal?: AbortSignal
}

type UploadedFile = {
  fileName: string
  fileType: string
  fileUrl: string
}

function uploadBlob(input: UploadInput, mimeType: string): Blob {
  const parts: BlobPart[] = input.bytes.map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer)
  return new Blob(parts, { type: mimeType })
}

async function uploadLargeFile(input: UploadInput, fileName: string, mimeType: string): Promise<UploadedFile> {
  const upload = await apiRequest<ChunkedUploadRequest>('/v3/start-upload', {
    method: 'POST',
    body: JSON.stringify({ name: fileName, size: input.size, suggested_type: mimeType }),
    signal: input.signal
  })
  const pieceSize = upload.piece_size
  const pieceUrls = upload.piece_urls
  if ((typeof upload.id !== 'string' && typeof upload.id !== 'number')
    || !Number.isSafeInteger(pieceSize) || !pieceSize || pieceSize < 1
    || !Array.isArray(pieceUrls) || pieceUrls.some((url) => typeof url !== 'string')
    || pieceUrls.length !== Math.ceil(input.size / pieceSize)) {
    throw new Error('Pushbullet returned invalid large-file upload details.')
  }

  const blob = uploadBlob(input, mimeType)
  for (let index = 0; index < pieceUrls.length; index += 1) {
    const start = index * pieceSize
    const piece = blob.slice(start, Math.min(start + pieceSize, input.size), mimeType)
    const response = await fetch(validateSignedUploadUrl(pieceUrls[index]), {
      method: 'POST',
      body: piece,
      signal: input.signal
    })
    if (!response.ok) throw new Error(`Pushbullet file chunk ${index + 1} of ${pieceUrls.length} failed (${response.status}).`)
  }

  const finished = await apiRequest<UploadRequest>('/v3/finish-upload', {
    method: 'POST',
    body: JSON.stringify({ id: upload.id }),
    signal: input.signal
  })
  if (!finished.file_url) throw new Error('Pushbullet did not return a file URL after the upload completed.')
  return {
    fileName: finished.file_name || fileName,
    fileType: finished.file_type || mimeType,
    fileUrl: finished.file_url
  }
}

async function uploadFile(input: UploadInput): Promise<UploadedFile> {
  const current = await readState()
  const maxUploadBytes = maxUploadBytesForUser(current.user)
  const byteCount = input.bytes.reduce((total, chunk) => total + chunk.byteLength, 0)
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > MAX_UPLOAD_BYTES || byteCount !== input.size) {
    throw new Error('The uploaded file size is invalid.')
  }
  if (input.size > maxUploadBytes) throw new Error(`This account's file upload limit is ${formatUploadLimit(maxUploadBytes)}.`)
  const fileName = cleanUploadFileName(input.fileName)
  const mimeType = input.mimeType || 'application/octet-stream'
  if (input.size > MAX_SINGLE_POST_UPLOAD_BYTES) return uploadLargeFile(input, fileName, mimeType)

  const upload = await apiRequest<UploadRequest>('/v2/upload-request', {
    method: 'POST',
    body: JSON.stringify({ file_name: fileName, file_type: mimeType }),
    signal: input.signal
  })
  const form = new FormData()
  for (const [key, value] of Object.entries(upload.data || {})) form.append(key, value)
  form.append('file', uploadBlob(input, mimeType), fileName)
  const response = await fetch(validateSignedUploadUrl(upload.upload_url), { method: 'POST', body: form, signal: input.signal })
  if (response.status === 502) {
    throw new Error(`Pushbullet's upload server returned 502. This file is within the account's ${formatUploadLimit(maxUploadBytes)} limit, but the server could not complete the upload.`)
  }
  if (!response.ok) throw new Error(`Pushbullet file upload failed (${response.status}).`)
  if (!upload.file_url) throw new Error('Pushbullet did not return a file URL.')

  return {
    fileName: upload.file_name || fileName,
    fileType: upload.file_type || mimeType,
    fileUrl: upload.file_url
  }
}

export async function uploadAndSendFile(input: UploadInput & {
  target: Pick<PushDraft, 'deviceIden' | 'email' | 'channelIden'>
}): Promise<{ state: ExtensionState; push: unknown }> {
  const uploaded = await uploadFile(input)
  const current = await readState()
  const remotePush = await apiRequest<Record<string, unknown>>('/v2/pushes', {
    method: 'POST',
    signal: input.signal,
    body: JSON.stringify({
      type: 'file',
      source_device_iden: current.device?.iden,
      file_name: uploaded.fileName,
      file_type: uploaded.fileType,
      file_url: uploaded.fileUrl,
      ...targetPayload(input.target)
    })
  })
  const push = normalizePush(remotePush)
  if (!push) throw new Error('Pushbullet returned no file push record.')
  const state = await updateState((current) => ({
    ...current,
    pushes: { ...current.pushes, [push.iden]: push },
    lastModified: Math.max(current.lastModified, push.modified || push.created || 0)
  }))
  await broadcastState(state)
  return { state, push }
}

export async function uploadAndSendSms(input: UploadInput & { sms: Omit<SmsSendDraft, 'fileUrl' | 'fileType'> }): Promise<{ state: ExtensionState; sms: unknown }> {
  const uploaded = await uploadFile(input)
  return sendSms({ ...input.sms, fileUrl: uploaded.fileUrl, fileType: uploaded.fileType })
}
