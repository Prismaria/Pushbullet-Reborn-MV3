import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { performance } from 'node:perf_hooks'

const script = await readFile(new URL('../public/classic-assets/panel-startup.js', import.meta.url), 'utf8')

function startPopup(cachedTheme, cachedState, cachedShowSentPushes) {
  let resolveStorage
  let rejectStorage
  const stored = new Promise((resolve, reject) => {
    resolveStorage = resolve
    rejectStorage = reject
  })
  const cache = new Map(cachedTheme === undefined ? [] : [['classicPanelDarkMode', cachedTheme]])
  if (cachedState) cache.set('classicPanelStateV1', JSON.stringify(cachedState))
  if (cachedShowSentPushes !== undefined) cache.set('classicPanelShowSentPushes', String(cachedShowSentPushes))
  const classes = new Map()
  const root = { style: {}, classList: { toggle: (name, value) => classes.set(name, value) } }
  const window = {}
  const requests = []
  runInNewContext(script, {
    document: { documentElement: root },
    window,
    performance,
    localStorage: { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) },
    chrome: { storage: { local: { get: (key) => { requests.push(key); return stored } } } },
    console: { warn: () => {} }
  })
  return { root, classes, window, cache, requests, resolveStorage, rejectStorage }
}

// The theme must be applied synchronously while storage (and any worker) is still pending.
const darkPopup = startPopup('true')
assert.equal(darkPopup.root.style.backgroundColor, '#232a2a')
assert.equal(darkPopup.root.style.colorScheme, 'dark')
assert.deepEqual(darkPopup.requests, ['extensionState'])
const savedState = { user: { email: 'test@example.com' }, settings: { darkMode: true }, pushes: {} }
darkPopup.resolveStorage({ extensionState: savedState })
assert.equal(await darkPopup.window.classicPanelStartup, savedState)

const warmPopup = startPopup('true', savedState)
assert.equal(warmPopup.window.classicPanelCachedState.user.email, savedState.user.email)
assert.equal(warmPopup.root.style.backgroundColor, '#232a2a')
// Cached data is available before the authoritative asynchronous read is released.
warmPopup.resolveStorage({ extensionState: savedState })
assert.equal(await warmPopup.window.classicPanelStartup, savedState)

const receiverOnlyPopup = startPopup('true', { ...savedState, settings: { darkMode: true, showSentPushesInDeviceHistory: true } }, false)
assert.equal(receiverOnlyPopup.window.classicPanelCachedState.settings.showSentPushesInDeviceHistory, false)
receiverOnlyPopup.resolveStorage({ extensionState: { ...savedState, settings: { darkMode: true, showSentPushesInDeviceHistory: false } } })
assert.equal((await receiverOnlyPopup.window.classicPanelStartup).settings.showSentPushesInDeviceHistory, false)

// chrome.storage takes precedence over a stale paint cache.
const lightPopup = startPopup('true')
lightPopup.resolveStorage({ extensionState: { settings: { darkMode: false } } })
await lightPopup.window.classicPanelStartup
assert.equal(lightPopup.root.style.backgroundColor, '#ffffff')
assert.equal(lightPopup.classes.get('darkmode'), false)
assert.equal(lightPopup.cache.get('classicPanelDarkMode'), 'false')

const firstPopup = startPopup()
firstPopup.resolveStorage({ extensionState: savedState })
await firstPopup.window.classicPanelStartup
assert.equal(firstPopup.root.style.backgroundColor, '#232a2a')

// Missing or unavailable storage must release startup so the existing worker fallback can run.
const emptyPopup = startPopup()
emptyPopup.resolveStorage({})
assert.equal(await emptyPopup.window.classicPanelStartup, undefined)
const failedPopup = startPopup('true')
failedPopup.rejectStorage(new Error('Storage unavailable'))
assert.equal(await failedPopup.window.classicPanelStartup, undefined)
assert.equal(failedPopup.root.style.backgroundColor, '#232a2a')

console.log('Classic popup startup smoke test passed.')
