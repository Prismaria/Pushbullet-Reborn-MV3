import { readState, readToken } from './state'
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
  /^\/v3\/start-upload$/,
  /^\/v3\/finish-upload$/,
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

function getClientUserAgent(): string {
  const manifestVersion = chrome.runtime.getManifest().version
  const version = Number.parseInt(manifestVersion, 10)
  return `Pushbullet Chrome ${Number.isSafeInteger(version) && version > 0 ? version : 366}`
}

function getRequestUserAgent(path: string): string {
  // The large-file API was authorized by the original MV2 client identity.
  if (path === '/v3/start-upload' || path === '/v3/finish-upload') return 'Pushbullet Chrome 366'
  return getClientUserAgent()
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
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept', 'application/json')
  headers.set('X-User-Agent', getRequestUserAgent(path))
  if (path === '/v3/start-upload' || path === '/v3/finish-upload') headers.delete('Access-Token')
  else headers.set('Access-Token', token)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers })
  return { response, data: await parseResponse(response) }
}

async function readLegacyUploadToken(): Promise<string | null> {
  try {
    if (!chrome.cookies?.get) return null
    const cookie = await chrome.cookies.get({ url: 'https://www.pushbullet.com/', name: 'api_key' })
    const token = cookie?.value?.trim()
    if (!token) return null

    const cookieUser = await validateToken(token)
    const currentUser = (await readState()).user
    if (currentUser?.iden && cookieUser.iden !== currentUser.iden) return null
    return token
  } catch {
    return null
  }
}

export async function hasLegacyUploadAuthForCurrentUser(): Promise<boolean> {
  return Boolean(await readLegacyUploadToken())
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
  const requiresLegacyUploadAuth = path === '/v3/start-upload' || path === '/v3/finish-upload'
  const token = requiresLegacyUploadAuth ? await readLegacyUploadToken() : await readToken()
  if (!token) {
    const message = requiresLegacyUploadAuth
      ? 'Sign in to Pushbullet in this browser with the same account to upload large files.'
      : 'No Pushbullet access token is configured.'
    throw new ApiError(message, requiresLegacyUploadAuth ? 403 : 401, path)
  }

  const result = await requestWithToken(path, token, init)
  if (result.response.status === 401) throw new ApiError('Pushbullet access token was rejected.', 401, path)
  if (!result.response.ok) {
    const details = result.data as { error?: { message?: string } } | null
    throw new ApiError(details?.error?.message || `Pushbullet request failed (${result.response.status}).`, result.response.status, path)
  }
  return result.data as TResponse
}
