export type ExtensionMessage = {
  type: 'ping'
}

export type ExtensionResponse = {
  ok: boolean
  service: 'background'
}

export async function sendExtensionMessage<TResponse>(message: ExtensionMessage): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: TResponse) => {
      const error = chrome.runtime.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve(response)
    })
  })
}
