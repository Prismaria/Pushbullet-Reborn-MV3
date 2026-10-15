// Run before the React bundle: the popup's first paint must use its saved theme.
(() => {
  const themeKey = 'classicPanelDarkMode'
  const applyTheme = (darkMode) => {
    document.documentElement.classList.toggle('darkmode', darkMode)
    document.documentElement.style.backgroundColor = darkMode ? '#232a2a' : '#ffffff'
    document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light'
    try {
      localStorage.setItem(themeKey, String(darkMode))
    } catch {
      // The stored extension state remains authoritative if this paint cache is unavailable.
    }
  }

  try {
    const cachedTheme = localStorage.getItem(themeKey)
    if (cachedTheme !== null) applyTheme(cachedTheme === 'true')
  } catch {
    // Continue with chrome.storage when localStorage is unavailable.
  }

  performance.mark('classic-popup-startup')
  try {
    window.classicPanelCachedState = JSON.parse(localStorage.getItem('classicPanelStateV1') || 'null')
    const showSentPushes = localStorage.getItem('classicPanelShowSentPushes')
    if (window.classicPanelCachedState && (showSentPushes === 'true' || showSentPushes === 'false')) {
      window.classicPanelCachedState.settings = {
        ...window.classicPanelCachedState.settings,
        showSentPushesInDeviceHistory: showSentPushes === 'true'
      }
    }
  } catch {
    window.classicPanelCachedState = null
  }
  const preloadDeviceImages = (state) => {
    if (typeof Image === 'undefined') return
    if (/^https:\/\//i.test(state?.user?.imageUrl || '')) {
      const avatar = new Image()
      avatar.src = state.user.imageUrl
    }
    for (const device of Object.values(state?.devices || {})) {
      const icon = device.icon || device.type || 'other'
      if (!/^[a-z]+$/.test(icon)) continue
      const image = new Image()
      image.src = `../classic-assets/chip_${icon}.png`
    }
  }
  preloadDeviceImages(window.classicPanelCachedState)
  window.classicPanelStartup = (async () => {
    try {
      const stored = await chrome.storage.local.get('extensionState')
      const state = stored.extensionState
      if (state && typeof state === 'object') {
        applyTheme(state.settings?.darkMode === true)
        preloadDeviceImages(state)
        return state
      }
      return undefined
    } catch (error) {
      console.warn('Could not preload Classic popup state:', error)
      return undefined
    } finally {
      performance.mark('classic-popup-state-ready')
      performance.measure('Classic popup: stored state', 'classic-popup-startup', 'classic-popup-state-ready')
    }
  })()
})()
