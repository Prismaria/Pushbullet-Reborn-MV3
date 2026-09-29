import type { ExtensionState, PushDraft, SmsSendDraft } from './models'
import { encodeUploadChunk, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from './uploads'

type UploadClientRequest = {
  target: Pick<PushDraft, 'deviceIden' | 'email' | 'channelIden'>
  delivery?: 'push' | 'sms'
  sms?: Omit<SmsSendDraft, 'fileUrl' | 'fileType'>
}

export async function uploadFileThroughPort(
  file: File,
  request: UploadClientRequest,
  onProgress: (loaded: number) => void,
  onCancelReady: (cancel: () => void) => void
): Promise<ExtensionState> {
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) throw new Error(`Files must be smaller than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`)

  return new Promise<ExtensionState>((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'upload' })
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
      port.disconnect()
    }
    onCancelReady(() => finish(() => {
      port.postMessage({ type: 'cancel' })
      reject(new Error('Upload cancelled.'))
    }))

    port.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return
      const response = message as { type?: unknown; loaded?: unknown; total?: unknown; state?: unknown; error?: unknown }
      if (response.type === 'progress' && typeof response.loaded === 'number' && typeof response.total === 'number') {
        onProgress(Math.min(90, Math.round((response.loaded / response.total) * 90)))
      } else if (response.type === 'complete' && response.state) {
        finish(() => resolve(response.state as ExtensionState))
      } else if (response.type === 'error') {
        finish(() => reject(new Error(typeof response.error === 'string' ? response.error : 'File upload failed.')))
      }
    })
    port.onDisconnect.addListener(() => {
      if (!settled) reject(new Error('The upload connection closed unexpectedly.'))
    })

    port.postMessage({
      type: 'start',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      target: request.target,
      delivery: request.delivery,
      sms: request.sms
    })

    void (async () => {
      try {
        for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
          const bytes = new Uint8Array(await file.slice(offset, Math.min(offset + UPLOAD_CHUNK_BYTES, file.size)).arrayBuffer())
          port.postMessage({ type: 'chunk', data: encodeUploadChunk(bytes), size: bytes.byteLength })
        }
        port.postMessage({ type: 'complete' })
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error('Could not read the selected file.')))
      }
    })()
  })
}
