import { useEffect, useMemo, useState } from 'react'
import { sendExtensionMessage } from '../shared/messages'
import type { Chat, Device, ExtensionState, Push, Subscription } from '../shared/models'
import { uploadFileThroughPort } from '../shared/uploadClient'
import { MAX_UPLOAD_BYTES } from '../shared/uploads'
import { ClassicAuth } from './ClassicAuth'
import { useClassicState } from './useClassicState'

type MainTab = 'pushing' | 'sms' | 'notifications' | 'account'
type PushTab = 'friends' | 'me' | 'following'

type ClassicTarget = {
  id: string
  label: string
  secondary: string
  image: string
  deviceIden?: string
  email?: string
  channelIden?: string
  channelTag?: string
}

function asset(name: string): string {
  return `../classic-assets/${name}`
}

function targetMatchesPush(push: Push, target: ClassicTarget | null): boolean {
  if (!target) return true
  if (target.id === 'everything') return push.direction === 'self'
  if (target.deviceIden) return push.targetDeviceIden === target.deviceIden || push.sourceDeviceIden === target.deviceIden || push.deviceIden === target.deviceIden || push.streamDeviceIden === target.deviceIden
  if (target.email) return push.senderEmailNormalized === target.email || push.receiverEmailNormalized === target.email
  if (target.channelIden) return push.channelIden === target.channelIden || push.channelTag === target.channelTag
  return true
}

function classicTargets(state: ExtensionState, tab: PushTab): ClassicTarget[] {
  if (tab === 'friends') {
    return Object.values(state.chats).flatMap((chat: Chat) => {
      const email = chat.with?.emailNormalized || chat.with?.email
      return email ? [{ id: `friend:${email}`, label: chat.with?.name || email, secondary: email, image: asset('chip_person.png'), email }] : []
    })
  }
  if (tab === 'following') {
    return Object.values(state.subscriptions).flatMap((subscription: Subscription) => subscription.channel?.iden ? [{
      id: `channel:${subscription.channel.iden}`,
      label: subscription.channel.name || subscription.channel.tag || 'Channel',
      secondary: subscription.channel.tag || '',
      image: asset('chip_channel.png'),
      channelIden: subscription.channel.iden,
      channelTag: subscription.channel.tag
    }] : [])
  }
  return [
    { id: 'everything', label: 'All devices', secondary: 'Every connected device', image: asset('chip_everything.png') },
    ...Object.values(state.devices).filter((device) => device.active !== false && device.pushable !== false).map((device: Device) => ({
      id: `device:${device.iden}`,
      label: device.nickname || device.model || device.iden,
      secondary: device.type || 'device',
      image: asset(`chip_${device.icon || device.type || 'other'}.png`),
      deviceIden: device.iden
    }))
  ]
}

function pushTitle(push: Push): string {
  return push.title || push.body || push.url || push.fileName || 'Pushbullet push'
}

function pushDate(push: Push): string {
  const timestamp = push.created || push.modified
  if (!timestamp) return ''
  const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
  return new Date(milliseconds).toLocaleString()
}

function localSmsMessages(state: ExtensionState, deviceIden: string, addresses: string[]) {
  const expected = new Set(addresses)
  return Object.values(state.texts).flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const raw = value as Record<string, unknown>
    const data = raw.data && typeof raw.data === 'object' ? raw.data as Record<string, unknown> : raw
    const targetDeviceIden = typeof data.target_device_iden === 'string' ? data.target_device_iden : typeof raw.target_device_iden === 'string' ? raw.target_device_iden : ''
    const messageAddresses = Array.isArray(data.addresses) ? data.addresses.filter((item): item is string => typeof item === 'string') : []
    if (targetDeviceIden !== deviceIden || messageAddresses.length !== expected.size || messageAddresses.some((address) => !expected.has(address))) return []
    const body = typeof data.message === 'string' ? data.message : typeof data.body === 'string' ? data.body : undefined
    const iden = typeof raw.iden === 'string' ? raw.iden : typeof data.iden === 'string' ? data.iden : typeof data.guid === 'string' ? data.guid : `local-${String(data.timestamp || raw.created || body || 'sms')}`
    return [{
      iden,
      body,
      direction: 'outgoing',
      created: typeof raw.created === 'number' ? raw.created : undefined,
      timestamp: typeof data.timestamp === 'number' ? data.timestamp : undefined,
      status: typeof data.status === 'string' ? data.status : typeof raw.status === 'string' ? raw.status : 'queued'
    }]
  })
}

