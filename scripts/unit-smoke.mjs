import assert from 'node:assert/strict'
import './classic-popup-startup-smoke.mjs'
import { createDefaultState } from '../src/shared/models.ts'
import { isExtensionMessage, toExtensionUser } from '../src/shared/messages.ts'
import { readState } from '../src/background/state.ts'
import { decodeUploadChunk, DEFAULT_UPLOAD_LIMIT_BYTES, encodeUploadChunk, formatUploadLimit, isUploadPortMessage, maxUploadBytesForUser, MAX_SINGLE_POST_UPLOAD_BYTES, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from '../src/shared/uploads.ts'
import { cleanUploadFileName, validateHttpUrl, validateSignedUploadUrl } from '../src/shared/validation.ts'
import { mirrorIconDataUrl } from '../src/shared/mirror-images.ts'
import { DUPLICATE_PUSH_WINDOW_MS, groupDuplicateDevicePushes, latestPushForTarget, pushMatchesTarget, pushPreview, sortTargetsByLatestPush } from '../src/classic/push-utils.ts'
import { cachePanelState, PANEL_PREFERENCES_CACHE_KEY, PANEL_STATE_CACHE_KEY } from '../src/classic/startup-cache.ts'

const state = createDefaultState()
assert.equal(state.schemaVersion, 2)
assert.deepEqual(state.devices, {})
assert.equal(state.settings.playSound, true)
assert.equal(state.settings.dismissMirrorsOnClearAll, true)
assert.equal(state.settings.useGreenNotificationBadge, false)
assert.equal(state.settings.showSentPushesInDeviceHistory, true)
assert.equal(state.pushHistoryCursor, null)
assert.equal(state.pushHistoryLoadedPages, 0)

const panelCache = new Map()
globalThis.localStorage = {
  getItem: (key) => panelCache.get(key) ?? null,
  setItem: (key, value) => panelCache.set(key, value),
  removeItem: (key) => panelCache.delete(key)
}
const largeHistoryState = {
  ...state,
  user: { email: 'cache@example.com' },
  pushes: Object.fromEntries(Array.from({ length: 500 }, (_, index) => [String(index), {
    iden: String(index), created: 1_700_000_000 + index, body: `Event ${index}`,
    mirror: { packageName: 'example.app', icon: 'x'.repeat(64 * 1024), image: 'x'.repeat(64 * 1024) }
  }]))
}
cachePanelState(largeHistoryState)
const cachedPanelState = JSON.parse(panelCache.get(PANEL_STATE_CACHE_KEY))
assert.equal(Object.keys(cachedPanelState.pushes).length, 160)
assert.equal(cachedPanelState.pushes['499'].body, 'Event 499')
assert.equal(cachedPanelState.pushes['499'].mirror.image, undefined)
assert.equal(largeHistoryState.pushes['499'].mirror.image.length, 64 * 1024)
assert.ok(panelCache.get(PANEL_STATE_CACHE_KEY).length < 256 * 1024)
panelCache.set(PANEL_PREFERENCES_CACHE_KEY, JSON.stringify({ mainTab: 'pushing', pushTab: 'me', selectedId: 'device:quiet' }))
cachePanelState({
  ...largeHistoryState,
  pushes: { ...largeHistoryState.pushes, quiet: { iden: 'quiet', created: 1_600_000_000, direction: 'self', targetDeviceIden: 'quiet', body: 'Older selected-stream push' } }
})
assert.equal(JSON.parse(panelCache.get(PANEL_STATE_CACHE_KEY)).pushes.quiet.body, 'Older selected-stream push')
cachePanelState(state)
assert.equal(panelCache.has(PANEL_STATE_CACHE_KEY), false)
delete globalThis.localStorage

assert.equal(isExtensionMessage({ type: 'ping' }), true)
assert.equal(isExtensionMessage({ type: 'load_more_push_history' }), true)
assert.equal(isExtensionMessage({ type: 'send_push', push: { type: 'note', body: 'hello' } }), true)
assert.equal(isExtensionMessage({ type: 'send_push', push: { type: 'link', url: 'javascript:alert(1)' } }), true)
assert.equal(isExtensionMessage({ type: 'send_push', push: { type: 'note' } }), true)
assert.equal(isExtensionMessage({ type: 'set_token', token: '' }), false)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { playSound: false, notificationDuration: 5 } }), true)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { dismissMirrorsOnClearAll: false } }), true)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { useGreenNotificationBadge: true } }), true)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { showSentPushesInDeviceHistory: false } }), true)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { showSentPushesInDeviceHistory: 'false' } }), false)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { playSound: 'no' } }), false)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { dismissMirrorsOnClearAll: 'yes' } }), false)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { useGreenNotificationBadge: 'yes' } }), false)
assert.equal(isExtensionMessage({ type: 'save_settings', settings: { unexpected: true } }), false)
assert.equal(isExtensionMessage({ type: 'set_snooze', enabled: 'yes' }), false)
assert.equal(isExtensionMessage({ type: 'dismiss_notification', key: '' }), false)
assert.equal(isExtensionMessage({ type: 'clear_notification', key: 'push_1' }), true)
assert.equal(isExtensionMessage({ type: 'clear_all_notifications' }), true)
assert.equal(isExtensionMessage({ type: 'mute_notification', key: 'mirror_1' }), true)
assert.equal(isExtensionMessage({ type: 'unmute_notification', key: 'mirror_1' }), true)

