import type { ExtensionState } from '../shared/models'
import { readState, updateState } from './state'

export async function broadcastState(state: ExtensionState): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'state_changed', state })
  } catch {
    // There may be no open extension page. That is normal for a worker event.
  }
}

export async function setConnectionStatus(status: ExtensionState['connectionStatus']): Promise<ExtensionState> {
  const current = await readState()
  if (current.connectionStatus === status) return current
  const next = await updateState((state) => ({ ...state, connectionStatus: status }))
  await broadcastState(next)
  return next
}
