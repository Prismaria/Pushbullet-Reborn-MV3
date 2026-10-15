const MAX_MIRROR_IMAGE_BYTES = 512 * 1024

function detectedMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6
    && bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && (bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61)) return 'image/gif'
  if (bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50) return 'image/webp'
  return null
}

export function imageDataUrl(value: string | undefined): string | null {
  if (!value) return null
  const source = value.trim()
  if (!source) return null

  let encoded = source
  if (source.startsWith('data:')) {
    const match = source.match(/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,([\s\S]*)$/i)
    if (!match) return null
    encoded = match[1]
  }

  encoded = encoded.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!encoded || encoded.length > Math.ceil(MAX_MIRROR_IMAGE_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null
  if (encoded.length % 4 === 1) return null
  const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4)

  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return null
  }
  if (!binary.length || binary.length > MAX_MIRROR_IMAGE_BYTES) return null

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const mime = detectedMime(bytes)
  return mime ? `data:${mime};base64,${padded}` : null
}

export function mirrorIconDataUrl(value: string | undefined): string | null {
  return imageDataUrl(value)
}

export function mirrorImageDataUrl(value: string | undefined): string | null {
  return imageDataUrl(value)
}