const testIcon = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
assert.equal(mirrorIconDataUrl(testIcon), `data:image/png;base64,${testIcon}`)
assert.equal(mirrorIconDataUrl('https://example.com/icon.png'), null)
assert.equal(mirrorIconDataUrl('not-an-image'), null)

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
assert.equal(MAX_UPLOAD_BYTES, 1024 * 1024 * 1024)
assert.equal(MAX_SINGLE_POST_UPLOAD_BYTES, DEFAULT_UPLOAD_LIMIT_BYTES)
assert.equal(DEFAULT_UPLOAD_LIMIT_BYTES, 25 * 1024 * 1024)
assert.equal(maxUploadBytesForUser(toExtensionUser({ max_upload_size: DEFAULT_UPLOAD_LIMIT_BYTES })), DEFAULT_UPLOAD_LIMIT_BYTES)
assert.equal(maxUploadBytesForUser(toExtensionUser({ max_upload_size: MAX_UPLOAD_BYTES })), MAX_UPLOAD_BYTES)
assert.equal(maxUploadBytesForUser(toExtensionUser({})), DEFAULT_UPLOAD_LIMIT_BYTES)
assert.equal(maxUploadBytesForUser(toExtensionUser({ max_upload_size: MAX_UPLOAD_BYTES * 2 })), MAX_UPLOAD_BYTES)
assert.equal(formatUploadLimit(DEFAULT_UPLOAD_LIMIT_BYTES), '25 MB')
assert.equal(formatUploadLimit(MAX_UPLOAD_BYTES), '1 GB')
assert.equal(UPLOAD_CHUNK_BYTES, 256 * 1024)

const classicPushes = {
  old: { iden: 'old', direction: 'self', sourceDeviceIden: 'phone', created: 100, url: 'https://example.com/old' },
  newest: { iden: 'newest', direction: 'self', sourceDeviceIden: 'phone', created: 200, body: 'Most recent' },
  phoneDelivery: { iden: 'phone-delivery', direction: 'self', sourceDeviceIden: 'chrome', targetDeviceIden: 'phone', created: 250, body: 'Only for the phone' },
  client: { iden: 'client', direction: 'self', clientIden: 'client-id', created: 300, body: 'Not a device push' }
}
const everythingTarget = { id: 'everything' }
const phoneTarget = { id: 'device:phone', deviceIden: 'phone' }
const chromeTarget = { id: 'device:chrome', deviceIden: 'chrome' }
assert.equal(pushMatchesTarget(classicPushes.client, everythingTarget), false)
assert.equal(latestPushForTarget(classicPushes, everythingTarget)?.iden, 'phone-delivery')
assert.equal(pushMatchesTarget(classicPushes.phoneDelivery, phoneTarget), true)
assert.equal(pushMatchesTarget(classicPushes.phoneDelivery, chromeTarget), true)
assert.equal(pushMatchesTarget(classicPushes.phoneDelivery, chromeTarget, false), false)
assert.equal(pushMatchesTarget(classicPushes.phoneDelivery, phoneTarget, false), true)
assert.equal(pushMatchesTarget(classicPushes.phoneDelivery, { id: 'device:other', deviceIden: 'other' }), false)
assert.equal(latestPushForTarget(classicPushes, chromeTarget)?.iden, 'phone-delivery')
assert.equal(latestPushForTarget(classicPushes, chromeTarget, false), undefined)
assert.equal(pushMatchesTarget(classicPushes.phoneDelivery, everythingTarget, false), true)
const legacyDelivery = { ...classicPushes.phoneDelivery, direction: undefined, deviceIden: 'phone', targetDeviceIden: undefined }
assert.equal(pushMatchesTarget(legacyDelivery, chromeTarget), true)
assert.equal(pushMatchesTarget(legacyDelivery, chromeTarget, false), false)
assert.equal(pushMatchesTarget(legacyDelivery, phoneTarget, false), true)
const sourceStreamPush = { ...classicPushes.phoneDelivery, targetDeviceIden: undefined, streamDeviceIden: 'chrome' }
assert.equal(pushMatchesTarget(sourceStreamPush, chromeTarget), true)
assert.equal(pushMatchesTarget(sourceStreamPush, chromeTarget, false), false)
assert.equal(pushMatchesTarget({ ...classicPushes.phoneDelivery, direction: 'incoming', senderEmailNormalized: 'friend@example.com' }, chromeTarget), false)
assert.equal(pushMatchesTarget({ ...classicPushes.phoneDelivery, clientIden: 'client' }, chromeTarget), false)
assert.equal(latestPushForTarget(classicPushes, phoneTarget)?.iden, 'phone-delivery')
assert.equal(pushPreview(classicPushes.old), 'https://example.com/old')
assert.deepEqual(sortTargetsByLatestPush([
  { id: 'device:quiet', label: 'Quiet', deviceIden: 'quiet' },
  phoneTarget,
  everythingTarget
], classicPushes).map((target) => target.id), ['everything', 'device:phone', 'device:quiet'])
const deviceTargets = [
  { ...chromeTarget, label: 'Chrome' },
  { ...phoneTarget, label: 'Phone' },
  { id: 'device:other', deviceIden: 'other', label: 'Other' }
]
const sortingPushes = { ...classicPushes, other: { iden: 'other', direction: 'self', targetDeviceIden: 'other', sourceDeviceIden: 'external', created: 225 } }
assert.deepEqual(sortTargetsByLatestPush(deviceTargets, sortingPushes).map((target) => target.id), ['device:chrome', 'device:phone', 'device:other'])
assert.deepEqual(sortTargetsByLatestPush(deviceTargets, sortingPushes, false).map((target) => target.id), ['device:phone', 'device:other', 'device:chrome'])

