import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { sendExtensionMessage } from '../shared/messages'
import { LargeUploadAuthNotice } from '../shared/LargeUploadAuthNotice'
import { mirrorIconDataUrl, mirrorImageDataUrl } from '../shared/mirror-images'
import { notificationActionIcon } from '../shared/notification-actions'
import type { Chat, Device, ExtensionState, NotificationRecord, Push, Subscription } from '../shared/models'
import { uploadFileThroughPort } from '../shared/uploadClient'
import { formatUploadLimit, maxUploadBytesForUser } from '../shared/uploads'
import { validateHttpUrl } from '../shared/validation'
import { ClassicAuth } from './ClassicAuth'
import { ClassicUploadProgressBubble, type ClassicUploadProgress } from './ClassicUploadProgressBubble'
import { groupDuplicateDevicePushes, latestPushForTarget, pushGroupKey, pushMatchesTarget, pushPreview, pushTimestamp, sortTargetsByLatestPush, type ClassicPushTarget } from './push-utils'
import { useClassicState } from './useClassicState'
import { cachePanelState, INITIAL_HISTORY_GROUPS, PANEL_PREFERENCES_CACHE_KEY, readPanelPreferences } from './startup-cache'

type MainTab = 'pushing' | 'sms' | 'notifications' | 'account'
type PushTab = 'friends' | 'me' | 'following'

type ClassicTarget = ClassicPushTarget & {
  label: string
  secondary: string
  image: string
}

function asset(name: string): string {
  return `../classic-assets/${name}`
}

function classicTargets(state: ExtensionState, tab: PushTab): ClassicTarget[] {
  let targets: ClassicTarget[]
  if (tab === 'friends') {
    targets = Object.values(state.chats).flatMap((chat: Chat) => {
      const email = chat.with?.emailNormalized || chat.with?.email
      return email ? [{ id: `friend:${email}`, label: chat.with?.name || email, secondary: '', image: asset('chip_person.png'), email }] : []
    })
  } else if (tab === 'following') {
    targets = Object.values(state.subscriptions).flatMap((subscription: Subscription) => subscription.channel?.iden ? [{
      id: `channel:${subscription.channel.iden}`,
      label: subscription.channel.name || subscription.channel.tag || 'Channel',
      secondary: '',
      image: asset('chip_channel.png'),
      channelIden: subscription.channel.iden,
      channelTag: subscription.channel.tag
    }] : [])
  } else {
    targets = [
      { id: 'everything', label: 'All devices', secondary: '', image: asset('chip_everything.png') },
      ...Object.values(state.devices).filter((device) => device.active !== false && device.pushable !== false).map((device: Device) => ({
        id: `device:${device.iden}`,
        label: device.nickname || device.model || device.iden,
        secondary: '',
        image: asset(`chip_${device.icon || device.type || 'other'}.png`),
        deviceIden: device.iden
      }))
    ]
  }
  const withPreviews = targets.map((target) => ({ ...target, secondary: pushPreview(latestPushForTarget(state.pushes, target, state.settings.showSentPushesInDeviceHistory)) }))
  return sortTargetsByLatestPush(withPreviews, state.pushes, state.settings.showSentPushesInDeviceHistory)
}

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const recentDateFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const fullDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
const shortDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const ageFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function formatPushTimeDivider(timestamp: number): string {
  const date = new Date(timestamp || Date.now())
  const time = timeFormatter.format(date)
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const daysAgo = Math.round((todayStart - dateStart) / 86_400_000)
  if (daysAgo === 0) return `Today at ${time}`
  if (daysAgo === 1) return `Yesterday at ${time}`
  const dateLabel = (daysAgo < 7 ? recentDateFormatter : fullDateFormatter).format(date)
  return `${dateLabel} at ${time}`
}

function formatLastPushAge(timestamp: number): string {
  if (!timestamp) return ''
  const elapsed = Math.max(0, Date.now() - timestamp)
  if (elapsed < 5 * 60_000) return 'now'
  if (elapsed < 24 * 60 * 60_000) {
    const hours = Math.max(1, Math.round(elapsed / 3_600_000))
    return ageFormatter.format(-hours, 'hour')
  }
  if (elapsed < 7 * 24 * 60 * 60_000) {
    const days = Math.max(1, Math.round(elapsed / 86_400_000))
    return ageFormatter.format(-days, 'day')
  }
  return shortDateFormatter.format(timestamp)
}

function pushIsOnLeft(push: Push, state: ExtensionState): boolean {
  return push.direction === 'incoming'
    || Boolean(push.clientIden)
    || (push.direction === 'self' && Boolean(state.device) && push.sourceDeviceIden !== state.device?.iden)
}

function pushAvatar(state: ExtensionState, push: Push): { image: string; label: string } {
  if (push.direction === 'incoming') {
    if (push.channelIden) {
      const channel = Object.values(state.subscriptions).find((item) => item.channel?.iden === push.channelIden || item.channel?.tag === push.channelTag)?.channel
      if (channel) return { image: channel.imageUrl || asset('chip_channel.png'), label: channel.name || channel.tag || 'Channel' }
    }
    const chat = Object.values(state.chats).find((item) => item.with?.emailNormalized === push.senderEmailNormalized)
    if (chat?.with) return { image: chat.with.imageUrl || asset('chip_person.png'), label: chat.with.name || chat.with.email || 'Friend' }
  }
  if (push.direction === 'self' && push.sourceDeviceIden) {
    const device = state.devices[push.sourceDeviceIden]
    if (device) return { image: asset(`chip_${device.icon || device.type || 'other'}.png`), label: device.nickname || device.model || 'Device' }
  }
  return { image: state.user?.imageUrl || asset('chip_person.png'), label: state.user?.name || state.user?.email || 'Pushbullet' }
}

