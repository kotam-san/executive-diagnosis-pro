import { useEffect, useRef, useState } from 'react'
import { createTurnstileLoader } from './turnstile.js'

let loadTurnstile

export default function HumanVerification({ sitekey, resetKey, onToken }) {
  const container = useRef(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let disposed = false
    let widget
    let api
    const element = container.current
    setError(false)
    onToken('')
    if (sitekey) (loadTurnstile ||= createTurnstileLoader())().then(turnstile => {
      if (disposed || !container.current) return
      api = turnstile
      widget = api.render(container.current, {
        sitekey, action: 'diagnosis_ai', theme: 'dark', language: 'ja', size: 'compact',
        callback: token => { if (!disposed) { setError(false); onToken(token) } },
        'expired-callback': () => { if (!disposed) onToken('') },
        'error-callback': () => { if (!disposed) { onToken(''); setError(true) } },
        'timeout-callback': () => { if (!disposed) { onToken(''); setError(true) } },
      })
    }).catch(() => { if (!disposed) setError(true) })
    return () => {
      disposed = true
      if (widget !== undefined) {
        try { api.remove(widget) } catch { /* Clear the local widget even if the SDK failed. */ }
      }
      element?.replaceChildren()
    }
  }, [sitekey, resetKey, retry, onToken])

  if (!sitekey) return <p className="text-sm text-slate-400">AIフィードバックは現在準備中です。診断スコアは上のグラフでご確認いただけます。</p>
  return <div className="mb-6" aria-label="AI利用の安全確認">
    <p className="text-sm text-slate-400 mb-3">AIをご利用の前に、安全確認をお願いします。</p>
    <div ref={container} />
    {error && <div role="alert" className="text-sm text-red-300 mt-3">
      安全確認を読み込めませんでした。
      <button onClick={() => setRetry(value => value + 1)} className="underline ml-2">読み込み直す</button>
    </div>}
  </div>
}
