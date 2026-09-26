const messages = {
  secureConnection: 'Secure connection',
  connectPushbullet: 'Connect Pushbullet',
  authCopy: 'Use an access token from your Pushbullet account settings. The token is validated and stored by the service worker.',
  findAccessToken: 'Find your access token',
  accessToken: 'Access token',
  pasteAccessToken: 'Paste your access token',
  connecting: 'Connecting...',
  connect: 'Connect',
  connected: 'Connected',
  disconnected: 'Disconnected.',
  disconnect: 'Disconnect',
  pasteFirst: 'Paste an access token first.',
  validating: 'Validating your access token...',
  invalidToken: 'Could not validate the access token.'
} as const

const german: Partial<Record<keyof typeof messages, string>> = {
  secureConnection: 'Sichere Verbindung',
  connectPushbullet: 'Pushbullet verbinden',
  findAccessToken: 'Zugriffstoken finden',
  accessToken: 'Zugriffstoken',
  pasteAccessToken: 'Zugriffstoken einfuegen',
  connecting: 'Verbindung wird hergestellt...',
  connect: 'Verbinden',
  connected: 'Verbunden',
  disconnected: 'Getrennt.',
  disconnect: 'Trennen'
}

export type TranslationKey = keyof typeof messages

export function t(key: TranslationKey): string {
  const language = typeof navigator === 'undefined' ? 'en' : navigator.language.toLowerCase()
  return (language.startsWith('de') ? german[key] : undefined) || messages[key]
}