function fullHistoryUrl(target: ClassicTarget | null): string {
  if (target?.email) return `https://www.pushbullet.com/#people/${encodeURIComponent(target.email)}`
  if (target?.channelTag) return `https://www.pushbullet.com/#following/${encodeURIComponent(target.channelTag)}`
  if (target?.channelIden) return `https://www.pushbullet.com/#following/${encodeURIComponent(target.channelIden)}`
  return 'https://www.pushbullet.com/#people/me/'
}

function linkifyBody(body: string) {
  const urlPattern = /https?:\/\/[^\s<]+/gi
  const pieces: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = urlPattern.exec(body))) {
    const rawUrl = match[0]
    const trailing = rawUrl.match(/[.,!?;:)\]]+$/)?.[0] || ''
    const visibleUrl = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl
    const safeUrl = validateHttpUrl(visibleUrl)
    if (!safeUrl) continue
    if (match.index > lastIndex) pieces.push(body.slice(lastIndex, match.index))
    pieces.push(<a key={`body-link-${key++}`} href={safeUrl} target="_blank" rel="noreferrer">{visibleUrl}</a>)
    if (trailing) pieces.push(trailing)
    lastIndex = match.index + rawUrl.length
  }
  if (lastIndex < body.length) pieces.push(body.slice(lastIndex))
  return pieces.length ? pieces : body
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

function ClassicStreamRow({ target, selected, onSelect, onPopout, showDeviceId, onDeviceContextMenu }: { target: ClassicTarget; selected: boolean; onSelect: () => void; onPopout: () => void; showDeviceId: boolean; onDeviceContextMenu?: (event: MouseEvent<HTMLDivElement>) => void }) {
  return (
    <div className={`stream-row${selected ? ' selected' : ''}`} onClick={onSelect} onContextMenu={onDeviceContextMenu} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onSelect() }}>
      <img className="stream-row-image" src={target.image} alt="" title={showDeviceId ? target.deviceIden : undefined} onError={(event) => { event.currentTarget.src = asset('chip_other.png') }} />
      <div className="stream-row-content">
        <div>{target.label}</div>
        {target.secondary && <div className="secondary">{target.secondary}</div>}
      </div>
      {target.email && <span className="pop-out-stream" onClick={(event) => { event.stopPropagation(); onPopout() }}><i className="pushfont-popout" /></span>}
    </div>
  )
}

function ClassicActionRow({ image, label, onClick }: { image: string; label: string; onClick: () => void }) {
  return <div className="stream-row" onClick={onClick} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onClick() }}><img className="stream-row-image" src={image} alt="" /><div className="stream-row-content"><div>{label}</div></div></div>
}

