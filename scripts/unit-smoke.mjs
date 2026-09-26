import assert from 'node:assert/strict'
import { createDefaultState } from '../src/shared/models.ts'
import { isExtensionMessage } from '../src/shared/messages.ts'
import { readState } from '../src/background/state.ts'
import { isUploadPortMessage, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from '../src/shared/uploads.ts'
import { cleanUploadFileName, validateHttpUrl, validateSignedUploadUrl } from '../src/shared/validation.ts'

const state = createDefaultState()
assert.equal(state.schemaVersion, 2)
assert.deepEqual(state.devices, {})
assert.equal(state.settings.playSound, true)

assert.equal(isExtensionMessage({ type: 'ping' }), true)
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
assert.equal(cleanUploadFileName('C:\\temp\\photo.jpg'), 'photo.jpg')

const buffer = new ArrayBuffer(4)
assert.equal(isUploadPortMessage({ type: 'start', fileName: 'a', mimeType: 'x', size: 4, target: {} }), true)
assert.equal(isUploadPortMessage({ type: 'chunk', buffer }), true)
assert.equal(isUploadPortMessage({ type: 'chunk', buffer: 'not bytes' }), false)
assert.equal(MAX_UPLOAD_BYTES, 50 * 1024 * 1024)
assert.equal(UPLOAD_CHUNK_BYTES, 256 * 1024)

const legacyStorage = {
  user: { iden: 'legacy-user', email: 'legacy@example.com' },
  devices: [{ iden: 'legacy-device', nickname: 'Legacy phone', has_sms: true, has_mms: true }],
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
assert.equal(migrated.devices['legacy-device'].nickname, 'Legacy phone')
assert.equal(migrated.devices['legacy-device'].hasSms, true)
assert.equal(migrated.devices['legacy-device'].hasMms, true)
assert.equal(migrated.settings.playSound, false)
assert.ok(extensionStorage.extensionState)

console.log('Unit contract smoke test passed.')
