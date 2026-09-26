import { useEffect, useState } from 'react'
import { sendExtensionMessage } from '../shared/messages'
import type { ExtensionState, Push, SmsMessage, SmsThread } from '../shared/models'
import { uploadFileThroughPort } from '../shared/uploadClient'
import { MAX_UPLOAD_BYTES } from '../shared/uploads'
import { useClassicState } from './useClassicState'

const params = new URLSearchParams(location.search)
const mode = params.get('mode') === 'sms' ? 'sms' : 'push'
const initialEmail = params.get('email') || params.get('target') || ''
const initialDevice = params.get('deviceIden') || location.hash.slice(1).split('_thread_')[0] || ''
const initialThread = params.get('threadId') || location.hash.slice(1).split('_thread_')[1] || ''

function asset(name: string): string {
  return `../classic-assets/${name}`
}

function ClassicChatHistory({ pushes, messages, sms }: { pushes: Push[]; messages: SmsMessage[]; sms: boolean }) {
  type ChatItem = { id: string; body?: string; title?: string; url?: string; fileUrl?: string; direction?: string }
  const values: ChatItem[] = sms
    ? messages.map((message, index) => ({ id: message.iden || message.guid || String(index), body: message.body, direction: message.direction, fileUrl: message.fileUrl }))
    : pushes.map((push) => ({ id: push.iden, body: push.body, title: push.title, url: push.url, fileUrl: push.fileUrl, direction: push.direction }))
  if (!values.length) return <div id="chat-empty-state"><div><img src={asset('bg_sam.png')} alt="" /><p>No messages yet.</p></div></div>
  return <>{values.map((message) => <div className="chat-row" key={message.id}><div className={`chat-bubble${message.direction === 'incoming' ? ' left' : ''}${sms && message.direction === 'incoming' ? ' sms' : ''}`}><div className="chat-bubble-contents">{message.title && <div className="chat-title">{message.title}</div>}{message.body && <div className="chat-body">{message.body}</div>}{message.url && <a className="chat-url" href={message.url} target="_blank" rel="noreferrer">{message.url}</a>}{message.fileUrl && <a className="chat-url" href={message.fileUrl} target="_blank" rel="noreferrer">Open attachment</a>}</div></div></div>)}</>
}