function ClassicPushHistory({ state, target, linkOpen, uploadProgress }: { state: ExtensionState; target: ClassicTarget | null; linkOpen: boolean; uploadProgress: ClassicUploadProgress | null }) {
  const pushes = useMemo(() => Object.values(state.pushes)
    .filter((push) => pushMatchesTarget(push, target, state.settings.showSentPushesInDeviceHistory))
    .sort((first, second) => pushTimestamp(first) - pushTimestamp(second) || first.iden.localeCompare(second.iden)), [
      state.pushes,
      state.settings.showSentPushesInDeviceHistory,
      target?.id,
      target?.deviceIden,
      target?.email,
      target?.channelIden,
      target?.channelTag
    ])
  const displayGroups = useMemo(() => target?.id === 'everything'
    ? groupDuplicateDevicePushes(pushes)
    : pushes.map((push) => ({ push, destinationDeviceIdens: [] as string[] })), [pushes, target?.id])
  const [visibleCount, setVisibleCount] = useState(INITIAL_HISTORY_GROUPS)
  const showAllCachedRef = useRef(false)
  const visibleGroups = showAllCachedRef.current ? displayGroups : displayGroups.slice(-visibleCount)
  const scrollRef = useRef<HTMLDivElement>(null)
  const keepAtBottomRef = useRef(true)
  const previousTargetIdRef = useRef<string | null>(null)
  const loadingOlderRef = useRef(false)
  const olderPageAnchorRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadOlderError, setLoadOlderError] = useState('')
  const loadOlderPushes = async () => {
    if (loadingOlderRef.current) return
    if (!showAllCachedRef.current && visibleCount < displayGroups.length) {
      const element = scrollRef.current
      olderPageAnchorRef.current = element ? { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight } : null
      setVisibleCount((count) => count + INITIAL_HISTORY_GROUPS)
      return
    }
    if (!state.pushHistoryCursor) return
    showAllCachedRef.current = true
    loadingOlderRef.current = true
    const scrollElement = scrollRef.current
    olderPageAnchorRef.current = scrollElement
      ? { scrollTop: scrollElement.scrollTop, scrollHeight: scrollElement.scrollHeight }
      : null
    setLoadingOlder(true)
    setLoadOlderError('')
    try {
      const pagesBeforeRequest = state.pushHistoryLoadedPages
      const response = await sendExtensionMessage({ type: 'load_more_push_history' })
      if (!response.ok) throw new Error(response.error)
      if (response.state.pushHistoryLoadedPages <= pagesBeforeRequest) olderPageAnchorRef.current = null
    } catch (error) {
      olderPageAnchorRef.current = null
      setLoadOlderError(error instanceof Error ? error.message : 'Could not load earlier pushes.')
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }

  const scrollToBottom = () => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }

  const scheduleScrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollToBottom()
      requestAnimationFrame(scrollToBottom)
    })
  }

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element && olderPageAnchorRef.current) {
      const anchor = olderPageAnchorRef.current
      olderPageAnchorRef.current = null
      element.scrollTop = anchor.scrollTop + Math.max(0, element.scrollHeight - anchor.scrollHeight)
      keepAtBottomRef.current = false
      return
    }
    const targetChanged = previousTargetIdRef.current !== (target?.id || null)
    previousTargetIdRef.current = target?.id || null
    if (targetChanged || keepAtBottomRef.current) {
      scrollToBottom()
      keepAtBottomRef.current = true
      scheduleScrollToBottom()
    }
  }, [pushes, visibleCount, state.pushHistoryLoadedPages, uploadProgress?.fileName, uploadProgress?.progress, target?.id])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const keepPinnedToBottom = () => {
      if (keepAtBottomRef.current) scheduleScrollToBottom()
    }
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keepPinnedToBottom)
    resizeObserver?.observe(element)
    const table = element.querySelector('.chat-table')
    if (table) resizeObserver?.observe(table)
    const mutationObserver = new MutationObserver(keepPinnedToBottom)
    mutationObserver.observe(element, { childList: true, subtree: true, characterData: true })
    window.addEventListener('resize', keepPinnedToBottom)
    return () => {
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', keepPinnedToBottom)
    }
  }, [])

  const renderPushes = () => {
    return <>
      {target && <div className="push-full-history"><a href={fullHistoryUrl(target)} target="_self">See full history</a></div>}
      {loadingOlder && <div className="push-history-status" role="status">Loading earlier pushes…</div>}
      {loadOlderError && <button className="push-history-retry" type="button" onClick={() => void loadOlderPushes()}>Could not load earlier pushes. Retry</button>}
      {displayGroups.length === 0 && <div id="chat-empty-state"><div><img src={asset('bg_sam.png')} alt="" /><p>No pushes yet.</p></div></div>}
      {visibleGroups.map((group, index) => {
        const push = group.push
        const incoming = pushIsOnLeft(push, state)
        const previous = visibleGroups[index - 1]?.push
        const next = visibleGroups[index + 1]?.push
        const timestamp = pushTimestamp(push)
        const imageUrl = push.imageUrl || mirrorImageDataUrl(push.mirror?.image) || (push.fileType?.startsWith('image/') ? push.fileUrl : undefined)
        const imageHref = validateHttpUrl(push.fileUrl || '') || validateHttpUrl(imageUrl || '')
        const showAvatar = !next || pushGroupKey(next) !== pushGroupKey(push)
        const avatar = pushAvatar(state, push)
        const destinationLabels = group.destinationDeviceIdens.map((iden) => state.devices[iden]?.nickname || state.devices[iden]?.model || iden)
        const destinationTitles = group.destinationDeviceIdens.map((iden) => `${state.devices[iden]?.nickname || state.devices[iden]?.model || iden} (${iden})`)
        const imageScale = push.imageWidth && push.imageHeight ? Math.min(1, 192 / push.imageWidth, 192 / push.imageHeight) : 1
        const imageStyle = push.imageWidth && push.imageHeight
          ? { width: `${Math.round(push.imageWidth * imageScale)}px`, height: `${Math.round(push.imageHeight * imageScale)}px` }
          : undefined
        return <Fragment key={push.iden}>
          {(!previous || timestamp - pushTimestamp(previous) > 15 * 60_000) && <div className="chat-time-divider">{formatPushTimeDivider(timestamp)}</div>}
          <div className={`chat-row${incoming ? ' incoming' : ' outgoing'}`}>
            <div className={`chat-bubble${incoming ? ' left' : ''}`}>
              <div className="chat-bubble-contents">
                {push.title && <div className="chat-title">{push.title}</div>}
                {push.body && <div className="chat-body">{linkifyBody(push.body)}</div>}
                {imageUrl && (imageHref
                  ? <a href={imageHref} target="_blank" rel="noreferrer"><img className="chat-image" src={imageUrl} alt={push.title || push.fileName || 'Push attachment'} style={imageStyle} onLoad={() => { if (keepAtBottomRef.current) scrollToBottom() }} onError={(event) => { event.currentTarget.style.display = 'none' }} /></a>
                  : <img className="chat-image" src={imageUrl} alt={push.title || push.fileName || 'Push attachment'} style={imageStyle} onLoad={() => { if (keepAtBottomRef.current) scrollToBottom() }} onError={(event) => { event.currentTarget.style.display = 'none' }} />)}
                {!imageUrl && push.url && <a className={`chat-url${incoming ? ' left' : ''}`} href={push.url} target="_blank" rel="noreferrer">{push.url}</a>}
                {!imageUrl && !push.url && push.fileUrl && <a className={`chat-url${incoming ? ' left' : ''}`} href={push.fileUrl} target="_blank" rel="noreferrer">{push.fileName || 'Open attachment'}</a>}
                {destinationLabels.length > 1 && <div className="chat-deduplicated-targets" title={destinationTitles.join(', ')}>Sent to {destinationLabels.join(', ')}</div>}
              </div>
            </div>
            {showAvatar && <img className={`chat-thumbnail${incoming ? ' left' : ''}`} src={avatar.image} title={avatar.label} alt="" onError={(event) => { event.currentTarget.src = asset('chip_other.png') }} />}
          </div>
        </Fragment>
      })}
      {uploadProgress && <ClassicUploadProgressBubble upload={uploadProgress} />}
      {displayGroups.length > 0 && <div className="chat-date" style={{ textAlign: pushIsOnLeft(displayGroups[displayGroups.length - 1].push, state) ? 'left' : 'right', margin: '0 50px' }}>{formatLastPushAge(pushTimestamp(displayGroups[displayGroups.length - 1].push))}</div>}
    </>
  }

  return <div id="push-right-top" className={linkOpen ? 'with-link' : undefined}><div id="push-chat-scroll" className="chat-scroll" ref={scrollRef} onScroll={(event) => {
    const element = event.currentTarget
    keepAtBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 24
    if (element.scrollTop <= 24 && ((!showAllCachedRef.current && visibleCount < displayGroups.length) || state.pushHistoryCursor)) void loadOlderPushes()
  }}><div id="push-chat-table" className="chat-table"><div id="push-chat-cell" className="chat-cell">{renderPushes()}</div></div></div></div>
}

