import { useEffect, useState } from 'react'
import { sendExtensionMessage } from '../shared/messages'
import type { Chat as ChatContact, ExtensionState, SmsMessage, SmsThread } from '../shared/models'
import { uploadFileThroughPort } from '../shared/uploadClient'
import { MAX_UPLOAD_BYTES } from '../shared/uploads'
import { useExtensionState } from '../shared/useExtensionState'

const params = new URLSearchParams(location.search)
const mode = params.get('mode') === 'sms' ? 'sms' : 'push'
const initialTarget = params.get('target') || ''
const initialDevice = params.get('deviceIden') || ''
const initialThread = params.get('threadId') || ''

function formatTime(value: number | undefined): string {
  if (!value) return ''
  return new Date(value * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function pushMatches(push: ExtensionState['pushes'][string], email: string): boolean {
  return push.senderEmailNormalized === email || push.receiverEmailNormalized === email
}

function smsMessages(value: unknown): SmsMessage[] {
  return Array.isArray(value) ? value as SmsMessage[] : []
}

function smsThreads(value: unknown): SmsThread[] {
  return Array.isArray(value) ? value as SmsThread[] : []
}

function phonebookEntries(value: unknown): Array<{ name: string; address: string }> {
  if (!value || typeof value !== 'object') return []
  const source = value as { contacts?: unknown; phonebook?: unknown }
  const contacts = source.contacts ?? source.phonebook
  if (!Array.isArray(contacts)) return []
  return contacts.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const contact = item as { name?: unknown; address?: unknown; phone?: unknown }
    const address = typeof contact.address === 'string' ? contact.address : typeof contact.phone === 'string' ? contact.phone : ''
    return address ? [{ name: typeof contact.name === 'string' ? contact.name : address, address }] : []
  })
}

type MessageListProps = {
  messages: Array<{ id: string; body?: string; fileUrl?: string; direction?: string; created?: number; timestamp?: number }>
}

function MessageList({ messages }: MessageListProps) {
  if (!messages.length) return <div className="chat-empty">No messages yet. Start the conversation below.</div>
  return (
    <div className="chat-message-list">
      {messages.map((message) => (
        <article className={`chat-message ${message.direction === 'incoming' ? 'chat-message-incoming' : 'chat-message-outgoing'}`} key={message.id}>
          {message.body && <p>{message.body}</p>}
          {message.fileUrl && <a href={message.fileUrl} target="_blank" rel="noreferrer">Open attachment</a>}
          <time>{formatTime(message.timestamp || message.created)}</time>
        </article>
      ))}
    </div>
  )
}

type ChatComposerProps = {
  disabled: boolean
  placeholder: string
  fileTarget: { deviceIden?: string; email?: string }
  sms?: { deviceIden: string; addresses: string[] }
  smsAttachmentsAllowed?: boolean
  onSent: (state: ExtensionState) => void
}

function ChatComposer({ disabled, placeholder, fileTarget, sms, smsAttachmentsAllowed = true, onSent }: ChatComposerProps) {
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const [sending, setSending] = useState(false)
  const [cancelUpload, setCancelUpload] = useState<(() => void) | null>(null)

  const chooseFile = (nextFile: File | undefined) => {
    if (!nextFile) return
    if (sms && !smsAttachmentsAllowed) {
      setStatus('This device does not support MMS attachments.')
      return
    }
    if (nextFile.size > MAX_UPLOAD_BYTES) {
      setStatus(`Files must be smaller than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`)
      return
    }
    setFile(nextFile)
    setStatus(`${nextFile.name} is ready.`)
  }

  const send = async () => {
    if (!sms && !fileTarget.email) {
      setStatus('Select a conversation first.')
      return
    }
    if (!file && !body.trim()) {
      setStatus('Write a message or attach a file first.')
      return
    }
    setSending(true)
    setStatus(file ? 'Preparing upload...' : 'Sending...')
    try {
      if (file) {
        const state = await uploadFileThroughPort(file, {
          target: fileTarget,
          delivery: sms ? 'sms' : 'push',
          sms: sms ? { deviceIden: sms.deviceIden, addresses: sms.addresses, body: body.trim() || undefined } : undefined
        }, (progress) => setStatus(`Uploading ${progress}%...`), (cancel) => setCancelUpload(() => cancel))
        setFile(null)
        setBody('')
        setStatus('Attachment sent.')
        onSent(state)
        return
      }
      const response = sms
        ? await sendExtensionMessage({ type: 'send_sms', sms: { deviceIden: sms.deviceIden, addresses: sms.addresses, body: body.trim() } })
        : await sendExtensionMessage({ type: 'send_push', push: { type: 'note', body: body.trim(), email: fileTarget.email } })
      if (!response.ok) throw new Error(response.error)
      setBody('')
      setStatus('Sent.')
      onSent(response.state)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not send the message.')
    } finally {
      setCancelUpload(null)
      setSending(false)
    }
  }

  return (
    <section
      className="chat-composer"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        chooseFile(event.dataTransfer.files[0])
      }}
    >
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onPaste={(event) => {
          const pastedFile = event.clipboardData.files[0]
          if (pastedFile) {
            event.preventDefault()
            chooseFile(pastedFile)
          }
        }}
        placeholder={placeholder}
        disabled={disabled || sending}
      />
      {file && <div className="file-chip"><span>{file.name}</span><button type="button" onClick={() => setFile(null)} disabled={sending}>Remove</button></div>}
      <div className="chat-composer-footer">
        <label className="small-button file-label">
          Attach
          <input className="file-input-hidden" type="file" onChange={(event) => chooseFile(event.target.files?.[0])} disabled={disabled || sending || (sms !== undefined && !smsAttachmentsAllowed)} />
        </label>
        <span className="composer-status" aria-live="polite">{status}</span>
        {sending && cancelUpload && <button className="dismiss-button" type="button" onClick={cancelUpload}>Cancel</button>}
        <button className="primary-button composer-send" type="button" onClick={() => void send()} disabled={disabled || sending}>{sending ? 'Sending...' : 'Send'}</button>
      </div>
    </section>
  )
}