function ClassicStreamRow({ target, selected, onSelect, onPopout }: { target: ClassicTarget; selected: boolean; onSelect: () => void; onPopout: () => void }) {
  return (
    <div className={`stream-row${selected ? ' selected' : ''}`} onClick={onSelect} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onSelect() }}>
      <img className="stream-row-image" src={target.image} alt="" onError={(event) => { event.currentTarget.src = asset('chip_other.png') }} />
      <div className="stream-row-content">
        <div>{target.label}</div>
        <div className="secondary">{target.secondary}</div>
      </div>
      {target.email && <span className="pop-out-stream" onClick={(event) => { event.stopPropagation(); onPopout() }}><i className="pushfont-popout" /></span>}
    </div>
  )
}

function ClassicActionRow({ image, label, onClick }: { image: string; label: string; onClick: () => void }) {
  return <div className="stream-row" onClick={onClick} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onClick() }}><img className="stream-row-image" src={image} alt="" /><div className="stream-row-content"><div>{label}</div></div></div>
}

function ClassicPushHistory({ state, target }: { state: ExtensionState; target: ClassicTarget | null }) {
  const pushes = Object.values(state.pushes)
    .filter((push) => targetMatchesPush(push, target))
    .sort((first, second) => (first.created || first.modified || 0) - (second.created || second.modified || 0))
    .slice(-30)

  if (!pushes.length) {
    return <div id="chat-empty-state"><div><img src={asset('bg_sam.png')} alt="" /><p>No pushes yet.</p></div></div>
  }

  return <>{pushes.map((push) => {
    const incoming = push.direction === 'incoming'
    return (
      <div className={`chat-row${incoming ? ' incoming' : ''}`} key={push.iden}>
        <div className={`chat-bubble${incoming ? ' left' : ''}`}>
            <div className="chat-bubble-contents">
            {push.title && <div className="chat-title">{push.title}</div>}
            {push.body && <div className="chat-body">{push.body}</div>}
            {push.url && <a className="chat-url" href={push.url} target="_blank" rel="noreferrer">{push.url}</a>}
            {push.fileUrl && <a className="chat-url" href={push.fileUrl} target="_blank" rel="noreferrer">{push.fileName || 'Open attachment'}</a>}
            <div className="chat-date">{pushDate(push)}</div>
          </div>
        </div>
      </div>
    )
  })}</>
}