export function ClassicChatWindow() {
  const { state: loadedState, setState, loading } = useClassicState()
  const [targetEmail, setTargetEmail] = useState(initialEmail)
  const [deviceIden] = useState(initialDevice)
  const [threadId, setThreadId] = useState(initialThread)
  const [threads, setThreads] = useState<SmsThread[]>([])
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [body, setBody] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [cancelUpload, setCancelUpload] = useState<(() => void) | null>(null)

  const chatKey = mode === 'sms' ? `sms:${deviceIden}:${threadId}` : `push:${targetEmail}`

  useEffect(() => {
    if (!chatKey || chatKey.endsWith(':')) return
    const mark = async () => {
      try { await sendExtensionMessage({ type: 'set_active_chat', key: chatKey }) } catch { /* closing tabs can race the worker */ }
    }
    void mark()
    return () => {
      const clear = async () => {
        try { await sendExtensionMessage({ type: 'clear_active_chat', key: chatKey }) } catch { /* worker may already be asleep */ }
      }
      void clear()
    }
  }, [chatKey])

  useEffect(() => {
    if (mode !== 'sms' || !deviceIden) return
    const loadThreads = async () => {
      const response = await sendExtensionMessage({ type: 'get_sms_threads', deviceIden })
      if (!response.ok) throw new Error(response.error)
      const next = response.threads as SmsThread[]
      setThreads(next)
      if (!threadId && next[0]) setThreadId(next[0].id)
    }
    void loadThreads().catch((caughtError) => setStatus(caughtError instanceof Error ? caughtError.message : 'Could not load SMS threads.'))
  }, [deviceIden, threadId])

  useEffect(() => {
    if (mode !== 'sms' || !deviceIden || !threadId) return
    const loadMessages = async () => {
      const response = await sendExtensionMessage({ type: 'get_sms_thread', deviceIden, threadId })
      if (!response.ok) throw new Error(response.error)
      setMessages(response.messages as SmsMessage[])
    }
    void loadMessages().catch((caughtError) => setStatus(caughtError instanceof Error ? caughtError.message : 'Could not load SMS messages.'))
  }, [deviceIden, threadId])

  if (loading && !loadedState) return <div id="chat-holder" />
  if (!loadedState || !loadedState.user) return <div id="chat-holder"><div id="messaging-banner">Sign in to Pushbullet before opening a chat.</div></div>
  const state = loadedState
  const contact = Object.values(state.chats).find((chat) => chat.with?.emailNormalized === targetEmail)
  const device = deviceIden ? state.devices[deviceIden] : undefined
  const thread = threads.find((item) => item.id === threadId)
  const pushes = Object.values(state.pushes).filter((push) => targetEmail && (push.senderEmailNormalized === targetEmail || push.receiverEmailNormalized === targetEmail)).sort((first, second) => (first.created || 0) - (second.created || 0))
  const recipients = thread?.recipients.map((recipient) => recipient.address) || []

  const chooseFile = async (file: File | undefined) => {
    if (!file || busy || file.size < 1 || file.size > MAX_UPLOAD_BYTES) return
    if (mode === 'sms') {
      if (!deviceIden || !recipients.length || device?.hasMms !== true) {
        setStatus('This device does not support MMS attachments.')
        return
      }
    } else if (!targetEmail) {
      return
    }
    setBusy(true)
    try {
      const nextState = mode === 'sms'
        ? await uploadFileThroughPort(file, { delivery: 'sms', target: { deviceIden }, sms: { deviceIden, addresses: recipients, body: body.trim() || undefined } }, (progress) => setStatus(`${progress}%`), (cancel) => setCancelUpload(() => cancel))
        : await uploadFileThroughPort(file, { target: { email: targetEmail } }, (progress) => setStatus(`${progress}%`), (cancel) => setCancelUpload(() => cancel))
      setState(nextState)
      setBody('')
      setStatus('Attachment sent.')
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not send the attachment.')
    } finally {
      setCancelUpload(null)
      setBusy(false)
    }
  }

  const send = async () => {
    if (!body.trim()) return
    setBusy(true)
    try {
      const response = mode === 'sms'
        ? await sendExtensionMessage({ type: 'send_sms', sms: { deviceIden, addresses: recipients, body: body.trim() } })
        : await sendExtensionMessage({ type: 'send_push', push: /^https?:\/\/\S+$/i.test(body.trim()) ? { type: 'link', url: body.trim(), email: targetEmail } : { type: 'note', body: body.trim(), email: targetEmail } })
      if (!response.ok) throw new Error(response.error)
      setBody('')
      setState(response.state)
      setStatus('Sent.')
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not send the message.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="classic-chat-window">
      <div id="bottom"><textarea id="input" value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} disabled={busy} placeholder={status || (mode === 'sms' ? 'Write an SMS...' : 'Write a push...')} />{cancelUpload && <button type="button" onClick={cancelUpload}>Cancel</button>}</div>
      <div id="chat-holder">
        <div id="push-chat-scroll" className="chat-scroll" style={{ display: mode === 'push' ? 'block' : 'none' }}><div id="push-chat-table" className="chat-table"><div id="push-chat-cell" className="chat-cell"><ClassicChatHistory pushes={pushes} messages={[]} sms={false} /></div></div></div>
        <div id="sms-chat-scroll" className="chat-scroll" style={{ display: mode === 'sms' ? 'block' : 'none' }}><div id="sms-chat-table" className="chat-table"><div id="sms-chat-cell" className="chat-cell"><ClassicChatHistory pushes={[]} messages={messages} sms /></div></div></div>
        <div id="messaging-banner" />
      </div>
      <div id="top">
        <div id="picker-holder" style={{ display: mode === 'push' ? 'block' : 'none' }}><input id="chat-target" className="picker-input" type="text" value={contact?.with?.name || targetEmail} onChange={(event) => setTargetEmail(event.target.value)} list="classic-chat-targets" /><datalist id="classic-chat-targets">{Object.values(state.chats).map((chat) => <option key={chat.iden} value={chat.with?.emailNormalized || ''}>{chat.with?.name}</option>)}</datalist><div id="chat-picker" className="picker" /><div id="chat-overlay" className="picker-overlay" /></div>
        <div id="sms-top" className="picker-overlay" style={{ display: mode === 'sms' ? 'block' : 'none' }}><div className="picker-option"><img id="sms-thumbnail" className="picker-target-image" src={asset('chip_person.png')} alt="" /><div id="sms-name" className="picker-target-text">{thread?.recipients.map((recipient) => recipient.name || recipient.address).join(', ') || device?.nickname || 'Choose a thread'}</div></div><div id="sms" style={{ color: 'white', fontSize: '32px', lineHeight: '50px', position: 'absolute', right: '10px' }}><i className="pushfont-sms" /></div><select value={threadId} onChange={(event) => setThreadId(event.target.value)}>{threads.map((item) => <option key={item.id} value={item.id}>{item.recipients.map((recipient) => recipient.name || recipient.address).join(', ')}</option>)}</select></div>
      </div>
      <div id="chat-drop-zone" className="drop-zone"><img id="chat-drop-zone-image" className="drop-zone-image" src={asset('upload.png')} alt="" /><label htmlFor="classic-chat-file">Attach</label><input id="classic-chat-file" type="file" style={{ display: 'none' }} onChange={(event) => void chooseFile(event.target.files?.[0])} /></div>
    </div>
  )
}