function ClassicPushComposer({ state, target, onStateChange, onLinkOpenChange, onUploadProgress, droppedFile, onDroppedFileHandled }: { state: ExtensionState; target: ClassicTarget | null; onStateChange: (state: ExtensionState) => void; onLinkOpenChange: (open: boolean) => void; onUploadProgress: (fileName: string, progress: number | null) => void; droppedFile: File | null; onDroppedFileHandled: () => void }) {
  const maxUploadBytes = maxUploadBytesForUser(state.user)
  const [body, setBody] = useState('')
  const [linkOpen, setLinkOpenState] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [cancelUpload, setCancelUpload] = useState<(() => void) | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const setLinkOpen = (open: boolean) => {
    setLinkOpenState(open)
    onLinkOpenChange(open)
  }

  const attachLink = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      const tab = tabs[0]
      if (!tab?.url || !/^https?:/i.test(tab.url)) {
        setLinkOpen(false)
        setTitle('')
        setUrl('')
        setStatus('')
        return
      }
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

  const chooseFile = async (next: File | undefined) => {
    if (!next || busy || !target) return
    if (next.size < 1 || next.size > maxUploadBytes) {
      setStatus(`Files must be smaller than ${formatUploadLimit(maxUploadBytes)}.`)
      return
    }
    setBusy(true)
    setStatus('Preparing upload...')
    onUploadProgress(next.name, 0)
    try {
      const response = await uploadFileThroughPort(next, {
        maxUploadBytes,
        target: { deviceIden: target.deviceIden, email: target.email, channelIden: target.channelIden }
      }, (progress) => { setStatus(`Uploading ${progress}%...`); onUploadProgress(next.name, progress) }, (cancel) => setCancelUpload(() => cancel))
      setStatus(`${next.name} sent.`)
      onStateChange(response)
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not send the file.')
    } finally {
      setCancelUpload(null)
      onUploadProgress(next.name, null)
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!droppedFile) return
    chooseFile(droppedFile)
    onDroppedFileHandled()
  }, [droppedFile])

  const send = async () => {
    if (!target) return
    if (linkOpen && !url.trim()) {
      setStatus('Add a link first.')
      return
    }
    if (!linkOpen && !body.trim()) {
      setStatus('Write a message first.')
      return
    }
    setBusy(true)
    try {
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
      onLinkOpenChange(false)
      onStateChange(response.state)
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not send the push.')
    } finally {
      setCancelUpload(null)
      setBusy(false)
    }
  }

  const sendOrChooseFile = () => {
    if (busy) return
    if (!body.trim() && !linkOpen) {
      fileInputRef.current?.click()
      return
    }
    void send()
  }

  return (
    <div id="push-right-bottom">
      <div style={{ clear: 'both' }} />
      <div id="push-send-holder" onClick={sendOrChooseFile} role="button" tabIndex={0} aria-label={!body.trim() && !linkOpen ? 'Attach a file' : 'Send push'} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); sendOrChooseFile() } }}><i id="push-send-icon" className={!body.trim() && !linkOpen ? 'pushfont-paperclip' : 'pushfont-send'} /></div>
      <div style={{ marginRight: '52px' }}>
        {linkOpen && <div id="push-link-holder" style={{ display: 'block' }}>
          <div id="push-link-favicon-holder"><img id="push-link-favicon" src={asset('link.png')} alt="" /></div>
          <div id="push-link-details"><input id="push-link-title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} /><input id="push-link-url" type="text" value={url} onChange={(event) => setUrl(event.target.value)} /><i id="push-link-close" className="pushfont-close" onClick={() => setLinkOpen(false)} /></div>
        </div>}
        <div>
          <div id="push-add-link" className={linkOpen ? 'with-link' : ''} onClick={() => void attachLink()}><i className="pushfont-linkpip" /></div>
          <div id="push-input-holder"><textarea id="push-input" tabIndex={1} value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} disabled={busy} placeholder={status || 'Write a push...'} onPaste={(event) => { if (event.clipboardData.files[0]) { event.preventDefault(); chooseFile(event.clipboardData.files[0]) } }} /></div>
        </div>
        {cancelUpload && <button type="button" onClick={cancelUpload}>Cancel</button>}
        <input ref={fileInputRef} id="classic-push-file" type="file" style={{ display: 'none' }} onChange={(event) => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = '' }} disabled={busy} />
      </div>
    </div>
  )
}