function ClassicPushComposer({ state, target, onStateChange }: { state: ExtensionState; target: ClassicTarget | null; onStateChange: (state: ExtensionState) => void }) {
  const [body, setBody] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [cancelUpload, setCancelUpload] = useState<(() => void) | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const attachLink = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      const tab = tabs[0]
      if (!tab?.url || !/^https?:/i.test(tab.url)) throw new Error('The active tab is not a web page.')
      setLinkOpen(true)
      setTitle(tab.title || '')
      setUrl(tab.url)
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not attach the active tab.')
    }
  }

  useEffect(() => {
    if (target?.channelIden || !target || !state.settings.automaticallyAttachLink || location.hash) return
    void attachLink()
  }, [state.settings.automaticallyAttachLink, target?.id])

  const chooseFile = (next: File | undefined) => {
    if (!next) return
    if (next.size < 1 || next.size > MAX_UPLOAD_BYTES) {
      setStatus(`Files must be smaller than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`)
      return
    }
    setFile(next)
    setStatus(next.name)
  }

  const send = async () => {
    if (!target) return
    if (!file && linkOpen && !url.trim()) {
      setStatus('Add a link first.')
      return
    }
    if (!file && !linkOpen && !body.trim()) {
      setStatus('Write a message first.')
      return
    }
    setBusy(true)
    try {
      if (file) {
        const response = await uploadFileThroughPort(file, {
          target: { deviceIden: target.deviceIden, email: target.email, channelIden: target.channelIden }
        }, (progress) => setStatus(`${progress}%`), (cancel) => setCancelUpload(() => cancel))
        setFile(null)
        setStatus('File sent.')
        onStateChange(response)
      } else {
        const typedUrl = !linkOpen && /^https?:\/\/\S+$/i.test(body.trim())
        const response = await sendExtensionMessage({
          type: 'send_push',
          push: {
            type: linkOpen || typedUrl ? 'link' : 'note',
            title: title.trim() || undefined,
            body: linkOpen || !typedUrl ? body.trim() || undefined : undefined,
            url: linkOpen ? url.trim() : typedUrl ? body.trim() : undefined,
            deviceIden: target.deviceIden,
            email: target.email,
            channelIden: target.channelIden
          }
        })
        if (!response.ok) throw new Error(response.error)
        setBody('')
        setTitle('')
        setUrl('')
        setLinkOpen(false)
        setStatus('Sent.')
        onStateChange(response.state)
      }
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not send the push.')
    } finally {
      setCancelUpload(null)
      setBusy(false)
    }
  }

  return (
    <div id="push-right-bottom">
      <div style={{ clear: 'both' }} />
      <div id="push-send-holder" onClick={() => void send()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') void send() }}><i id="push-send-icon" className="pushfont-send" /></div>
      <div style={{ marginRight: '52px' }}>
        {linkOpen && <div id="push-link-holder" style={{ display: 'block' }}>
          <div id="push-link-favicon-holder"><img id="push-link-favicon" src={asset('link.png')} alt="" /></div>
          <div id="push-link-details"><input id="push-link-title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} /><input id="push-link-url" type="text" value={url} onChange={(event) => setUrl(event.target.value)} /><i id="push-link-close" className="pushfont-close" onClick={() => setLinkOpen(false)} /></div>
        </div>}
        <div>
          <div id="push-add-link" className={linkOpen ? 'with-link' : ''} onClick={() => void attachLink()}><i className="pushfont-linkpip" /></div>
          <div id="push-input-holder"><textarea id="push-input" tabIndex={1} value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} disabled={busy} placeholder={status || 'Write a push...'} onPaste={(event) => { if (event.clipboardData.files[0]) { event.preventDefault(); chooseFile(event.clipboardData.files[0]) } }} /></div>
        </div>
        <label htmlFor="classic-push-file" className="classic-file-label">{file ? file.name : 'Attach file'}</label>
        {cancelUpload && <button type="button" onClick={cancelUpload}>Cancel</button>}
        <input id="classic-push-file" type="file" style={{ display: 'none' }} onChange={(event) => chooseFile(event.target.files?.[0])} disabled={busy} />
      </div>
    </div>
  )
}

