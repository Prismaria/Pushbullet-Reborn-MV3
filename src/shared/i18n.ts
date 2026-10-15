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
  invalidToken: 'Could not validate the access token.',
  largeUploadSetupTitle: 'Enable large-file uploads',
  largeUploadSetupCopy: 'Your Pushbullet account supports uploads up to {limit}. Sign in to Pushbullet in this browser to enable large-file uploads.',
  largeUploadSignIn: 'Sign in to Pushbullet',
  largeUploadCheck: 'Check again',
  largeUploadChecking: 'Checking Pushbullet sign-in...'
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
  disconnect: 'Trennen',
  largeUploadSetupTitle: 'Große Dateien aktivieren',
  largeUploadSetupCopy: 'Dein Pushbullet-Konto unterstützt Uploads bis zu {limit}. Melde dich in diesem Browser bei Pushbullet an, um große Dateien hochzuladen.',
  largeUploadSignIn: 'Bei Pushbullet anmelden',
  largeUploadCheck: 'Erneut prüfen',
  largeUploadChecking: 'Pushbullet-Anmeldung wird geprüft...'
}

export type TranslationKey = keyof typeof messages

export function t(key: TranslationKey): string {
  const language = typeof navigator === 'undefined' ? 'en' : navigator.language.toLowerCase()
  return (language.startsWith('de') ? german[key] : undefined) || messages[key]
}
