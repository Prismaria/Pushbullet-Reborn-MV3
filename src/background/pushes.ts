import { apiRequest } from './api'
import { broadcastState } from './events'
import { normalizePush } from './remote'
import { readState, updateState } from './state'
import type { ExtensionState, PushDraft } from '../shared/models'
import { validateHttpUrl } from '../shared/validation'

export function validatePushUrl(url: string): string {
  const safeUrl = validateHttpUrl(url)
  if (!safeUrl) throw new Error('Only HTTP and HTTPS links can be pushed.')
  return safeUrl
}

export async function sendPush(draft: PushDraft): Promise<{ state: ExtensionState; push: unknown }> {
  const current = await readState()
  const payload: Record<string, unknown> = { type: draft.type }
  if (draft.type === 'note' && !draft.body?.trim()) throw new Error('A note needs a message.')
  if (draft.type === 'link' && !draft.url?.trim()) throw new Error('A link push needs a URL.')
  if (draft.title) payload.title = draft.title
  if (draft.body) payload.body = draft.body
  if (draft.url) payload.url = validatePushUrl(draft.url)
  if (draft.deviceIden) payload.device_iden = draft.deviceIden
  if (draft.email) payload.email = draft.email
  if (draft.channelIden) payload.channel_tag = draft.channelIden
  if (current.device?.iden) payload.source_device_iden = current.device.iden
  const response = await apiRequest<Record<string, unknown>>('/v2/pushes', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
  const push = normalizePush(response)
  if (!push) throw new Error('Pushbullet returned no push record.')
  const state = await updateState((current) => ({
    ...current,
    pushes: { ...current.pushes, [push.iden]: push },
    lastModified: Math.max(current.lastModified, push.modified || push.created || 0)
  }))
  await broadcastState(state)
  return { state, push }
}
