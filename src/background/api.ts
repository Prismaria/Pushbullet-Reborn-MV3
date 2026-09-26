import { readToken } from './state'
import { toExtensionUser } from '../shared/messages'
import type { ExtensionUser } from '../shared/models'

const API_ROOT = 'https://api.pushbullet.com'
const ALLOWED_PATHS = [
  /^\/v2\/users\/me$/,
  /^\/v2\/devices(?:\?.*)?$/,
  /^\/v2\/chats(?:\?.*)?$/,
  /^\/v2\/subscriptions(?:\?.*)?$/,
  /^\/v2\/pushes(?:\/[^/]+)?(?:\?.*)?$/,
  /^\/v2\/upload-request$/,
  /^\/v2\/ephemerals$/,
  /^\/v3\/create-text$/,
  /^\/v3\/delete-text$/,
  /^\/v3\/get-permanent$/
]

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly path: string) {
    super(message)
    this.name = 'ApiError'
  }
}

function assertAllowedPath(path: string): void {
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
    throw new ApiError(`Pushbullet API path is not allowed: ${path}`, 400, path)
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function requestWithToken(path: string, token: string, init: RequestInit = {}): Promise<{ response: Response; data: unknown }> {
  assertAllowedPath(path)
  const headers = new Headers(init.headers)
  headers.set('Access-Token', token)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers })
  return { response, data: await parseResponse(response) }
}

export async function validateToken(token: string): Promise<Exclude<ExtensionUser, null>> {
  const result = await requestWithToken('/v2/users/me', token.trim())
  if (!result.response.ok) {
    const details = result.data as { error?: { message?: string } } | null
    throw new ApiError(details?.error?.message || 'Pushbullet rejected the access token.', result.response.status, '/v2/users/me')
  }
  const user = toExtensionUser(result.data)
  if (!user) throw new ApiError('Pushbullet returned no account data.', result.response.status, '/v2/users/me')
  return user
}

export async function apiRequest<TResponse>(path: string, init: RequestInit = {}): Promise<TResponse> {
  const token = await readToken()
  if (!token) throw new ApiError('No Pushbullet access token is configured.', 401, path)

  const result = await requestWithToken(path, token, init)
  if (result.response.status === 401) throw new ApiError('Pushbullet access token was rejected.', 401, path)
  if (!result.response.ok) {
    const details = result.data as { error?: { message?: string } } | null
    throw new ApiError(details?.error?.message || `Pushbullet request failed (${result.response.status}).`, result.response.status, path)
  }
  return result.data as TResponse
}