function ClassicSmsPanel({ state, target, onStateChange, droppedFile, onDroppedFileHandled }: { state: ExtensionState; target: ClassicTarget | null; onStateChange: (state: ExtensionState) => void; droppedFile: File | null; onDroppedFileHandled: () => void }) {
  const maxUploadBytes = maxUploadBytesForUser(state.user)
  type ClassicSmsLine = { iden?: string; body?: string; direction?: string; created?: number; timestamp?: number; status?: string }
  const [threads, setThreads] = useState<Array<{ id: string; recipients: Array<{ address: string; name?: string }> }>>([])
  const [threadId, setThreadId] = useState('')
  const [messages, setMessages] = useState<ClassicSmsLine[]>([])
  const [body, setBody] = useState('')
  const [status, setStatus] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [phonebook, setPhonebook] = useState<Array<{ name: string; address: string }>>([])
  const [busy, setBusy] = useState(false)
  const [cancelUpload, setCancelUpload] = useState<(() => void) | null>(null)
  const [uploadProgress, setUploadProgress] = useState<ClassicUploadProgress | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
  const device = target?.deviceIden ? state.devices[target.deviceIden] : undefined
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
    if (!body.trim()) {
      if (thread && device?.hasMms) fileInputRef.current?.click()
      else setStatus(device?.hasMms ? 'Choose a conversation before attaching MMS.' : 'This device does not support MMS attachments.')
      return
    }
    if (!target?.deviceIden || !thread) return
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

  const uploadAttachment = async (file: File | undefined) => {
    if (!file || busy) return
    if (file.size < 1 || file.size > maxUploadBytes) {
      setStatus(`Files must be smaller than ${formatUploadLimit(maxUploadBytes)}.`)
      return
    }
    const addresses = composeOpen
      ? recipient.trim() ? [recipient.trim()] : []
      : thread?.recipients.map((item) => item.address) || []
    if (!target?.deviceIden || !addresses.length || device?.hasMms !== true) {
      setStatus(device?.hasMms ? 'Choose a conversation before attaching MMS.' : 'This device does not support MMS attachments.')
      return
    }
    setBusy(true)
    setUploadProgress({ fileName: file.name, progress: 0 })
    try {
      const response = await uploadFileThroughPort(file, {
        maxUploadBytes,
        delivery: 'sms',
        target: { deviceIden: target.deviceIden },
        sms: { deviceIden: target.deviceIden, addresses, body: body.trim() || undefined }
      }, (progress) => { setStatus(`Uploading ${progress}%`); setUploadProgress({ fileName: file.name, progress }) }, (cancel) => setCancelUpload(() => cancel))
      setStatus('Attachment sent.')
      setBody('')
      onStateChange(response)
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not send the attachment.')
    } finally {
      setCancelUpload(null)
      setUploadProgress(null)
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!droppedFile) return
    void uploadAttachment(droppedFile)
    onDroppedFileHandled()
  }, [droppedFile])

  return (
    <div id="sms-right">
      {!target?.deviceIden && <div id="sms-no-devices"><div id="sms-no-devices-text">Select an SMS-capable device.</div></div>}
      {target?.deviceIden && <>
         <div id="sms-right-top" className={thread ? 'with-input' : ''}>
           <div className="classic-sms-picker"><button type="button" onClick={() => setComposeOpen(true)}>New SMS</button><select id="sms-device-picker" value={threadId} onChange={(event) => { setComposeOpen(false); setThreadId(event.target.value) }}><option value="">Choose a conversation</option>{threads.map((item) => <option key={item.id} value={item.id}>{item.recipients.map((recipient) => recipient.name || recipient.address).join(', ')}</option>)}</select></div>
            {!composeOpen && <div id="sms-chat-scroll" className="chat-scroll"><div id="sms-chat-table" className="chat-table"><div id="sms-chat-cell" className="chat-cell">{displayedMessages.map((message, index) => <div className={`chat-row${message.direction === 'incoming' ? '' : ' outgoing'}`} key={message.iden || `${message.created || message.timestamp || index}`}><div className={`chat-bubble${message.direction === 'incoming' ? ' left sms' : ''}`}><div className="chat-bubble-contents"><div className="chat-body">{message.body}</div>{message.status && message.status !== 'sent' && <div className="chat-status">{message.status}</div>}</div></div></div>)}{uploadProgress && <ClassicUploadProgressBubble upload={uploadProgress} />}</div></div></div>}
         </div>
          {composeOpen ? <div id="sms-compose-right"><div id="compose-recipient-picker-label" className="picker-label">Recipient</div><input id="compose-recipient" type="tel" value={recipient} onChange={(event) => setRecipient(event.target.value)} list="classic-phonebook" placeholder="Phone number" /><datalist id="classic-phonebook">{phonebook.map((contact) => <option key={contact.address} value={contact.address}>{contact.name}</option>)}</datalist><div id="compose-input-holder"><div id="compose-send-holder" onClick={() => void sendNewSms()} role="button" tabIndex={0}><i className="pushfont-send" /></div><div id="compose-message-holder"><textarea id="compose-message" tabIndex={2} value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendNewSms() } }} placeholder={status || 'Write an SMS...'} /></div></div></div> : thread && <div id="sms-right-bottom"><div id="sms-send-holder" onClick={() => void send()} role="button" tabIndex={0} aria-label={!body.trim() ? 'Attach MMS' : 'Send SMS'}><i id="sms-send-icon" className={!body.trim() ? 'pushfont-paperclip' : 'pushfont-send'} /></div><div style={{ marginRight: '52px' }}><div id="sms-input-holder"><textarea id="sms-input" tabIndex={1} value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={status || 'Write an SMS...'} disabled={busy} /></div></div>{cancelUpload && <button type="button" onClick={cancelUpload}>Cancel</button>}<input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(event) => { void uploadAttachment(event.target.files?.[0]); event.currentTarget.value = '' }} disabled={busy} /></div>}
       </>}
    </div>
  )
}

function ClassicNotification({ notification, onStateChange, onDismiss }: { notification: NotificationRecord; onStateChange: (state: ExtensionState) => void; onDismiss: (active?: boolean) => void }) {
  const clear = async () => {
    const response = await sendExtensionMessage({ type: 'clear_notification', key: notification.key })
    if (response.ok) onStateChange(response.state)
  }

  const dismiss = async () => {
    onDismiss()
    await new Promise((resolve) => window.setTimeout(resolve, 240))
    const response = await sendExtensionMessage({ type: 'dismiss_notification', key: notification.key })
    if (response.ok) onStateChange(response.state)
    else onDismiss(false)
  }

  const open = async () => {
    if (notification.kind === 'mute_confirmation') {
      await clear()
      return
    }
    if (notification.url) await chrome.tabs.create({ url: notification.url, active: true })
    else if (notification.chatEmail) await chrome.windows.create({ url: chrome.runtime.getURL(`classic-pages/chat-window.html?mode=push&email=${encodeURIComponent(notification.chatEmail)}`), type: 'popup', width: 630, height: 520 })
    await dismiss()
  }

  const runAction = async (actionId: string) => {
    if (actionId.startsWith('open_')) {
      await open()
      return
    }
    const response = actionId.startsWith('mute_')
      ? await sendExtensionMessage({ type: 'mute_notification', key: notification.key })
        : actionId.startsWith('unmute_')
          ? await sendExtensionMessage({ type: 'unmute_notification', key: notification.key })
        : actionId.startsWith('dismiss_')
          ? (onDismiss(), await new Promise((resolve) => window.setTimeout(resolve, 240)), await sendExtensionMessage({ type: 'dismiss_notification', key: notification.key }))
          : await sendExtensionMessage({ type: 'clear_notification', key: notification.key })
    if (response.ok) onStateChange(response.state)
    else if (actionId.startsWith('dismiss_')) onDismiss(false)
  }

  const buttons = notification.buttons?.length ? notification.buttons : [{ title: 'Dismiss', actionId: `dismiss_${notification.key}` }]
  const icon = mirrorIconDataUrl(notification.mirror?.icon) || asset('icon.png')
  return <article className="fake-notification">
    <button className="fake-notification-close" type="button" aria-label="Close notification" onClick={() => void (notification.kind === 'mute_confirmation' ? clear() : dismiss())}><i className="pushfont-close" aria-hidden="true" /></button>
    <button className="fake-notification-text-holder fake-notification-bottom-border" type="button" onClick={() => void open()}>
      <span className="fake-notification-image-holder"><img className="fake-notification-image" src={icon} alt="" onError={(event) => { event.currentTarget.src = asset('icon.png') }} /></span>
      <span className="fake-notification-title">{notification.title}</span>
      <span className="fake-notification-message">{notification.message}</span>
    </button>
    {buttons.map((button) => <button className="fake-notification-button fake-notification-bottom-border" type="button" key={button.actionId} onClick={() => void runAction(button.actionId)}>
      <img className="fake-notification-button-icon" src={asset(notificationActionIcon(button.actionId))} alt="" />
      <span>{button.title}</span>
    </button>)}
  </article>
}

