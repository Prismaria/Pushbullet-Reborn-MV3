import assert from 'node:assert/strict'
import { createDefaultState } from '../src/shared/models.ts'
import { isExtensionMessage } from '../src/shared/messages.ts'
import { readState } from '../src/background/state.ts'
import { decodeUploadChunk, encodeUploadChunk, isUploadPortMessage, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from '../src/shared/uploads.ts'
import { cleanUploadFileName, validateHttpUrl, validateSignedUploadUrl } from '../src/shared/validation.ts'
import { latestPushForTarget, pushMatchesTarget, pushPreview, sortTargetsByLatestPush } from '../src/classic/push-utils.ts'

const state = createDefaultState()
assert.equal(state.schemaVersion, 2)
assert.deepEqual(state.devices, {})
assert.equal(state.settings.playSound, true)
assert.equal(state.pushHistoryCursor, null)
assert.equal(state.pushHistoryLoadedPages, 0)

assert.equal(isExtensionMessage({ type: 'ping' }), true)
assert.equal(isExtensionMessage({ type: 'load_more_push_history' }), true)
assert.equal(isExtensionMessage({ type: 'send_push', push: { type: 'note', body: 'hello' } }), true)
assert.equal(isExtensionMessage({ type: 'send_push', push: { type: 'link', url: 'javascript:alert(1)' } }), true)
assert.equal(isExtensionMessage({ type: 'send_push', push: { type: 'note' } }), true)
assert.equal(isExtensionMessage({ type: 'set_token', token: '' }), false)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { playSound: false, notificationDuration: 5 } }), true)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { playSound: 'no' } }), false)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { unexpected: true } }), false)
assert.equal(isExtensionMessage({ type: 'set_snooze', enabled: 'yes' }), false)
assert.equal(isExtensionMessage({ type: 'dismiss_notification', key: '' }), false)

assert.equal(validateHttpUrl('https://example.com/'), 'https://example.com/')
assert.equal(validateHttpUrl('javascript:alert(1)'), null)
assert.throws(() => validateSignedUploadUrl('https://evil.example/upload'), /invalid signed upload URL/)
assert.equal(validateSignedUploadUrl('https://upload.pushbullet.com/session'), 'https://upload.pushbullet.com/session')
assert.equal(validateSignedUploadUrl('https://region.upload.pushbullet.com/session'), 'https://region.upload.pushbullet.com/session')
assert.equal(validateSignedUploadUrl('https://upload2.pushbullet.com/upload-legacy/session'), 'https://upload2.pushbullet.com/upload-legacy/session')
assert.equal(validateSignedUploadUrl('https://upload.pushbullet.com./session'), 'https://upload.pushbullet.com/session')
assert.throws(() => validateSignedUploadUrl('http://upload.pushbullet.com/session'), /invalid signed upload URL/)
assert.throws(() => validateSignedUploadUrl('https://upload.pushbullet.com.evil.example/session'), /invalid signed upload URL/)
assert.throws(() => validateSignedUploadUrl('https://api.pushbullet.com/upload/session'), /invalid signed upload URL/)
assert.equal(cleanUploadFileName('C:\\temp\\photo.jpg'), 'photo.jpg')

const buffer = new ArrayBuffer(4)
assert.equal(isUploadPortMessage({ type: 'start', fileName: 'a', mimeType: 'x', size: 4, target: {} }), true)
assert.equal(isUploadPortMessage({ type: 'chunk', buffer }), false)
const chunkBytes = Uint8Array.from([1, 2, 3, 4])
const encodedChunk = encodeUploadChunk(chunkBytes)
assert.equal(encodedChunk, 'AQIDBA==')
assert.equal(isUploadPortMessage({ type: 'chunk', data: encodedChunk, size: 4 }), true)
assert.deepEqual([...decodeUploadChunk(encodedChunk)], [1, 2, 3, 4])
assert.equal(isUploadPortMessage({ type: 'chunk', data: 'not bytes', size: 4 }), false)
assert.equal(isUploadPortMessage({ type: 'chunk', data: encodedChunk, size: 5 }), false)
assert.equal(MAX_UPLOAD_BYTES, 50 * 1024 * 1024)
assert.equal(UPLOAD_CHUNK_BYTES, 256 * 1024)

const classicPushes = {
  old: { iden: 'old', direction: 'self', sourceDeviceIden: 'phone', created: 100, url: 'https://example.com/old' },
  newest: { iden: 'newest', direction: 'self', sourceDeviceIden: 'phone', created: 200, body: 'Most recent' },
  client: { iden: 'client', direction: 'self', clientIden: 'client-id', created: 300, body: 'Not a device push' }
}
const everythingTarget = { id: 'everything' }
const phoneTarget = { id: 'device:phone', deviceIden: 'phone' }
assert.equal(pushMatchesTarget(classicPushes.client, everythingTarget), false)
assert.equal(latestPushForTarget(classicPushes, everythingTarget)?.iden, 'newest')
assert.equal(latestPushForTarget(classicPushes, phoneTarget)?.iden, 'newest')
assert.equal(pushPreview(classicPushes.old), 'https://example.com/old')
assert.deepEqual(sortTargetsByLatestPush([
  { id: 'device:quiet', label: 'Quiet', deviceIden: 'quiet' },
  phoneTarget,
  everythingTarget
], classicPushes).map((target) => target.id), ['everything', 'device:phone', 'device:quiet'])

const legacyStorage = {
  user: { iden: 'legacy-user', email: 'legacy@example.com', email_normalized: 'legacy@example.com', image_url: 'https://example.com/profile.png' },
  devices: [{ iden: 'legacy-device', nickname: 'Legacy phone', has_sms: true, has_mms: true }],
  pushes: [{ iden: 'legacy-image', type: 'file', image_url: 'https://example.com/photo.jpg', image_width: 800, image_height: 600, file_type: 'image/jpeg' }],
  settings: { playSound: false }
}
const extensionStorage = {}
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const names = Array.isArray(keys) ? keys : [keys]
        const source = { ...legacyStorage, ...extensionStorage }
        return Object.fromEntries(names.filter((key) => key in source).map((key) => [key, source[key]]))
      },
      async set(values) {
        Object.assign(extensionStorage, values)
      }
    },
    sync: { async get() { return {} } }
  }
}
const migrated = await readState()
assert.equal(migrated.schemaVersion, 2)
assert.equal(migrated.user?.iden, 'legacy-user')
assert.equal(migrated.user?.imageUrl, 'https://example.com/profile.png')
assert.equal(migrated.devices['legacy-device'].nickname, 'Legacy phone')
assert.equal(migrated.devices['legacy-device'].hasSms, true)
assert.equal(migrated.devices['legacy-device'].hasMms, true)
assert.equal(migrated.pushes['legacy-image'].imageUrl, 'https://example.com/photo.jpg')
assert.equal(migrated.pushes['legacy-image'].imageWidth, 800)
assert.equal(migrated.pushes['legacy-image'].fileType, 'image/jpeg')
assert.equal(migrated.settings.playSound, false)
assert.ok(extensionStorage.extensionState)
const reloaded = await readState()
assert.equal(reloaded.user?.imageUrl, 'https://example.com/profile.png')
assert.equal(reloaded.user?.emailNormalized, 'legacy@example.com')

console.log('Unit contract smoke test passed.')
