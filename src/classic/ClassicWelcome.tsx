import { useState } from 'react'
import { sendExtensionMessage } from '../shared/messages'
import { useClassicState } from './useClassicState'
import { CLASSIC_VERSION } from './version'

export function ClassicWelcome() {
  const { state, loading, setState } = useClassicState()
  const [cookies, setCookies] = useState(true)
  const [analytics, setAnalytics] = useState(true)
  const [status, setStatus] = useState('')

  if (loading || !state) return <div id="header" />

  const finish = async () => {
    if (!cookies) {
      setStatus('Cookies are required to continue.')
      return
    }
    try {
      const response = await sendExtensionMessage({ type: 'save_settings', settings: { disableAnalytics: !analytics, needsDataApproval: false } })
      if (!response.ok) throw new Error(response.error)
      setState(response.state)
      await chrome.tabs.create({ url: 'https://www.pushbullet.com/signin?source=chrome' })
      window.close()
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Could not save privacy settings.')
    }
  }

  return (
    <>
      <div id="header"><div className="inner"><div><a id="logo-link" href="https://www.pushbullet.com" target="_blank" rel="noreferrer"><div id="logo" /></a><div style={{ marginLeft: '245px', marginTop: '-10px' }} id="version">v{CLASSIC_VERSION}</div></div></div></div>
      <div style={{ position: 'relative', height: '100%' }}><div className="inner" style={{ marginBottom: '100px' }}><div style={{ margin: '40px 0' }}>
        <p id="thanks" style={{ fontSize: '24px' }}>Thanks for installing Pushbullet</p>
        <p id="heading-privacy" className="section-heading">Privacy</p>
        <div id="cookies-option" className="option"><label className="option-label"><div className="switch"><input type="checkbox" id="cookies-checkbox" checked={cookies} onChange={(event) => setCookies(event.target.checked)} /><span className="slider round" /></div><span id="cookies-label" className="option-title">Allow required cookies</span></label><div id="cookies-desc" className="option-desc">Cookies are required to connect to Pushbullet.</div></div>
        <div id="analytics-option" className="option"><label className="option-label"><div className="switch"><input type="checkbox" id="analytics-checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} /><span className="slider round" /></div><span id="analytics-label" className="option-title">Allow optional analytics</span></label><div id="analytics-desc" className="option-desc">Share optional usage data to help improve Pushbullet.</div></div>
        <div style={{ textAlign: 'center', margin: '40px 0' }}><button id="welcome-done" type="button" onClick={() => void finish()} style={{ display: cookies ? 'inline-block' : 'none' }}>Sign in</button><p id="cookies-required" style={{ fontWeight: 'bold', display: cookies ? 'none' : 'block' }}>Cookies are required to continue.</p><p aria-live="polite">{status}</p></div>
        <p>Please visit our <a href="https://www.pushbullet.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> for further information.</p>
      </div></div></div>
    </>
  )
}
