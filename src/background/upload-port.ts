import { decodeUploadChunk, isUploadPortMessage, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES, type UploadStart } from '../shared/uploads'
import { uploadAndSendFile, uploadAndSendSms } from './uploads'

function targetFromStart(start: UploadStart): UploadStart['target'] {
  return {
    deviceIden: typeof start.target.deviceIden === 'string' ? start.target.deviceIden : undefined,
    email: typeof start.target.email === 'string' ? start.target.email : undefined,
    channelIden: typeof start.target.channelIden === 'string' ? start.target.channelIden : undefined
  }
}

export function registerUploadPort(port: chrome.runtime.Port): void {
  let start: UploadStart | null = null
  let chunks: Uint8Array[] = []
  let loaded = 0
  let finished = false
  let processing = false
  const controller = new AbortController()

  const fail = (error: string) => {
    if (finished) return
    finished = true
    port.postMessage({ type: 'error', error })
  }

  port.onMessage.addListener((value: unknown) => {
    if (finished) return
    if (processing) {
      if (isUploadPortMessage(value) && value.type === 'cancel') controller.abort()
      return
    }
    if (!isUploadPortMessage(value)) {
      fail('Invalid upload message.')
      return
    }

    if (value.type === 'cancel') {
      fail('Upload cancelled.')
      return
    }

    if (value.type === 'start') {
      if (start || !Number.isInteger(value.size) || value.size < 1 || value.size > MAX_UPLOAD_BYTES) {
        fail(`Files must be between 1 byte and ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`)
        return
      }
      if (!value.fileName.trim() || value.fileName.length > 255 || value.mimeType.length > 128) {
        fail('The file name or MIME type is invalid.')
        return
      }
      start = { ...value, target: targetFromStart(value) }
      port.postMessage({ type: 'progress', loaded: 0, total: value.size })
      return
    }

    if (value.type === 'chunk') {
      if (!start || value.size > UPLOAD_CHUNK_BYTES || loaded + value.size > start.size) {
        fail('The upload chunk is invalid.')
        return
      }
      let chunk: Uint8Array
      try {
        chunk = decodeUploadChunk(value.data)
      } catch {
        fail('The upload chunk is invalid.')
        return
      }
      if (chunk.byteLength !== value.size) {
        fail('The upload chunk is invalid.')
        return
      }
      chunks.push(chunk)
      loaded += chunk.byteLength
      port.postMessage({ type: 'progress', loaded, total: start.size })
      return
    }

    if (!start || loaded !== start.size) {
      fail('The upload ended before all file data arrived.')
      return
    }

    processing = true
    const request = start
    const upload = request.delivery === 'sms' && request.sms
      ? uploadAndSendSms({
        fileName: request.fileName,
        mimeType: request.mimeType,
        bytes: chunks,
        size: request.size,
        signal: controller.signal,
        sms: request.sms
      })
      : uploadAndSendFile({
      fileName: request.fileName,
      mimeType: request.mimeType,
      bytes: chunks,
      size: request.size,
      target: request.target,
      signal: controller.signal
    })
    void (async () => {
      try {
        const result = await upload
        port.postMessage({
          type: 'complete',
          state: result.state,
          ...('push' in result ? { push: result.push } : { sms: result.sms })
        })
      } catch (error: unknown) {
        port.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'File upload failed.' })
      } finally {
        finished = true
        chunks = []
      }
    })()
  })

  port.onDisconnect.addListener(() => {
    controller.abort()
    chunks = []
  })
}