function ClassicSmsPanel({ state, target, onStateChange }: { state: ExtensionState; target: ClassicTarget | null; onStateChange: (state: ExtensionState) => void }) {
  type ClassicSmsLine = { iden?: string; body?: string; direction?: string; created?: number; timestamp?: number; status?: string }
  const [threads, setThreads] = useState<Array<{ id: string; recipients: Array<{ address: string; name?: string }> }>>([])
  const [threadId, setThreadId] = useState('')
  const [messages, setMessages] = useState<ClassicSmsLine[]>([])
  const [body, setBody] = useState('')
  const [status, setStatus] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [phonebook, setPhonebook] = useState<Array<{ name: string; address: string }>>([])

  useEffect(() => {
    if (!target?.deviceIden) return
    const loadThreads = async () => {
      try {
        const response = await sendExtensionMessage({ type: 'get_sms_threads', deviceIden: target.deviceIden! })
        if (!response.ok) throw new Error(response.error)
        const next = response.threads as Array<{ id: string; recipients: Array<{ address: string; name?: string }> }>
        setThreads(next)
        if (!threadId && next[0]) setThreadId(next[0].id)
      } catch (caughtError) {
        setStatus(caughtError instanceof Error ? caughtError.message : 'Could not load SMS threads.')
      }
    }
    void loadThreads()
    const loadPhonebook = async () => {
      try {
        const response = await sendExtensionMessage({ type: 'get_phonebook', deviceIden: target.deviceIden! })
        if (!response.ok || !response.data || typeof response.data !== 'object') return
        const raw = response.data as { phonebook?: unknown; contacts?: unknown }
        const values = raw.phonebook ?? raw.contacts
        if (!Array.isArray(values)) return
        setPhonebook(values.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const contact = item as { name?: unknown; address?: unknown; phone?: unknown }
          const address = typeof contact.address === 'string' ? contact.address : typeof contact.phone === 'string' ? contact.phone : ''
          return address ? [{ name: typeof contact.name === 'string' ? contact.name : address, address }] : []
        }))
      } catch {
        setPhonebook([])
      }
    }
    void loadPhonebook()
  }, [target?.deviceIden, threadId])

  useEffect(() => {
    if (!target?.deviceIden || !threadId) return
    const loadThread = async () => {
      const response = await sendExtensionMessage({ type: 'get_sms_thread', deviceIden: target.deviceIden!, threadId })
      if (response.ok) setMessages(response.messages as typeof messages)
    }
    void loadThread().catch((caughtError) => setStatus(caughtError instanceof Error ? caughtError.message : 'Could not load SMS messages.'))
  }, [target?.deviceIden, threadId])

  const thread = threads.find((item) => item.id === threadId)
  const displayedMessages = (() => {
    if (!target?.deviceIden || !thread) return messages
    const combined = [...messages, ...localSmsMessages(state, target.deviceIden, thread.recipients.map((item) => item.address))]
    const seen = new Set<string>()
    return combined.filter((message, index) => {
      const key = message.iden || `${message.timestamp || message.created || index}-${message.body || ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).sort((first, second) => (first.timestamp || first.created || 0) - (second.timestamp || second.created || 0))
  })()
  const send = async () => {
    if (!target?.deviceIden || !thread || !body.trim()) return
    try {
      const response = await sendExtensionMessage({ type: 'send_sms', sms: { deviceIden: target.deviceIden, addresses: thread.recipients.map((recipient) => recipient.address), body: body.trim() } })
      if (!response.ok) throw new Error(response.error)
      setBody('')
      setStatus('Sent.')
      if (response.sms && typeof response.sms === 'object') {
        const sent = response.sms as { iden?: unknown; guid?: unknown; body?: unknown; message?: unknown; timestamp?: unknown }
        setMessages((current) => [...current, {
          iden: typeof sent.iden === 'string' ? sent.iden : typeof sent.guid === 'string' ? sent.guid : `local-${Date.now()}`,
          body: typeof sent.body === 'string' ? sent.body : typeof sent.message === 'string' ? sent.message : body.trim(),
          direction: 'outgoing',
          timestamp: typeof sent.timestamp === 'number' ? sent.timestamp : Date.now()
        }])
      }
      onStateChange(response.state)
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not send SMS.')
    }
  }

  const sendNewSms = async () => {
    if (!target?.deviceIden || !recipient.trim() || !body.trim()) return
    try {
      const response = await sendExtensionMessage({ type: 'send_sms', sms: { deviceIden: target.deviceIden, addresses: [recipient.trim()], body: body.trim() } })
      if (!response.ok) throw new Error(response.error)
      setBody('')
      setRecipient('')
      setStatus('Sent.')
      onStateChange(response.state)
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not send SMS.')
    }
  }

  return (
    <div id="sms-right">
      {!target?.deviceIden && <div id="sms-no-devices"><div id="sms-no-devices-text">Select an SMS-capable device.</div></div>}
      {target?.deviceIden && <>
         <div id="sms-right-top" className={thread ? 'with-input' : ''}>
           <div className="classic-sms-picker"><button type="button" onClick={() => setComposeOpen(true)}>New SMS</button><select id="sms-device-picker" value={threadId} onChange={(event) => { setComposeOpen(false); setThreadId(event.target.value) }}><option value="">Choose a conversation</option>{threads.map((item) => <option key={item.id} value={item.id}>{item.recipients.map((recipient) => recipient.name || recipient.address).join(', ')}</option>)}</select></div>
           {!composeOpen && <div id="sms-chat-scroll" className="chat-scroll"><div id="sms-chat-table" className="chat-table"><div id="sms-chat-cell" className="chat-cell">{displayedMessages.map((message, index) => <div className={`chat-row${message.direction === 'incoming' ? '' : ' outgoing'}`} key={message.iden || `${message.created || message.timestamp || index}`}><div className={`chat-bubble${message.direction === 'incoming' ? ' left sms' : ''}`}><div className="chat-bubble-contents"><div className="chat-body">{message.body}</div>{message.status && message.status !== 'sent' && <div className="chat-status">{message.status}</div>}</div></div></div>)}</div></div></div>}
         </div>
         {composeOpen ? <div id="sms-compose-right"><div id="compose-recipient-picker-label" className="picker-label">Recipient</div><input id="compose-recipient" type="tel" value={recipient} onChange={(event) => setRecipient(event.target.value)} list="classic-phonebook" placeholder="Phone number" /><datalist id="classic-phonebook">{phonebook.map((contact) => <option key={contact.address} value={contact.address}>{contact.name}</option>)}</datalist><div id="compose-input-holder"><div id="compose-send-holder" onClick={() => void sendNewSms()} role="button" tabIndex={0}><i className="pushfont-send" /></div><div id="compose-message-holder"><textarea id="compose-message" tabIndex={2} value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendNewSms() } }} placeholder={status || 'Write an SMS...'} /></div></div></div> : thread && <div id="sms-right-bottom"><div id="sms-send-holder" onClick={() => void send()} role="button" tabIndex={0}><i id="sms-send-icon" className="pushfont-send" /></div><div style={{ marginRight: '52px' }}><div id="sms-input-holder"><textarea id="sms-input" tabIndex={1} value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={status || 'Write an SMS...'} /></div></div></div>}
       </>}
    </div>
  )
}

function ClassicNotification({ state, keyName, title, message, url, chatEmail, onStateChange }: { state: ExtensionState; keyName: string; title: string; message: string; url?: string; chatEmail?: string; onStateChange: (state: ExtensionState) => void }) {
  const dismiss = async () => {
    const response = await sendExtensionMessage({ type: 'dismiss_notification', key: keyName })
    if (response.ok) onStateChange(response.state)
  }
  const open = async () => {
    if (url) await chrome.tabs.create({ url, active: true })
    else if (chatEmail) await chrome.windows.create({ url: chrome.runtime.getURL(`classic-pages/chat-window.html?mode=push&email=${encodeURIComponent(chatEmail)}`), type: 'popup', width: 630, height: 520 })
    await dismiss()
  }
  return <div className="fake-notification"><div className="fake-notification-close" onClick={() => void dismiss()}><i className="pushfont-close" /></div><div className="fake-notification-text-holder" onClick={() => void open()}><div className="fake-notification-title">{title}</div><div className="fake-notification-message">{message}</div></div></div>
}

export function ClassicPanel() {
  const { state: loadedState, setState, loading } = useClassicState()
  const [mainTab, setMainTab] = useState<MainTab>('pushing')
  const [pushTab, setPushTab] = useState<PushTab>('me')
  const [selectedId, setSelectedId] = useState('everything')
  const isPopout = location.hash === '#popout'

  useEffect(() => {
    document.body.classList.toggle('signed-in', Boolean(loadedState?.user))
    document.body.classList.toggle('not-signed-in', Boolean(loadedState && !loadedState.user))
    document.body.classList.toggle('darkmode', Boolean(loadedState?.settings.darkMode))
    document.body.classList.toggle('popout', isPopout)
    return () => document.body.classList.remove('signed-in', 'not-signed-in', 'darkmode', 'popout')
  }, [isPopout, loadedState?.user, loadedState?.settings.darkMode])

  useEffect(() => {
    if (loadedState?.settings.needsDataApproval && !isPopout && !location.pathname.endsWith('/welcome.html')) {
      location.href = chrome.runtime.getURL('classic-pages/welcome.html')
    }
  }, [isPopout, loadedState?.settings.needsDataApproval])

  useEffect(() => {
    const restorePanel = async () => {
      const stored = await chrome.storage.local.get(['classicMainTab', 'classicPushTab', 'classicSelectedId', 'activePanelTab', 'activePushingTab', 'lastFriendTargetId', 'lastMeTargetId', 'lastFollowingTargetId'])
      const storedMainTab = stored.classicMainTab || stored.activePanelTab
      const storedPushTab = stored.classicPushTab || stored.activePushingTab
      if (storedMainTab === 'pushing' || storedMainTab === 'sms' || storedMainTab === 'notifications' || storedMainTab === 'account') setMainTab(storedMainTab)
      if (storedPushTab === 'friends' || storedPushTab === 'me' || storedPushTab === 'following') setPushTab(storedPushTab)
      if (typeof stored.classicSelectedId === 'string') {
        setSelectedId(stored.classicSelectedId)
      } else if (typeof storedPushTab === 'string') {
        const legacyTarget = storedPushTab === 'friends' ? stored.lastFriendTargetId : storedPushTab === 'following' ? stored.lastFollowingTargetId : stored.lastMeTargetId
        if (typeof legacyTarget === 'string') setSelectedId(storedPushTab === 'friends' ? `friend:${legacyTarget}` : storedPushTab === 'following' ? `channel:${legacyTarget}` : legacyTarget === '*' ? 'everything' : `device:${legacyTarget}`)
      }
    }
    void restorePanel().catch(() => undefined)
  }, [])

  if (loading && !loadedState) return <div id="container" />
  if (!loadedState) return <div id="container" />
  if (!loadedState.user) return <ClassicAuth state={loadedState} onStateChange={setState} />

  const state = loadedState
  const user = state.user
  if (!user) return <ClassicAuth state={state} onStateChange={setState} />
  const targets: ClassicTarget[] = mainTab === 'sms' ? Object.values(state.devices).filter((device) => device.hasSms).map((device) => ({ id: `sms:${device.iden}`, label: device.nickname || device.model || device.iden, secondary: 'SMS', image: asset(`chip_${device.icon || device.type || 'phone'}.png`), deviceIden: device.iden })) : classicTargets(state, pushTab)
  const target = targets.find((item) => item.id === selectedId) || targets[0] || null

  const openChat = async (nextTarget: ClassicTarget) => {
    const query = nextTarget.email ? `?mode=push&email=${encodeURIComponent(nextTarget.email)}` : `?mode=sms&deviceIden=${encodeURIComponent(nextTarget.deviceIden || '')}`
    await chrome.windows.create({ url: chrome.runtime.getURL(`classic-pages/chat-window.html${query}`), type: 'popup', width: 630, height: 520 })
  }

  const signOut = async () => {
    const response = await sendExtensionMessage({ type: 'sign_out' })
    if (response.ok) setState(response.state)
  }

  const toggleSnooze = async () => {
    const response = await sendExtensionMessage({ type: 'set_snooze', enabled: state.settings.snoozedUntil <= Date.now() })
    if (response.ok) setState(response.state)
  }

  const selectMainTab = (tab: MainTab) => {
    setMainTab(tab)
    void chrome.storage.local.set({ activePanelTab: tab, classicMainTab: tab })
  }

  const selectPushTab = (tab: PushTab) => {
    setPushTab(tab)
    setSelectedId(tab === 'me' ? 'everything' : '')
    void chrome.storage.local.set({ activePushingTab: tab, classicPushTab: tab, classicSelectedId: tab === 'me' ? 'everything' : '' })
  }

  const selectTarget = (id: string) => {
    setSelectedId(id)
    const legacyKey = pushTab === 'friends' ? 'lastFriendTargetId' : pushTab === 'following' ? 'lastFollowingTargetId' : 'lastMeTargetId'
    const legacyValue = pushTab === 'friends' ? id.replace(/^friend:/, '') : pushTab === 'following' ? id.replace(/^channel:/, '') : id === 'everything' ? '*' : id.replace(/^device:/, '')
    void chrome.storage.local.set({ classicSelectedId: id, ...(mainTab === 'pushing' ? { [legacyKey]: legacyValue } : {}) })
  }

  const openSite = (path: string) => {
    void chrome.tabs.create({ url: `https://www.pushbullet.com${path}` })
  }

  const renderTargetRows = () => <>
    {targets.map((item) => <ClassicStreamRow key={item.id} target={item} selected={item.id === target?.id} onSelect={() => selectTarget(item.id)} onPopout={() => void openChat(item)} />)}
    {pushTab === 'friends' && <ClassicActionRow image={asset('chip_add.png')} label="Add a friend" onClick={() => openSite('/#people/new')} />}
    {pushTab === 'following' && <ClassicActionRow image={asset('chip_add.png')} label="Explore channels" onClick={() => openSite('/channels')} />}
  </>

  return (
    <div id="container">
      <div className="signed-in">
        <div id="content">
          <div style={{ height: '100%' }}>
            <div id="messaging-content" className="tab-content" style={{ display: mainTab === 'pushing' || mainTab === 'sms' ? 'block' : 'none' }}>
              <div id="messaging-content-left">{renderTargetRows()}</div>
              <div id="messaging-content-right">
                {mainTab === 'pushing' ? <div id="push-right"><div id="push-right-top"><div id="push-chat-scroll" className="chat-scroll"><div id="push-chat-table" className="chat-table"><div id="push-chat-cell" className="chat-cell"><ClassicPushHistory state={state} target={target} /></div></div></div></div>{target?.channelIden ? <div id="push-right-bottom" /> : <ClassicPushComposer state={state} target={target} onStateChange={setState} />}</div> : <ClassicSmsPanel state={state} target={target} onStateChange={setState} />}
                <div id="drop-zone" className="drop-zone"><img id="drop-zone-image" className="drop-zone-image" src={asset('upload.png')} alt="" /></div>
                <div id="messaging-banner" />
              </div>
              <div id="messaging-top"><div id="push-top" style={{ height: '100%', display: mainTab === 'pushing' ? 'block' : 'none' }}><div style={{ margin: '0 120px', height: '100%' }}><div className="tabs"><span id="friends-tab" className={`tab top-tab${pushTab === 'friends' ? ' selected' : ''}`} onClick={() => selectPushTab('friends')}>Friends</span><span id="me-tab" className={`tab top-tab${pushTab === 'me' ? ' selected' : ''}`} onClick={() => selectPushTab('me')}>Me</span><span id="following-tab" className={`tab top-tab${pushTab === 'following' ? ' selected' : ''}`} onClick={() => selectPushTab('following')}>Following</span></div></div></div><div id="sms-top" style={{ height: '100%', display: mainTab === 'sms' ? 'block' : 'none' }} /></div>
            </div>
             <div id="notifications-content" className="tab-content" style={{ display: mainTab === 'notifications' ? 'block' : 'none' }}><div id="notifications-top"><div id="snooze-holder" onClick={() => void toggleSnooze()}>{state.settings.snoozedUntil > Date.now() ? 'Wake' : 'Snooze'}</div></div><div id="notifications-holder">{Object.values(state.notifications).map((notification) => <ClassicNotification key={notification.key} state={state} keyName={notification.key} title={notification.title} message={notification.message} url={notification.url} chatEmail={notification.chatEmail} onStateChange={setState} />)}</div><div id="notifications-empty" style={{ display: Object.keys(state.notifications).length ? 'none' : 'block' }}><div id="notifications-empty-text">No notifications.</div></div></div>
             <div id="account-content" className="tab-content" style={{ display: mainTab === 'account' ? 'block' : 'none' }}><div id="account-top"><div style={{ padding: '20px' }}><div id="account-holder"><img id="account-image" src={user.imageUrl || asset('chip_person.png')} alt="" /><img id="ribbon" style={{ display: user.pro ? 'block' : 'none' }} src={asset('ribbon.png')} alt="" /></div><div style={{ marginTop: '10px' }}><span id="account-email">{user.email}</span></div></div></div><div id="account-bottom"><div className="account-item"><a href="https://pushbullet.com/pro" target="_blank" rel="noreferrer"><span id="pushbullet-pro" className="account-item-label">Pushbullet Pro</span></a></div><div className="account-item"><a href="options.html"><i className="pushfont-gear" style={{ width: '20px' }} /><span id="settings" className="account-item-label">Settings</span></a></div><div className="account-item"><a id="sign-out-link" onClick={() => void signOut()}><i className="pushfont-close" style={{ width: '20px' }} /><span id="sign-out" className="account-item-label">Sign out</span></a></div></div></div>
          </div>
          <div style={{ position: 'absolute', top: '6px', left: '10px' }}><a href="https://www.pushbullet.com" target="_blank" rel="noreferrer"><img src={asset('icon.png')} height="36" width="36" alt="Pushbullet" /></a></div>
        </div>
         <div id="footer"><div style={{ margin: '0 60px', height: '100%' }}><div className="tabs"><ClassicFooterTab id="pushing-tab" icon="pushfont-bubble" label="Pushing" selected={mainTab === 'pushing'} onClick={() => selectMainTab('pushing')} /><ClassicFooterTab id="sms-tab" icon="pushfont-message" label="SMS" selected={mainTab === 'sms'} onClick={() => selectMainTab('sms')} /><ClassicFooterTab id="notifications-tab" icon="pushfont-bell" label="Notifications" selected={mainTab === 'notifications'} onClick={() => selectMainTab('notifications')} /><ClassicFooterTab id="account-tab" icon="pushfont-circle" label="Account" selected={mainTab === 'account'} onClick={() => selectMainTab('account')} /></div></div></div>
        <input type="file" id="file-input" name="upload" style={{ display: 'none' }} />
         <div id="popout-holder" style={{ display: isPopout ? 'none' : undefined }} onClick={() => void chrome.windows.create({ url: chrome.runtime.getURL('classic-pages/panel.html#popout'), type: 'popup', width: 630, height: 520 })}><i className="pushfont-popout" /></div>
      </div>
    </div>
  )
}

function ClassicFooterTab({ id, icon, label, selected, onClick }: { id: string; icon: string; label: string; selected: boolean; onClick: () => void }) {
  return <div id={id} className={`tab${selected ? ' selected' : ''}`} onClick={onClick}><i className={`tab-icon ${icon}`} /><span className="tab-label">{label}</span></div>
}
