import { useEffect, useRef, useState } from 'react'
import { sendExtensionMessage } from '../shared/messages'
import type { ExtensionState } from '../shared/models'
import { MAX_UPLOAD_BYTES } from '../shared/uploads'
import { uploadFileThroughPort } from '../shared/uploadClient'
import type { StreamTarget } from './StreamList'

type PushComposerProps = {
  target: StreamTarget | null
  automaticallyAttachLink: boolean
  onStateChange: (state: ExtensionState) => void
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tabs[0] || null
}

export function PushComposer({ target, automaticallyAttachLink, onStateChange }: PushComposerProps) {
  const [mode, setMode] = useState<'note' | 'link'>('note')
  const [body, setBody] = useState('')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('')
  const [sending, setSending] = useState(false)
  const [cancelUpload, setCancelUpload] = useState<(() => void) | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const chooseFile = (file: File | undefined) => {
    if (!file) return
    if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
      setStatus(`Files must be smaller than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`)
      return
    }
    setSelectedFile(file)
    setStatus(`${file.name} is ready to upload.`)
  }

  const attachActiveTab = async () => {
    try {
      const tab = await getActiveTab()
      if (!tab?.url || !/^https?:/i.test(tab.url)) {
        setStatus('The active tab is not a web page that can be pushed.')
        return
      }
      setMode('link')
      setTitle(tab.title || '')
      setUrl(tab.url)
      setStatus('Active tab attached.')
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not read the active tab.')
    }
  }

  useEffect(() => {
    if (automaticallyAttachLink) void attachActiveTab()
  }, [automaticallyAttachLink])

  const openChat = async () => {
    if (!target?.email) return
    try {
      await chrome.windows.create({
        url: chrome.runtime.getURL(`chat.html?mode=push&target=${encodeURIComponent(target.email)}`),
        type: 'popup',
        width: 460,
        height: 680
      })
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not open the chat window.')
    }
  }

  const send = async () => {
    if (!target) {
      setStatus('Select a stream first.')
      return
    }
    if (!selectedFile && mode === 'note' && !body.trim()) {
      setStatus('Write a message first.')
      return
    }
    if (!selectedFile && mode === 'link' && !url.trim()) {
      setStatus('Add a link first.')
      return
    }

    setSending(true)
    setStatus(selectedFile ? 'Preparing upload...' : 'Sending...')
    try {
      if (selectedFile) {
        const state = await uploadFileThroughPort(selectedFile, {
          target: {
            deviceIden: target.deviceIden,
            email: target.email,
            channelIden: target.channelIden
          }
        }, (progress) => setStatus(`Uploading ${progress}%...`), (cancel) => setCancelUpload(() => cancel))
        setSelectedFile(null)
        setStatus('File sent.')
        onStateChange(state)
        return
      }
      const response = await sendExtensionMessage({
        type: 'send_push',
        push: {
          type: mode,
          body: body.trim() || undefined,
          title: title.trim() || undefined,
          url: url.trim() || undefined,
          deviceIden: target.deviceIden,
          email: target.email,
          channelIden: target.channelIden
        }
      })
      if (!response.ok) throw new Error(response.error)
      setBody('')
      setTitle('')
      setUrl('')
      setMode('note')
      setStatus('Push sent.')
      onStateChange(response.state)
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not send the push.')
    } finally {
      setCancelUpload(null)
      setSending(false)
    }
  }

  return (
    <section
      className="composer"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        chooseFile(event.dataTransfer.files[0])
      }}
    >
      <div className="composer-header">
        <div>
          <div className="card-kicker">New push</div>
          <h2>{target?.label || 'Select a stream'}</h2>
        </div>
        <div className="composer-tools">
          {target?.email && <button className="small-button" type="button" onClick={() => void openChat()} disabled={sending}>Chat</button>}
          <input ref={fileInputRef} className="file-input-hidden" type="file" onChange={(event) => chooseFile(event.target.files?.[0])} disabled={sending} />
          <button className="small-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={sending}>Attach file</button>
          <button className="small-button" type="button" onClick={() => void attachActiveTab()} disabled={sending}>Attach tab</button>
        </div>
      </div>
      <div className="composer-tabs" role="tablist" aria-label="Push type">
        <button className={mode === 'note' ? 'composer-tab-selected' : ''} type="button" onClick={() => setMode('note')}>Note</button>
        <button className={mode === 'link' ? 'composer-tab-selected' : ''} type="button" onClick={() => setMode('link')}>Link</button>
      </div>
      {mode === 'link' && (
        <>
          <input className="composer-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title (optional)" disabled={sending} />
          <input className="composer-input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." disabled={sending} />
        </>
      )}
      <textarea
        className="composer-textarea"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onPaste={(event) => {
          const pastedFile = event.clipboardData.files[0]
          if (pastedFile) {
            event.preventDefault()
            chooseFile(pastedFile)
          }
        }}
        placeholder={mode === 'link' ? 'Message (optional)' : 'Write a message or paste a file...'}
        disabled={sending}
      />
      {selectedFile && <div className="file-chip"><span>{selectedFile.name}</span><button type="button" onClick={() => setSelectedFile(null)} disabled={sending}>Remove</button></div>}
      <div className="composer-footer">
        <span className="composer-status" aria-live="polite">{status}</span>
        {sending && cancelUpload && <button className="dismiss-button" type="button" onClick={cancelUpload}>Cancel</button>}
        <button className="primary-button composer-send" type="button" onClick={() => void send()} disabled={sending || !target}>
          {sending ? 'Sending...' : 'Send push'}
        </button>
      </div>
    </section>
  )
}
