import type { ExtensionState } from '../shared/models'

export type PopupMode = 'friends' | 'me' | 'following' | 'sms'

export type StreamTarget = {
  id: string
  label: string
  description: string
  deviceIden?: string
  email?: string
  channelIden?: string
}

export function getStreamTargets(state: ExtensionState, mode: PopupMode): StreamTarget[] {
  if (mode === 'sms') {
    return Object.values(state.devices)
      .filter((device) => device.active !== false && device.hasSms)
      .map((device) => ({
        id: device.iden,
        label: device.nickname || device.model || device.iden,
        description: 'SMS device',
        deviceIden: device.iden
      }))
  }

  if (mode === 'me') {
    return [
      { id: '*', label: 'All devices', description: 'Send to every active device' },
      ...Object.values(state.devices)
        .filter((device) => device.active !== false && device.pushable !== false)
        .sort((first, second) => (first.nickname || first.model || '').localeCompare(second.nickname || second.model || ''))
        .map((device) => ({
          id: device.iden,
          label: device.nickname || device.model || device.iden,
          description: device.type || 'Device',
          deviceIden: device.iden
        }))
    ]
  }

  if (mode === 'friends') {
    return Object.values(state.chats)
      .filter((chat) => chat.active !== false && chat.with?.emailNormalized)
      .sort((first, second) => (first.with?.name || first.with?.emailNormalized || '').localeCompare(second.with?.name || second.with?.emailNormalized || ''))
      .map((chat) => ({
        id: chat.iden,
        label: chat.with?.name || chat.with?.emailNormalized || 'Friend',
        description: chat.with?.email || chat.with?.emailNormalized || '',
        email: chat.with?.emailNormalized
      }))
  }

  return Object.values(state.subscriptions)
    .filter((subscription) => subscription.active !== false && subscription.channel?.iden)
    .map((subscription) => ({
      id: subscription.iden,
      label: subscription.channel?.name || subscription.channel?.tag || 'Channel',
      description: subscription.channel?.tag ? `#${subscription.channel.tag}` : 'Following',
      channelIden: subscription.channel?.tag || subscription.channel?.iden
    }))
}

type StreamListProps = {
  targets: StreamTarget[]
  selectedId: string
  onSelect: (target: StreamTarget) => void
}

export function StreamList({ targets, selectedId, onSelect }: StreamListProps) {
  if (!targets.length) return <div className="empty-streams">No streams available yet.</div>

  return (
    <div className="stream-list">
      {targets.map((target) => (
        <button
          className={`stream-button ${target.id === selectedId ? 'stream-button-selected' : ''}`}
          key={target.id}
          type="button"
          onClick={() => onSelect(target)}
        >
          <span className="stream-avatar">{target.label.slice(0, 1).toUpperCase()}</span>
          <span className="stream-copy">
            <strong>{target.label}</strong>
            <small>{target.description}</small>
          </span>
        </button>
      ))}
    </div>
  )
}
