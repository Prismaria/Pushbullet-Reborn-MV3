import { apiRequest } from './api'
import { broadcastState } from './events'
import { normalizePush } from './remote'
import { sendSms } from './sms'
import { updateState } from './state'
import type { ExtensionState, PushDraft, SmsSendDraft } from '../shared/models'
import { MAX_UPLOAD_BYTES } from '../shared/uploads'
import { cleanUploadFileName, validateSignedUploadUrl } from '../shared/validation'

type UploadRequest = {
  upload_url?: string
  data?: Record<string, string>
  file_name?: string
  file_type?: string
  file_url?: string
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

async function uploadFile(input: UploadInput): Promise<UploadedFile> {
  const byteCount = input.bytes.reduce((total, chunk) => total + chunk.byteLength, 0)
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > MAX_UPLOAD_BYTES || byteCount !== input.size) {
    throw new Error('The uploaded file size is invalid.')
  }
  const fileName = cleanUploadFileName(input.fileName)
  const mimeType = input.mimeType || 'application/octet-stream'
  const upload = await apiRequest<UploadRequest>('/v2/upload-request', {
    method: 'POST',
    body: JSON.stringify({ file_name: fileName, file_type: mimeType }),
    signal: input.signal
  })
  const form = new FormData()
  for (const [key, value] of Object.entries(upload.data || {})) form.append(key, value)
  const parts: BlobPart[] = input.bytes.map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer)
  const blob = new Blob(parts, { type: mimeType })
  form.append('file', blob, fileName)
  const response = await fetch(validateSignedUploadUrl(upload.upload_url), { method: 'POST', body: form, signal: input.signal })
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
  const remotePush = await apiRequest<Record<string, unknown>>('/v2/pushes', {
    method: 'POST',
    signal: input.signal,
    body: JSON.stringify({
      type: 'file',
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