export function ClassicPanel({ initialState, startupState }: { initialState?: ExtensionState; startupState?: Promise<ExtensionState | undefined> } = {}) {
  const { state: loadedState, setState, loading } = useClassicState(initialState, startupState)
  const [preferences] = useState(readPanelPreferences)
  const [mainTab, setMainTab] = useState<MainTab>(preferences.mainTab)
  const [pushTab, setPushTab] = useState<PushTab>(preferences.pushTab)
  const [selectedId, setSelectedId] = useState(preferences.selectedId)
  const [pushLinkOpen, setPushLinkOpen] = useState(false)
  const [fileDragActive, setFileDragActive] = useState(false)
  const [droppedFile, setDroppedFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState<ClassicUploadProgress | null>(null)
  const [clearingNotifications, setClearingNotifications] = useState(false)
  const [dismissingNotifications, setDismissingNotifications] = useState<Set<string>>(() => new Set())
  const [deviceMenu, setDeviceMenu] = useState<{ deviceIden: string; x: number; y: number } | null>(null)
  const [copyFeedback, setCopyFeedback] = useState('')
  const deviceMenuRef = useRef<HTMLDivElement>(null)
  const deviceMenuItemRef = useRef<HTMLButtonElement>(null)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const isPopout = location.hash === '#popout'

  useEffect(() => {
    if (!loadedState) return
    if (!loadedState.user) {
      cachePanelState(loadedState)
      return
    }
    const id = window.requestIdleCallback(() => cachePanelState(loadedState), { timeout: 500 })
    return () => window.cancelIdleCallback(id)
  }, [loadedState])

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_PREFERENCES_CACHE_KEY, JSON.stringify({ mainTab, pushTab, selectedId }))
    } catch {
      // Panel preferences continue to be persisted in chrome.storage.
    }
  }, [mainTab, pushTab, selectedId])

  useLayoutEffect(() => {
    document.body.classList.toggle('signed-in', Boolean(loadedState?.user))
    document.body.classList.toggle('not-signed-in', Boolean(loadedState && !loadedState.user))
    document.body.classList.toggle('popout', isPopout)
    if (loadedState) {
      const darkMode = loadedState.settings.darkMode
      document.body.classList.toggle('darkmode', darkMode)
      document.documentElement.classList.toggle('darkmode', darkMode)
      document.documentElement.style.backgroundColor = darkMode ? '#232a2a' : '#ffffff'
      document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light'
      try {
        localStorage.setItem('classicPanelDarkMode', String(darkMode))
      } catch {
        // The early theme cache is optional.
      }
    }
  }, [isPopout, loadedState?.user, loadedState?.settings.darkMode])

  useLayoutEffect(() => {
    if (!loadedState || performance.getEntriesByName('classic-popup-ui-ready').length) return
    performance.mark('classic-popup-ui-ready')
    performance.measure('Classic popup: initial UI', 'classic-popup-react-entry', 'classic-popup-ui-ready')
    performance.measure('Classic popup: total UI', 'classic-popup-startup', 'classic-popup-ui-ready')
  }, [loadedState])

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

  useEffect(() => {
    if (!deviceMenu) return
    const dismissMenu = (event?: Event) => {
      if (event?.type === 'pointerdown' && deviceMenuRef.current?.contains(event.target as Node)) return
      setDeviceMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissMenu()
    }
    document.addEventListener('pointerdown', dismissMenu)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', dismissMenu, true)
    window.addEventListener('resize', dismissMenu)
    return () => {
      document.removeEventListener('pointerdown', dismissMenu)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', dismissMenu, true)
      window.removeEventListener('resize', dismissMenu)
    }
  }, [deviceMenu])

  useEffect(() => {
    if (deviceMenu) deviceMenuItemRef.current?.focus()
  }, [deviceMenu])

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current !== null) window.clearTimeout(copyFeedbackTimerRef.current)
  }, [])

  const targets: ClassicTarget[] = useMemo(() => {
    if (!loadedState || (mainTab !== 'pushing' && mainTab !== 'sms')) return []
    return mainTab === 'sms' ? Object.values(loadedState.devices).filter((device) => device.hasSms).map((device) => ({ id: `sms:${device.iden}`, label: device.nickname || device.model || device.iden, secondary: 'SMS', image: asset(`chip_${device.icon || device.type || 'phone'}.png`), deviceIden: device.iden })) : classicTargets(loadedState, pushTab)
  }, [mainTab, pushTab, loadedState?.devices, loadedState?.chats, loadedState?.subscriptions, loadedState?.pushes, loadedState?.settings.showSentPushesInDeviceHistory])

  if (loading && !loadedState) return <div id="container" />
  if (!loadedState) return <div id="container" />
  if (!loadedState.user) return <ClassicAuth state={loadedState} onStateChange={setState} />

  const state = loadedState
  const user = state.user
  if (!user) return <ClassicAuth state={state} onStateChange={setState} />
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

  const clearAllNotifications = async () => {
    const notificationCount = Object.keys(state.notifications).length
    if (clearingNotifications || !notificationCount) return
    setClearingNotifications(true)
    await new Promise((resolve) => window.setTimeout(resolve, 240 + (notificationCount - 1) * 60))
    try {
      const response = await sendExtensionMessage({ type: 'clear_all_notifications' })
      if (response.ok) setState(response.state)
    } catch (error) {
      console.warn('Could not clear notifications:', error)
    } finally {
      setClearingNotifications(false)
    }
  }

  const dismissNotificationWithAnimation = (key: string, active = true) => {
    if (!active) {
      setDismissingNotifications((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
      return
    }
    setDismissingNotifications((current) => new Set(current).add(key))
  }

  const selectMainTab = (tab: MainTab) => {
    setDeviceMenu(null)
    setMainTab(tab)
    setPushLinkOpen(false)
    void chrome.storage.local.set({ activePanelTab: tab, classicMainTab: tab })
  }

  const selectPushTab = (tab: PushTab) => {
    setDeviceMenu(null)
    setPushTab(tab)
    setPushLinkOpen(false)
    setSelectedId(tab === 'me' ? 'everything' : '')
    void chrome.storage.local.set({ activePushingTab: tab, classicPushTab: tab, classicSelectedId: tab === 'me' ? 'everything' : '' })
  }

  const selectTarget = (id: string) => {
    setDeviceMenu(null)
    setSelectedId(id)
    setPushLinkOpen(false)
    const legacyKey = pushTab === 'friends' ? 'lastFriendTargetId' : pushTab === 'following' ? 'lastFollowingTargetId' : 'lastMeTargetId'
    const legacyValue = pushTab === 'friends' ? id.replace(/^friend:/, '') : pushTab === 'following' ? id.replace(/^channel:/, '') : id === 'everything' ? '*' : id.replace(/^device:/, '')
    void chrome.storage.local.set({ classicSelectedId: id, ...(mainTab === 'pushing' ? { [legacyKey]: legacyValue } : {}) })
  }

  const openSite = (path: string) => {
    void chrome.tabs.create({ url: `https://www.pushbullet.com${path}` })
  }

  const handleFileDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setFileDragActive(true)
  }

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setFileDragActive(false)
    const file = event.dataTransfer.files.item(0)
    if ((mainTab === 'pushing' || mainTab === 'sms') && file) setDroppedFile(file)
  }

  const openDeviceMenu = (event: MouseEvent<HTMLDivElement>, deviceIden: string) => {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 184
    const menuHeight = 44
    setDeviceMenu({
      deviceIden,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
    })
  }

  const copyDeviceId = async () => {
    if (!deviceMenu) return
    let copied = false
    try {
      await navigator.clipboard.writeText(deviceMenu.deviceIden)
      copied = true
    } catch {
      const temporaryInput = document.createElement('textarea')
      try {
        temporaryInput.value = deviceMenu.deviceIden
        temporaryInput.setAttribute('readonly', '')
        temporaryInput.style.position = 'fixed'
        temporaryInput.style.opacity = '0'
        document.body.appendChild(temporaryInput)
        temporaryInput.select()
        copied = document.execCommand('copy')
      } catch {
        copied = false
      } finally {
        temporaryInput.remove()
      }
    }
    setDeviceMenu(null)
    setCopyFeedback(copied ? 'Device ID copied' : 'Could not copy device ID')
    if (copyFeedbackTimerRef.current !== null) window.clearTimeout(copyFeedbackTimerRef.current)
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedback('')
      copyFeedbackTimerRef.current = null
    }, 1800)
  }

  const renderTargetRows = () => <>
    {targets.map((item) => {
      const showDeviceId = mainTab === 'pushing' && pushTab === 'me' && Boolean(item.deviceIden)
      return <ClassicStreamRow key={item.id} target={item} selected={item.id === target?.id} onSelect={() => selectTarget(item.id)} onPopout={() => void openChat(item)} showDeviceId={showDeviceId} onDeviceContextMenu={showDeviceId ? (event) => openDeviceMenu(event, item.deviceIden!) : undefined} />
    })}
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
              <div id="messaging-content-right" onDragEnter={handleFileDragOver} onDragOver={handleFileDragOver} onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileDragActive(false)
              }} onDrop={handleFileDrop}>
               {mainTab === 'pushing' ? <div id="push-right"><ClassicPushHistory key={`history:${target?.id || 'none'}`} state={state} target={target} linkOpen={pushLinkOpen} uploadProgress={uploadProgress} />{target?.channelIden ? <div id="push-right-bottom" /> : <ClassicPushComposer key={`composer:${target?.id || 'none'}`} state={state} target={target} onStateChange={setState} onLinkOpenChange={setPushLinkOpen} onUploadProgress={(fileName, progress) => setUploadProgress(progress === null ? null : { fileName, progress })} droppedFile={droppedFile} onDroppedFileHandled={() => setDroppedFile(null)} />}</div> : mainTab === 'sms' ? <ClassicSmsPanel state={state} target={target} onStateChange={setState} droppedFile={droppedFile} onDroppedFileHandled={() => setDroppedFile(null)} /> : null}
                <div id="drop-zone" className="drop-zone" style={{ display: fileDragActive && (mainTab === 'pushing' || mainTab === 'sms') ? 'block' : undefined }}><img id="drop-zone-image" className="drop-zone-image" src={asset('upload.png')} alt="" /></div>
                 <div id="messaging-banner"><LargeUploadAuthNotice user={state.user} className="classic-large-upload-auth-notice" /></div>
              </div>
              <div id="messaging-top"><div id="push-top" style={{ height: '100%', display: mainTab === 'pushing' ? 'block' : 'none' }}><div style={{ margin: '0 120px', height: '100%' }}><div className="tabs"><span id="friends-tab" className={`tab top-tab${pushTab === 'friends' ? ' selected' : ''}`} onClick={() => selectPushTab('friends')}>Friends</span><span id="me-tab" className={`tab top-tab${pushTab === 'me' ? ' selected' : ''}`} onClick={() => selectPushTab('me')}>Me</span><span id="following-tab" className={`tab top-tab${pushTab === 'following' ? ' selected' : ''}`} onClick={() => selectPushTab('following')}>Following</span></div></div></div><div id="sms-top" style={{ height: '100%', display: mainTab === 'sms' ? 'block' : 'none' }} /></div>
            </div>
              <div id="notifications-content" className="tab-content" style={{ display: mainTab === 'notifications' ? 'block' : 'none' }}>{mainTab === 'notifications' && <><div id="notifications-top"><button id="snooze-holder" type="button" onClick={() => void toggleSnooze()}>{state.settings.snoozedUntil > Date.now() ? 'Wake' : 'Snooze'}</button></div><div id="notifications-holder" className={clearingNotifications ? 'notifications-clearing' : ''} aria-busy={clearingNotifications}><div className="notification-list-toolbar"><button className="notification-clear-all" type="button" aria-label="Clear all notifications" title="Clear all notifications" onClick={() => void clearAllNotifications()} disabled={!Object.keys(state.notifications).length || clearingNotifications}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h16M4 12h16M1 19h16" /></svg></button></div>{Object.values(state.notifications).sort((first, second) => second.createdAt - first.createdAt).map((notification, index) => <div className={`notification-dismiss-wrap${dismissingNotifications.has(notification.key) ? ' notification-dismissing' : ''}`} key={notification.key} style={{ transitionDelay: clearingNotifications ? `${index * 60}ms` : undefined }}><ClassicNotification notification={notification} onStateChange={setState} onDismiss={() => dismissNotificationWithAnimation(notification.key)} /></div>)}</div><div id="notifications-empty" style={{ display: Object.keys(state.notifications).length ? 'none' : 'block' }}><div id="notifications-empty-text">No notifications.</div></div></>}</div>
             <div id="account-content" className="tab-content" style={{ display: mainTab === 'account' ? 'block' : 'none' }}><div id="account-top"><div style={{ padding: '20px' }}><div id="account-holder"><img id="account-image" src={user.imageUrl || asset('chip_person.png')} alt="" /><img id="ribbon" style={{ display: user.pro ? 'block' : 'none' }} src={asset('ribbon.png')} alt="" /></div><div style={{ marginTop: '10px' }}><span id="account-email">{user.email}</span></div></div></div><div id="account-bottom"><div className="account-item"><a href="https://pushbullet.com/pro" target="_blank" rel="noreferrer"><span id="pushbullet-pro" className="account-item-label">Pushbullet Pro</span></a></div><div className="account-item"><a href="options.html"><i className="pushfont-gear" style={{ width: '20px' }} /><span id="settings" className="account-item-label">Settings</span></a></div><div className="account-item"><a id="sign-out-link" onClick={() => void signOut()}><i className="pushfont-close" style={{ width: '20px' }} /><span id="sign-out" className="account-item-label">Sign out</span></a></div></div></div>
          </div>
          <div style={{ position: 'absolute', top: '6px', left: '10px' }}><a href="https://www.pushbullet.com" target="_blank" rel="noreferrer"><img src={asset('icon.png')} height="36" width="36" alt="Pushbullet" /></a></div>
        </div>
          <div id="footer"><div style={{ margin: '0 60px', height: '100%' }}><div className="tabs"><ClassicFooterTab id="pushing-tab" icon="pushfont-bubble" label="Pushing" selected={mainTab === 'pushing'} onClick={() => selectMainTab('pushing')} /><ClassicFooterTab id="sms-tab" icon="pushfont-message" label="SMS" selected={mainTab === 'sms'} onClick={() => selectMainTab('sms')} /><ClassicFooterTab id="notifications-tab" icon="pushfont-bell" label="Notifications" selected={mainTab === 'notifications'} onClick={() => selectMainTab('notifications')} /><ClassicFooterTab id="account-tab" icon="" label="Account" selected={mainTab === 'account'} onClick={() => selectMainTab('account')} /></div></div></div>
        <input type="file" id="file-input" name="upload" style={{ display: 'none' }} />
          <div id="popout-holder" style={{ display: isPopout ? 'none' : undefined }} onClick={() => void chrome.windows.create({ url: chrome.runtime.getURL('classic-pages/panel.html#popout'), type: 'popup', width: 630, height: 520 })}><i className="pushfont-popout" /></div>
          {deviceMenu && <div ref={deviceMenuRef} className="classic-device-context-menu" role="menu" style={{ left: deviceMenu.x, top: deviceMenu.y }}>
            <button ref={deviceMenuItemRef} className="classic-device-context-menu-item" type="button" role="menuitem" onClick={() => void copyDeviceId()}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
              <span>Copy Device ID</span>
            </button>
          </div>}
          {copyFeedback && <div className="classic-device-copy-toast" role="status">{copyFeedback}</div>}
       </div>
    </div>
  )
}

function ClassicFooterTab({ id, icon, label, selected, onClick }: { id: string; icon: string; label: string; selected: boolean; onClick: () => void }) {
  return <div id={id} className={`tab${selected ? ' selected' : ''}`} onClick={onClick}>{id === 'account-tab' ? <svg className="tab-icon account-tab-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" /><path d="M0 0h24v24H0z" fill="none" /></svg> : <i className={`tab-icon ${icon}`} />}<span className="tab-label">{label}</span></div>
}
