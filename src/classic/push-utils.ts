import type { EntityMap, Push } from '../shared/models'

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

export function pushMatchesTarget(push: Push, target: ClassicPushTarget | null): boolean {
  if (!target) return false
  if (target.id === 'everything') {
    return (push.direction === 'self' && !push.clientIden)
      || (!push.direction && !push.email && !push.channelTag)
  }
  if (target.deviceIden) {
    return (push.direction === 'self' && !push.clientIden && (
      push.sourceDeviceIden === target.deviceIden
      || push.streamDeviceIden === target.deviceIden
      || push.targetDeviceIden === target.deviceIden
    )) || (!push.direction && !push.email && !push.channelTag && push.deviceIden === target.deviceIden)
  }
  if (target.email) {
    return push.senderEmailNormalized === target.email
      || push.receiverEmailNormalized === target.email
      || push.email === target.email
  }
  if (target.channelIden) return push.channelIden === target.channelIden || push.channelTag === target.channelTag
  return false
}

export function latestPushForTarget(pushes: EntityMap<Push> | Push[], target: ClassicPushTarget): Push | undefined {
  const values = Array.isArray(pushes) ? pushes : Object.values(pushes)
  return values
    .filter((push) => pushMatchesTarget(push, target))
    .reduce<Push | undefined>((latest, push) => !latest || pushTimestamp(push) > pushTimestamp(latest) ? push : latest, undefined)
}

export function pushPreview(push: Push | undefined): string {
  return push?.title || push?.body || push?.url || push?.fileName || ''
}

export function sortTargetsByLatestPush<T extends ClassicPushTarget & { label: string }>(targets: T[], pushes: EntityMap<Push>): T[] {
  const latestByTarget = new Map(targets.map((target) => [target.id, latestPushForTarget(pushes, target)]))
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
