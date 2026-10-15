import type { ExtensionState } from '../shared/models'
import { pushMatchesTarget, pushTimestamp, type ClassicPushTarget } from './push-utils.ts'

export const PANEL_STATE_CACHE_KEY = 'classicPanelStateV1'
export const PANEL_PREFERENCES_CACHE_KEY = 'classicPanelPreferencesV1'
export const INITIAL_HISTORY_GROUPS = 24

export type PanelPreferences = {
  mainTab: 'pushing' | 'sms' | 'notifications' | 'account'
  pushTab: 'friends' | 'me' | 'following'
  selectedId: string
}

export function readPanelPreferences(): PanelPreferences {
  const defaults: PanelPreferences = { mainTab: 'pushing', pushTab: 'me', selectedId: 'everything' }
  try {
    const cached = JSON.parse(localStorage.getItem(PANEL_PREFERENCES_CACHE_KEY) || 'null') as Partial<PanelPreferences> | null
    if (!cached) return defaults
    return {
      mainTab: ['pushing', 'sms', 'notifications', 'account'].includes(cached.mainTab || '') ? cached.mainTab! : defaults.mainTab,
      pushTab: ['friends', 'me', 'following'].includes(cached.pushTab || '') ? cached.pushTab! : defaults.pushTab,
      selectedId: typeof cached.selectedId === 'string' ? cached.selectedId : defaults.selectedId
    }
  } catch {
    return defaults
  }
}

/** A bounded first-frame cache; chrome.storage remains the authoritative state. */
export function cachePanelState(state: ExtensionState): void {
  try {
    if (!state.user) {
      localStorage.removeItem(PANEL_STATE_CACHE_KEY)
      return
    }
    const sortedPushes = Object.values(state.pushes).sort((first, second) => pushTimestamp(second) - pushTimestamp(first))
    const { selectedId } = readPanelPreferences()
    const target: ClassicPushTarget = { id: selectedId }
    if (selectedId.startsWith('device:')) target.deviceIden = selectedId.slice('device:'.length)
    else if (selectedId.startsWith('friend:')) target.email = selectedId.slice('friend:'.length)
    else if (selectedId.startsWith('channel:')) {
      target.channelIden = selectedId.slice('channel:'.length)
      target.channelTag = Object.values(state.subscriptions).find((subscription) => subscription.channel?.iden === target.channelIden)?.channel?.tag
    }
    // Also retain the selected stream, even when it has been quiet for a long time.
    const recent = new Map(sortedPushes.slice(0, 160).map((push) => [push.iden, push]))
    if (selectedId !== 'everything') {
      for (const push of sortedPushes.filter((push) => pushMatchesTarget(push, target, state.settings.showSentPushesInDeviceHistory)).slice(0, 48)) recent.set(push.iden, push)
    }
    const pushes = [...recent.values()]
      .map((push) => ({ ...push, mirror: push.mirror ? { ...push.mirror, icon: undefined, image: undefined } : undefined }))
    const notifications = Object.values(state.notifications)
      .sort((first, second) => second.createdAt - first.createdAt)
      .slice(0, 24)
      .map((notification) => ({ ...notification, mirror: notification.mirror ? { ...notification.mirror, icon: undefined, image: undefined } : undefined }))
    const cached = JSON.stringify({
      ...state,
      pushes: Object.fromEntries(pushes.map((push) => [push.iden, push])),
      notifications: Object.fromEntries(notifications.map((notification) => [notification.key, notification])),
      texts: {},
      grants: {},
      channels: {}
    })
    // Avoid a large synchronous parse on popup opening if a push contains oversized text.
    if (cached.length <= 256 * 1024) localStorage.setItem(PANEL_STATE_CACHE_KEY, cached)
    else localStorage.removeItem(PANEL_STATE_CACHE_KEY)
  } catch {
    // Storage failures must not prevent the live UI from opening.
  }
}
