import type { EntityMap, Push } from '../shared/models'
import { pushMatchesDevice } from '../shared/push-history.ts'

export const DUPLICATE_PUSH_WINDOW_MS = 5_000

export type PushDisplayGroup = {
  push: Push
  destinationDeviceIdens: string[]
}

type MutablePushDisplayGroup = {
  pushes: Push[]
  destinationDeviceIdens: Set<string>
  sourceDeviceIden: string
  contentKey: string
  firstTimestamp: number
  lastTimestamp: number
}

export type ClassicPushTarget = {
  id: string
  deviceIden?: string
  email?: string
  channelIden?: string
  channelTag?: string
}

export function pushTimestamp(push: Push): number {
  const timestamp = push.created || push.modified || 0
  return timestamp > 0 && timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
}

function normalizeDuplicateText(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function duplicateContentKey(push: Push): string | null {
  const mirror = push.mirror
  // Mirrored icons and images are presentation payloads and can be large base64 strings.
  const content = [
    push.title,
    push.body,
    push.url,
    push.fileName,
    push.fileType,
    push.fileUrl,
    push.imageUrl,
    mirror?.applicationName,
    mirror?.title,
    mirror?.body,
    mirror?.packageName,
    mirror?.notificationId,
    mirror?.notificationTag,
    mirror?.conversationIden
  ].map(normalizeDuplicateText)
  if (!content.some(Boolean)) return null
  return JSON.stringify([
    push.type || '',
    ...content,
    (mirror?.actions || []).map((action) => [normalizeDuplicateText(action.label), normalizeDuplicateText(action.id)])
  ])
}

/**
 * Collapses same-source, same-content device deliveries in the All devices
 * history. A destination must be known and unique within a group so repeated
 * pushes to the same device remain visible.
 */
export function groupDuplicateDevicePushes(pushes: Push[], windowMs = DUPLICATE_PUSH_WINDOW_MS): PushDisplayGroup[] {
  const groups: MutablePushDisplayGroup[] = []
  const sorted = [...pushes].sort((first, second) => pushTimestamp(first) - pushTimestamp(second) || first.iden.localeCompare(second.iden))

  for (const push of sorted) {
    const sourceDeviceIden = push.sourceDeviceIden
    const destinationDeviceIden = push.targetDeviceIden || push.deviceIden
    const timestamp = pushTimestamp(push)
    const contentKey = duplicateContentKey(push)
    const isDevicePush = push.direction === 'self' || (!push.direction && !push.email && !push.channelTag)
    if (!isDevicePush || push.clientIden || !sourceDeviceIden || !destinationDeviceIden || !timestamp || !contentKey) {
      groups.push({
        pushes: [push],
        destinationDeviceIdens: new Set(destinationDeviceIden ? [destinationDeviceIden] : []),
        sourceDeviceIden: '',
        contentKey: '',
        firstTimestamp: timestamp,
        lastTimestamp: timestamp
      })
      continue
    }

    let matchingGroup: MutablePushDisplayGroup | undefined
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const candidate = groups[index]
      if (timestamp - candidate.firstTimestamp > windowMs) break
      if (candidate.contentKey !== contentKey || candidate.sourceDeviceIden !== sourceDeviceIden || candidate.destinationDeviceIdens.has(destinationDeviceIden)) continue
      if (!matchingGroup || timestamp - candidate.lastTimestamp < timestamp - matchingGroup.lastTimestamp) matchingGroup = candidate
    }

    if (matchingGroup) {
      matchingGroup.pushes.push(push)
      matchingGroup.destinationDeviceIdens.add(destinationDeviceIden)
      matchingGroup.lastTimestamp = timestamp
      continue
    }

    groups.push({
      pushes: [push],
      destinationDeviceIdens: new Set([destinationDeviceIden]),
      sourceDeviceIden,
      contentKey,
      firstTimestamp: timestamp,
      lastTimestamp: timestamp
    })
  }

  return groups.map((group) => ({
    push: group.pushes[0],
    destinationDeviceIdens: [...group.destinationDeviceIdens].sort((first, second) => first.localeCompare(second))
  }))
}

export function pushMatchesTarget(push: Push, target: ClassicPushTarget | null, showSentPushes = true): boolean {
  if (!target) return false
  if (target.id === 'everything') {
    return (push.direction === 'self' && !push.clientIden)
      || (!push.direction && !push.email && !push.channelTag)
  }
  if (target.deviceIden) {
    return pushMatchesDevice(push, target.deviceIden, showSentPushes)
  }
  if (target.email) {
    return push.senderEmailNormalized === target.email
      || push.receiverEmailNormalized === target.email
      || push.email === target.email
  }
  if (target.channelIden) return push.channelIden === target.channelIden || push.channelTag === target.channelTag
  return false
}

export function latestPushForTarget(pushes: EntityMap<Push> | Push[], target: ClassicPushTarget, showSentPushes = true): Push | undefined {
  const values = Array.isArray(pushes) ? pushes : Object.values(pushes)
  return values
    .filter((push) => pushMatchesTarget(push, target, showSentPushes))
    .reduce<Push | undefined>((latest, push) => !latest || pushTimestamp(push) > pushTimestamp(latest) ? push : latest, undefined)
}

export function pushPreview(push: Push | undefined): string {
  return push?.title || push?.body || push?.url || push?.fileName || ''
}

export function sortTargetsByLatestPush<T extends ClassicPushTarget & { label: string }>(targets: T[], pushes: EntityMap<Push>, showSentPushes = true): T[] {
  const latestByTarget = new Map(targets.map((target) => [target.id, latestPushForTarget(pushes, target, showSentPushes)]))
  return [...targets].sort((first, second) => {
    if (first.id === 'everything') return -1
    if (second.id === 'everything') return 1
    const firstLatest = latestByTarget.get(first.id)
    const secondLatest = latestByTarget.get(second.id)
    if (firstLatest && !secondLatest) return -1
    if (!firstLatest && secondLatest) return 1
    if (firstLatest && secondLatest) {
      const timeDifference = pushTimestamp(secondLatest) - pushTimestamp(firstLatest)
      if (timeDifference) return timeDifference
    }
    return first.label.localeCompare(second.label, undefined, { sensitivity: 'base' })
  })
}

export function pushGroupKey(push: Push): string {
  if (push.direction === 'incoming') return `incoming:${push.channelIden || push.senderEmailNormalized || ''}`
  if (push.direction === 'outgoing') return `outgoing:${push.receiverEmailNormalized || ''}`
  if (push.direction === 'self') {
    if (push.clientIden) return `client:${push.clientIden}`
    return `self:${push.sourceDeviceIden || ''}:${push.targetDeviceIden || ''}`
  }
  return `other:${push.email || push.channelTag || push.deviceIden || push.targetDeviceIden || ''}`
}
