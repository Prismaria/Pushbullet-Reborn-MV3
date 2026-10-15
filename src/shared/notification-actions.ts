export function notificationActionIcon(actionId: string | undefined): string {
  if (!actionId) return 'action_cancel.png'
  if (actionId.startsWith('open_')) return 'action_web.png'
  if (actionId.startsWith('mute_')) return 'action_halt.png'
  if (actionId.startsWith('unmute_')) return 'action_undo.png'
  if (actionId.startsWith('done_')) return 'action_tick.png'
  return 'action_cancel.png'
}
