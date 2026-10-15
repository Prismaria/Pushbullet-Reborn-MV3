import { useCallback, useEffect, useState } from 'react'
import type { ExtensionUser } from './models'
import { sendExtensionMessage } from './messages'
import { DEFAULT_UPLOAD_LIMIT_BYTES, formatUploadLimit, maxUploadBytesForUser } from './uploads'
import { t } from './i18n'

type LargeUploadAuthNoticeProps = {
  user: ExtensionUser
  className?: string
}

export function LargeUploadAuthNotice({ user, className = '' }: LargeUploadAuthNoticeProps) {
  const uploadLimit = maxUploadBytesForUser(user)
  const requiresLargeUploadAuth = Boolean(user && uploadLimit > DEFAULT_UPLOAD_LIMIT_BYTES)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)

  const checkAvailability = useCallback(async () => {
    setChecking(true)
    try {
      const response = await sendExtensionMessage({ type: 'get_large_upload_auth' })
      setAvailable(response.ok && response.available)
    } catch {
      setAvailable(false)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!requiresLargeUploadAuth) {
      setAvailable(null)
      return
    }
    setAvailable(null)
    const check = async () => {
      try {
        const response = await sendExtensionMessage({ type: 'get_large_upload_auth' })
        if (!cancelled) setAvailable(response.ok && response.available)
      } catch {
        if (!cancelled) setAvailable(false)
      }
    }
    void check()
    return () => { cancelled = true }
  }, [requiresLargeUploadAuth, user?.iden, uploadLimit])

  if (!requiresLargeUploadAuth || available !== false) return null

  return (
    <aside className={`large-upload-auth-notice ${className}`.trim()} role="note">
      <div className="large-upload-auth-copy">
        <strong>{t('largeUploadSetupTitle')}</strong>
        <p>{t('largeUploadSetupCopy').replace('{limit}', formatUploadLimit(uploadLimit))}</p>
      </div>
      <div className="large-upload-auth-actions">
        <a href="https://www.pushbullet.com/signin" target="_blank" rel="noreferrer">{t('largeUploadSignIn')}</a>
        <button type="button" onClick={() => void checkAvailability()} disabled={checking}>
          {checking ? t('largeUploadChecking') : t('largeUploadCheck')}
        </button>
      </div>
    </aside>
  )
}
