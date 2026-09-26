type BackgroundMessage = {
  type?: string
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return

  await chrome.storage.local.set({
    schemaVersion: 1,
    installedAt: new Date().toISOString()
  })
})

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  if (message.type !== 'ping') return

  sendResponse({
    ok: true,
    service: 'background'
  })
})
