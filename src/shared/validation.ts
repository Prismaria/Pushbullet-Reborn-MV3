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
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'upload.pushbullet.com') {
    throw new Error('Pushbullet returned an invalid signed upload URL.')
  }
  return url.toString()
}

export function cleanUploadFileName(value: string): string {
  const name = value.replace(/^.*[\\/]/, '').trim() || 'file'
  return name.slice(0, 255)
}
