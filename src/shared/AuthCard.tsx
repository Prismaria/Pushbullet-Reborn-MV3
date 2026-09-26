import { FormEvent, useState } from 'react'
import { sendExtensionMessage } from './messages'
import type { ExtensionState } from './models'
import { t } from './i18n'

type AuthCardProps = {
  onStateChange: (state: ExtensionState) => void
  showDisconnect?: boolean
}

export function AuthCard({ onStateChange, showDisconnect = false }: AuthCardProps) {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState('')
  const [statusKind, setStatusKind] = useState<'idle' | 'loading' | 'error' | 'success'>('idle')
  const [submitting, setSubmitting] = useState(false)

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = token.trim()
    if (!value) {
      setStatusKind('error')
       setStatus(t('pasteFirst'))
      return
    }

    setSubmitting(true)
    setStatusKind('loading')
     setStatus(t('validating'))
    try {
      const response = await sendExtensionMessage({ type: 'set_token', token: value })
      if (!response.ok) throw new Error(response.error)
      setToken('')
      setStatusKind('success')
       setStatus(`${t('connected')}${response.state.user?.email ? ` as ${response.state.user.email}` : ''}.`)
      onStateChange(response.state)
    } catch (caughtError) {
      setStatusKind('error')
       setStatus(caughtError instanceof Error ? caughtError.message : t('invalidToken'))
    } finally {
      setSubmitting(false)
    }
  }

  const disconnect = async () => {
    setSubmitting(true)
    try {
      const response = await sendExtensionMessage({ type: 'sign_out' })
      if (!response.ok) throw new Error(response.error)
      setStatusKind('idle')
       setStatus(t('disconnected'))
      onStateChange(response.state)
    } catch (caughtError) {
      setStatusKind('error')
       setStatus(caughtError instanceof Error ? caughtError.message : t('disconnected'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="auth-card" aria-labelledby="auth-heading">
       <div className="eyebrow">{t('secureConnection')}</div>
       <h2 id="auth-heading">{t('connectPushbullet')}</h2>
       <p className="auth-copy">{t('authCopy')}</p>
      <a className="auth-link" href="https://www.pushbullet.com/#settings/account" target="_blank" rel="noreferrer">
         {t('findAccessToken')}
      </a>
      <form className="auth-form" onSubmit={connect}>
         <label htmlFor="access-token">{t('accessToken')}</label>
        <input
          id="access-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
           placeholder={t('pasteAccessToken')}
          disabled={submitting}
        />
        <button className="primary-button" type="submit" disabled={submitting}>
           {submitting ? t('connecting') : t('connect')}
        </button>
      </form>
      <div className={`auth-status auth-status-${statusKind}`} aria-live="polite">
        {status}
      </div>
      {showDisconnect && (
        <button className="ghost-button" type="button" onClick={disconnect} disabled={submitting}>
           {t('disconnect')}
        </button>
      )}
    </section>
  )
}
