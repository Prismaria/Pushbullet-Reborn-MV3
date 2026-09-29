export function validateHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function validateSignedUploadUrl(value: string | undefined): string {
  if (!value) throw new Error('Pushbullet did not return a signed upload URL.')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Pushbullet returned an invalid signed upload URL.')
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  const isPushbulletUploadHost = hostname === 'upload.pushbullet.com'
    || hostname === 'upload2.pushbullet.com'
    || hostname.endsWith('.upload.pushbullet.com')
  if (url.protocol !== 'https:' || !isPushbulletUploadHost || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error(`Pushbullet returned an invalid signed upload URL (${url.protocol}//${hostname}).`)
  }
  url.hostname = hostname
  if (url.port === '443') url.port = ''
  return url.toString()
}

export function cleanUploadFileName(value: string): string {
  const name = value.replace(/^.*[\\/]/, '').trim() || 'file'
  return name.slice(0, 255)
}
