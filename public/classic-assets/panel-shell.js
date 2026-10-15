// Align the parser-rendered frame with the last selected tabs before the app loads.
(() => {
  document.body.classList.toggle('darkmode', document.documentElement.classList.contains('darkmode'))
  document.body.classList.toggle('popout', location.hash === '#popout')
  try {
    const preferences = JSON.parse(localStorage.getItem('classicPanelPreferencesV1') || 'null')
    if (preferences) {
      for (const tab of ['pushing', 'sms', 'notifications', 'account']) {
        document.getElementById(`${tab}-tab`).classList.toggle('selected', tab === preferences.mainTab)
      }
      for (const tab of ['friends', 'me', 'following']) {
        document.getElementById(`${tab}-tab`).classList.toggle('selected', tab === preferences.pushTab)
      }
      if (preferences.mainTab !== 'pushing') document.getElementById('messaging-content').style.display = 'none'
    }
  } catch {
    // The default frame is usable if preferences are missing or unavailable.
  }
  performance.mark('classic-popup-shell-ready')
  performance.measure('Classic popup: frame', 'classic-popup-startup', 'classic-popup-shell-ready')
})()
