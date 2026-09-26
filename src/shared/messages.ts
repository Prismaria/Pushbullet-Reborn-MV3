import type {
  ExtensionSettings,
  ExtensionState,
  ExtensionUser,
  PushDraft,
  SmsSendDraft
} from './models.ts'

export type ExtensionMessage =
  | { type: 'ping' }
  | { type: 'get_state' }
  | { type: 'set_token'; token: string }
  | { type: 'sign_out' }
  | { type: 'refresh_state' }
  | { type: 'save_settings'; settings: Partial<ExtensionSettings> }
  | { type: 'send_push'; push: PushDraft }
  | { type: 'dismiss_notification'; key: string }
  | { type: 'set_snooze'; enabled: boolean }
  | { type: 'get_sms_threads'; deviceIden: string }
  | { type: 'get_sms_thread'; deviceIden: string; threadId: string }
  | { type: 'get_phonebook'; deviceIden: string }
  | { type: 'send_sms'; sms: SmsSendDraft }
  | { type: 'set_active_chat'; key: string }
  | { type: 'clear_active_chat'; key: string }

type ErrorResponse = { ok: false; error: string }
type PingResponse = { ok: true; service: 'background' } | ErrorResponse
type StateResponse = { ok: true; state: ExtensionState } | ErrorResponse
type PushResponse = { ok: true; state: ExtensionState; push: unknown } | ErrorResponse
type SmsThreadsResponse = { ok: true; threads: unknown[] } | ErrorResponse
type SmsThreadResponse = { ok: true; messages: unknown[] } | ErrorResponse
type PhonebookResponse = { ok: true; data: unknown } | ErrorResponse
type SmsResponse = { ok: true; state: ExtensionState; sms: unknown } | ErrorResponse

export type MessageResponse<TMessage extends ExtensionMessage> =
  TMessage extends { type: 'ping' } ? PingResponse
    : TMessage extends { type: 'get_state' } ? StateResponse
      : TMessage extends { type: 'set_token' } ? StateResponse
        : TMessage extends { type: 'sign_out' } ? StateResponse
            : TMessage extends { type: 'refresh_state' } ? StateResponse
              : TMessage extends { type: 'save_settings' } ? StateResponse
                : TMessage extends { type: 'send_push' } ? PushResponse
                  : TMessage extends { type: 'dismiss_notification' } ? StateResponse
                    : TMessage extends { type: 'set_snooze' } ? StateResponse
                      : TMessage extends { type: 'get_sms_threads' } ? SmsThreadsResponse
                        : TMessage extends { type: 'get_sms_thread' } ? SmsThreadResponse
                          : TMessage extends { type: 'send_sms' } ? SmsResponse
                            : TMessage extends { type: 'get_phonebook' } ? PhonebookResponse
                              : TMessage extends { type: 'set_active_chat' } ? StateResponse
                              : TMessage extends { type: 'clear_active_chat' } ? StateResponse
                                : never

export type ExtensionResponse = MessageResponse<ExtensionMessage>

const BOOLEAN_SETTING_KEYS = new Set([
  'darkMode', 'openMyLinksAutomatically', 'onlyShowTitles', 'useDarkIcon', 'playSound',
  'showMirrors', 'showContextMenu', 'showNotificationCount', 'hideSignInReminder',
  'allowInstantPush', 'automaticallyAttachLink', 'disableAnalytics', 'needsDataApproval'
])
const SETTING_KEYS = new Set([...BOOLEAN_SETTING_KEYS, 'notificationDuration', 'snoozedUntil', 'instantPushIden'])

export type StateChangedEvent = {
  type: 'state_changed'
  state: ExtensionState
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false

  const message = value as {
    type?: unknown
    token?: unknown
    settings?: unknown
    push?: unknown
    key?: unknown
    enabled?: unknown
    deviceIden?: unknown
    threadId?: unknown
    sms?: unknown
  }

  if (message.type === 'ping' || message.type === 'get_state' || message.type === 'sign_out' || message.type === 'refresh_state') {
    return true
  }
  if (message.type === 'set_token') return typeof message.token === 'string' && message.token.trim().length > 0
  if (message.type === 'send_push') {
    if (!message.push || typeof message.push !== 'object') return false
    const push = message.push as { type?: unknown; body?: unknown; title?: unknown; url?: unknown }
    return (push.type === 'note' || push.type === 'link')
      && (push.body === undefined || typeof push.body === 'string')
      && (push.title === undefined || typeof push.title === 'string')
      && (push.url === undefined || typeof push.url === 'string')
  }
  if (message.type === 'dismiss_notification') return typeof message.key === 'string' && message.key.length > 0
  if (message.type === 'set_snooze') return typeof message.enabled === 'boolean'
  if (message.type === 'get_sms_threads') return typeof message.deviceIden === 'string' && message.deviceIden.length > 0
  if (message.type === 'get_sms_thread') return typeof message.deviceIden === 'string' && typeof message.threadId === 'string' && message.threadId.length > 0
  if (message.type === 'get_phonebook') return typeof message.deviceIden === 'string' && message.deviceIden.length > 0
  if (message.type === 'send_sms') {
    if (!message.sms || typeof message.sms !== 'object') return false
    const sms = message.sms as { deviceIden?: unknown; addresses?: unknown; body?: unknown; fileUrl?: unknown; fileType?: unknown }
    return typeof sms.deviceIden === 'string'
      && Array.isArray(sms.addresses)
      && sms.addresses.every((address) => typeof address === 'string')
      && (sms.body === undefined || typeof sms.body === 'string')
      && (sms.fileUrl === undefined || typeof sms.fileUrl === 'string')
      && (sms.fileType === undefined || typeof sms.fileType === 'string')
  }
  if (message.type === 'set_active_chat' || message.type === 'clear_active_chat') return typeof message.key === 'string' && message.key.length > 0
  if (message.type !== 'save_settings' || !message.settings || typeof message.settings !== 'object' || Array.isArray(message.settings)) return false

  const settings = message.settings as Record<string, unknown>
  return Object.entries(settings).every(([key, value]) => {
    if (!SETTING_KEYS.has(key)) return false
    if (BOOLEAN_SETTING_KEYS.has(key)) return typeof value === 'boolean'
    if (key === 'instantPushIden') return typeof value === 'string'
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
  })
}

export function isStateChangedEvent(value: unknown): value is StateChangedEvent {
  return !!value && typeof value === 'object' && 'type' in value && value.type === 'state_changed' && 'state' in value
}

export async function sendExtensionMessage<TMessage extends ExtensionMessage>(message: TMessage): Promise<MessageResponse<TMessage>> {
  return new Promise<MessageResponse<TMessage>>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: MessageResponse<TMessage> | undefined) => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      if (!response) {
        reject(new Error('The extension service worker returned no response.'))
        return
      }
      resolve(response)
    })
  })
}

export function toExtensionUser(value: unknown): ExtensionUser {
  if (typeof value === 'string') {
    try {
      return toExtensionUser(JSON.parse(value))
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const user = value as Record<string, unknown>
  return {
    iden: typeof user.iden === 'string' ? user.iden : undefined,
    email: typeof user.email === 'string' ? user.email : undefined,
    emailNormalized: typeof user.email_normalized === 'string' ? user.email_normalized : undefined,
    name: typeof user.name === 'string' ? user.name : undefined,
    imageUrl: typeof user.image_url === 'string' ? user.image_url : undefined,
    pro: user.pro === true,
    replyCountQuota: typeof user.reply_count_quota === 'number' || typeof user.reply_count_quota === 'string' ? user.reply_count_quota : undefined
  }
}
