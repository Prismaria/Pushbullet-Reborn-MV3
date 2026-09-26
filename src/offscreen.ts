let alertAudio: HTMLAudioElement | null = null

async function playAlertSound(): Promise<void> {
  alertAudio ||= new Audio(chrome.runtime.getURL('alert.ogg'))
  alertAudio.currentTime = 0
  try {
    await alertAudio.play()
  } catch {
    // Audio playback can be blocked until the user interacts with Chrome.
  }
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'PLAY_ALERT_SOUND') void playAlertSound()
})