assert.equal(DUPLICATE_PUSH_WINDOW_MS, 5_000)
const duplicatePush = {
  direction: 'self',
  sourceDeviceIden: 'automation',
  type: 'note',
  title: 'Build complete',
  body: '  All   checks passed. ',
  created: 1_700_000_000
}
const duplicateDeliveries = [
  { ...duplicatePush, iden: 'copy-phone', targetDeviceIden: 'phone' },
  { ...duplicatePush, iden: 'copy-chrome', targetDeviceIden: 'chrome', body: 'All checks passed.', created: 1_700_000_004 }
]
const duplicateGroups = groupDuplicateDevicePushes(duplicateDeliveries)
assert.equal(duplicateGroups.length, 1)
assert.equal(duplicateGroups[0].push.iden, 'copy-phone')
assert.deepEqual(duplicateGroups[0].destinationDeviceIdens, ['chrome', 'phone'])
assert.equal(groupDuplicateDevicePushes(duplicateDeliveries.map((push, index) => ({
  ...push,
  mirror: { packageName: 'example.app', icon: `icon-${index}`, image: `image-${index}` }
}))).length, 1)
assert.equal(groupDuplicateDevicePushes(duplicateDeliveries.map((push) => ({ ...push, direction: undefined, deviceIden: push.targetDeviceIden, targetDeviceIden: undefined }))).length, 1)
assert.equal(groupDuplicateDevicePushes([
  ...duplicateDeliveries,
  { ...duplicatePush, iden: 'copy-tablet', targetDeviceIden: 'tablet', created: 1_700_000_006 }
]).length, 2)
assert.equal(groupDuplicateDevicePushes([
  duplicateDeliveries[0],
  { ...duplicateDeliveries[1], iden: 'copy-other-source', sourceDeviceIden: 'other-automation' }
]).length, 2)
assert.equal(groupDuplicateDevicePushes([
  duplicateDeliveries[0],
  { ...duplicateDeliveries[1], iden: 'copy-different-content', body: 'A different event.' }
]).length, 2)
assert.equal(groupDuplicateDevicePushes([
  duplicateDeliveries[0],
  { ...duplicateDeliveries[1], iden: 'copy-same-device', targetDeviceIden: 'phone' }
]).length, 2)
assert.equal(groupDuplicateDevicePushes([
  duplicateDeliveries[0],
  { ...duplicateDeliveries[1], iden: 'copy-too-late', created: 1_700_000_006 }
]).length, 2)
assert.equal(groupDuplicateDevicePushes([
  { ...duplicatePush, iden: 'copy-no-target-a' },
  { ...duplicatePush, iden: 'copy-no-target-b', created: 1_700_000_001 }
]).length, 2)

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
assert.equal(migrated.settings.showSentPushesInDeviceHistory, true)
assert.ok(extensionStorage.extensionState)
const reloaded = await readState()
assert.equal(reloaded.user?.imageUrl, 'https://example.com/profile.png')
assert.equal(reloaded.user?.emailNormalized, 'legacy@example.com')
extensionStorage.extensionState.settings.showSentPushesInDeviceHistory = false
assert.equal((await readState()).settings.showSentPushesInDeviceHistory, false)

console.log('Unit contract smoke test passed.')