export function Chat() {
  const { state, setState, loading, error } = useExtensionState()
  const [targetEmail, setTargetEmail] = useState(initialTarget)
  const [deviceIden, setDeviceIden] = useState(initialDevice)
  const [threadId, setThreadId] = useState(initialThread)
  const [threads, setThreads] = useState<SmsThread[]>([])
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [phonebook, setPhonebook] = useState<unknown>(null)
  const [chatError, setChatError] = useState('')

  const chatKey = mode === 'sms' ? `sms:${deviceIden}:${threadId}` : `push:${targetEmail}`

  useEffect(() => {
    if (!chatKey || chatKey.endsWith(':')) return
    const markActive = async () => {
      try {
        await sendExtensionMessage({ type: 'set_active_chat', key: chatKey })
      } catch (caughtError) {
        setChatError(caughtError instanceof Error ? caughtError.message : 'Could not mark the chat as active.')
      }
    }
    void markActive()
    return () => {
      const clearActive = async () => {
        try {
          await sendExtensionMessage({ type: 'clear_active_chat', key: chatKey })
        } catch {
          // The chat may be closing while the worker is suspended.
        }
      }
      void clearActive()
    }
  }, [chatKey])

  useEffect(() => {
    if (mode !== 'sms' || !deviceIden) return
    const loadSmsData = async () => {
      try {
        const response = await sendExtensionMessage({ type: 'get_sms_threads', deviceIden })
        if (response.ok) {
          const nextThreads = smsThreads(response.threads)
          setThreads(nextThreads)
          if (!threadId && nextThreads[0]) setThreadId(nextThreads[0].id)
        } else setChatError(response.error)
      } catch (caughtError) {
        setChatError(caughtError instanceof Error ? caughtError.message : 'Could not load SMS threads.')
      }

      try {
        const response = await sendExtensionMessage({ type: 'get_phonebook', deviceIden })
        if (response.ok) setPhonebook(response.data)
      } catch {
        // Phonebook data is optional for SMS composition.
      }
    }
    void loadSmsData()
  }, [deviceIden, threadId])

  useEffect(() => {
    if (mode !== 'sms' || !deviceIden || !threadId) return
    const loadSmsThread = async () => {
      try {
        const response = await sendExtensionMessage({ type: 'get_sms_thread', deviceIden, threadId })
        if (response.ok) setMessages(smsMessages(response.messages))
        else setChatError(response.error)
      } catch (caughtError) {
        setChatError(caughtError instanceof Error ? caughtError.message : 'Could not load SMS messages.')
      }
    }
    void loadSmsThread()
  }, [deviceIden, threadId])

  if (loading && !state) return <main className="surface chat-surface loading-surface">Loading chat...</main>
  if (!state) return <main className="surface chat-surface"><div className="status status-error">{error || 'Chat state is unavailable.'}</div></main>
  if (!state.user) return <main className={`surface chat-surface ${state.settings.darkMode ? 'theme-dark' : 'theme-light'}`}><div className="status status-error">Sign in from the extension popup before opening a chat.</div></main>

  const contacts = Object.values(state.chats) as ChatContact[]
  const contact = contacts.find((item) => item.with?.emailNormalized === targetEmail)
  const device = state.devices[deviceIden]
  const smsThread = threads.find((thread) => thread.id === threadId)
  const pushMessages = Object.values(state.pushes)
    .filter((push) => targetEmail && pushMatches(push, targetEmail))
    .sort((first, second) => (first.created || 0) - (second.created || 0))
    .map((push) => ({ id: push.iden, body: push.body || push.title || push.url, fileUrl: push.fileUrl, direction: push.direction, created: push.created }))
  const smsMessageList = messages.map((message, index) => ({
    id: message.iden || message.guid || `${message.timestamp || message.created || 0}-${index}`,
    body: message.body,
    fileUrl: message.fileUrl,
    direction: message.direction,
    created: message.created,
    timestamp: message.timestamp
  }))
  const smsAddresses = smsThread?.recipients.map((recipient) => recipient.address) || []
  const phonebookContacts = phonebookEntries(phonebook)
  const smsQuota = state.user.replyCountQuota
  const smsQuotaExceeded = smsQuota === 'over_limit' || (typeof smsQuota === 'number' && smsQuota <= 0)

  return (
    <main className={`surface chat-surface ${state.settings.darkMode ? 'theme-dark' : 'theme-light'}`}>
      <header className="chat-header">
        <div>
          <div className="eyebrow">{mode === 'sms' ? 'SMS' : 'Push chat'}</div>
          <h1>{mode === 'sms' ? smsThread?.recipients.map((recipient) => recipient.name || recipient.address).join(', ') || device?.nickname || 'Choose a thread' : contact?.with?.name || targetEmail || 'Choose a conversation'}</h1>
        </div>
        <button className="small-button" type="button" onClick={() => window.close()}>Close</button>
      </header>

      {mode === 'push' && (
        <label className="chat-picker-label">Conversation
          <select className="chat-select" value={targetEmail} onChange={(event) => setTargetEmail(event.target.value)}>
            <option value="">Choose a friend</option>
            {contacts.filter((item) => item.with?.emailNormalized).map((item) => <option key={item.iden} value={item.with?.emailNormalized}>{item.with?.name || item.with?.emailNormalized}</option>)}
          </select>
        </label>
      )}
      {mode === 'sms' && (
        <label className="chat-picker-label">SMS device
          <select className="chat-select" value={deviceIden} onChange={(event) => { setDeviceIden(event.target.value); setThreadId('') }}>
            <option value="">Choose a device</option>
            {Object.values(state.devices).filter((item) => item.hasSms).map((item) => <option key={item.iden} value={item.iden}>{item.nickname || item.model || item.iden}</option>)}
          </select>
        </label>
      )}
      {mode === 'sms' && deviceIden && (
        <label className="chat-picker-label">Thread
          <select className="chat-select" value={threadId} onChange={(event) => setThreadId(event.target.value)}>
            <option value="">Choose a thread</option>
            {threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.recipients.map((recipient) => recipient.name || recipient.address).join(', ')}</option>)}
          </select>
        </label>
      )}

      {mode === 'sms' && phonebookContacts.length > 0 && (
        <details className="phonebook-card">
          <summary>Phonebook ({phonebookContacts.length})</summary>
          <div>{phonebookContacts.slice(0, 8).map((contact) => <span key={contact.address}>{contact.name}: {contact.address}</span>)}</div>
        </details>
      )}

      {mode === 'sms' && smsQuota !== undefined && !state.user.pro && <div className={`sms-quota ${smsQuotaExceeded ? 'sms-quota-error' : ''}`}>{smsQuotaExceeded ? 'SMS replies are temporarily over the account limit.' : `SMS replies remaining: ${smsQuota}`}</div>}

      {chatError && <div className="status status-error" role="alert">{chatError}</div>}
      <div className="chat-scroll-area">
        <MessageList messages={mode === 'sms' ? smsMessageList : pushMessages} />
      </div>
      <ChatComposer
        disabled={mode === 'push' ? !targetEmail : !deviceIden || !threadId || !smsAddresses.length || smsQuotaExceeded}
        placeholder={mode === 'sms' ? 'Write an SMS...' : 'Write a push...'}
        fileTarget={mode === 'sms' ? { deviceIden } : { email: targetEmail }}
        sms={mode === 'sms' && deviceIden && smsAddresses.length ? { deviceIden, addresses: smsAddresses } : undefined}
        smsAttachmentsAllowed={mode !== 'sms' || device?.hasMms === true}
        onSent={(nextState) => {
          setState(nextState)
          if (mode === 'sms' && deviceIden && threadId) {
            const refreshSmsThread = async () => {
              try {
                const response = await sendExtensionMessage({ type: 'get_sms_thread', deviceIden, threadId })
                if (response.ok) setMessages(smsMessages(response.messages))
              } catch (caughtError) {
                setChatError(caughtError instanceof Error ? caughtError.message : 'Could not refresh SMS messages.')
              }
            }
            void refreshSmsThread()
          }
        }}
      />
    </main>
  )
}
