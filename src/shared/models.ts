export type EntityMap<T> = Record<string, T>

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export type ExtensionUser = {
  iden?: string
  email?: string
  emailNormalized?: string
  name?: string
  imageUrl?: string
  pro?: boolean
  replyCountQuota?: number | string
} | null

export type Device = {
  iden: string
  nickname?: string
  model?: string
  manufacturer?: string
  type?: string
  icon?: string
  active?: boolean
  pushable?: boolean
  hasSms?: boolean
  hasMms?: boolean
  appVersion?: number
  created?: number
}

export type Chat = {
  iden: string
  active?: boolean
  with?: {
    email?: string
    emailNormalized?: string
    name?: string
    imageUrl?: string
  }
}

export type Subscription = {
  iden: string
  active?: boolean
  channel?: {
    iden?: string
    name?: string
    tag?: string
    imageUrl?: string
  }
}

export type Push = {
  iden: string
  type?: string
  title?: string
  body?: string
  url?: string
  fileName?: string
  fileType?: string
  fileUrl?: string
  direction?: 'self' | 'incoming' | 'outgoing' | string
  senderEmailNormalized?: string
  receiverEmailNormalized?: string
  sourceDeviceIden?: string
  targetDeviceIden?: string
  deviceIden?: string
  streamDeviceIden?: string
  channelIden?: string
  clientIden?: string
  channelTag?: string
  mirror?: MirrorDetails
  created?: number
  modified?: number
  dismissed?: boolean
  active?: boolean
}

export type MirrorDetails = {
  iden?: string
  sourceUserIden?: string
  applicationName?: string
  title?: string
  body?: string
  packageName?: string
  notificationId?: string
  notificationTag?: string
  sourceDeviceIden?: string
  conversationIden?: string
  icon?: string
  image?: string
  actions?: Array<{ label: string; id?: string }>
}

export function mirrorIdentity(mirror: MirrorDetails | undefined, iden?: string): string {
  return iden || [
    mirror?.packageName || 'mirror',
    mirror?.notificationTag || 'null',
    mirror?.notificationId || 'notification',
    mirror?.conversationIden || ''
  ].join('_')
}

export type PushDraft = {
  type: 'note' | 'link'
  title?: string
  body?: string
  url?: string
  deviceIden?: string
  email?: string
  channelIden?: string
}

export type NotificationRecord = {
  key: string
  title: string
  message: string
  pushIden?: string
  chatEmail?: string
  url?: string
  mirror?: MirrorDetails
  actionId?: string
  buttons?: Array<{ title: string; actionId: string }>
  createdAt: number
}

export type SmsThread = {
  id: string
  recipients: Array<{ address: string; name?: string }>
  latest?: number
}

export type SmsMessage = {
  iden?: string
  body?: string
  direction?: 'incoming' | 'outgoing' | string
  addresses?: string[]
  timestamp?: number
  created?: number
  fileUrl?: string
  fileType?: string
  status?: string
  guid?: string
}

export type SmsSendDraft = {
  deviceIden: string
  addresses: string[]
  body?: string
  fileUrl?: string
  fileType?: string
}

export type ExtensionSettings = {
  darkMode: boolean
  openMyLinksAutomatically: boolean
  onlyShowTitles: boolean
  useDarkIcon: boolean
  playSound: boolean
  showMirrors: boolean
  showContextMenu: boolean
  notificationDuration: number
  snoozedUntil: number
  showNotificationCount: boolean
  hideSignInReminder: boolean
  allowInstantPush: boolean
  instantPushIden: string
  automaticallyAttachLink: boolean
  disableAnalytics: boolean
  needsDataApproval: boolean
}

export type ExtensionState = {
  schemaVersion: number
  installedAt: string | null
  connectionStatus: ConnectionStatus
  user: ExtensionUser
  device: Device | null
  devices: EntityMap<Device>
  chats: EntityMap<Chat>
  subscriptions: EntityMap<Subscription>
  channels: Record<string, NonNullable<Subscription['channel']>>
  grants: Record<string, unknown>
  pushes: EntityMap<Push>
  texts: Record<string, unknown>
  notifications: EntityMap<NotificationRecord>
  awake: boolean
  lastModified: number
  settings: ExtensionSettings
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  darkMode: false,
  openMyLinksAutomatically: true,
  onlyShowTitles: false,
  useDarkIcon: false,
  playSound: true,
  showMirrors: true,
  showContextMenu: true,
  notificationDuration: 0,
  snoozedUntil: 0,
  showNotificationCount: true,
  hideSignInReminder: false,
  allowInstantPush: false,
  instantPushIden: '*',
  automaticallyAttachLink: true,
  disableAnalytics: false,
  needsDataApproval: false
}

export function createDefaultState(): ExtensionState {
  return {
    schemaVersion: 2,
    installedAt: null,
    connectionStatus: 'disconnected',
    user: null,
    device: null,
    devices: {},
    chats: {},
    subscriptions: {},
    channels: {},
    grants: {},
    pushes: {},
    texts: {},
    notifications: {},
    awake: false,
    lastModified: 0,
    settings: { ...DEFAULT_SETTINGS }
  }
}
