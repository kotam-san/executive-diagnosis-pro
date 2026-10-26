export function createTurnstileLoader({ windowImpl = window, documentImpl = document, timeoutMs = 15000 } = {}) {
  let loading
  const apiReady = () => typeof windowImpl.turnstile?.render === 'function' && typeof windowImpl.turnstile?.remove === 'function'
  return function load() {
    if (apiReady()) return Promise.resolve(windowImpl.turnstile)
    if (loading) return loading
    loading = new Promise((resolve, reject) => {
      const script = documentImpl.createElement('script')
      let finished = false
      const settle = error => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        script.onload = script.onerror = null
        if (error) { script.remove(); reject(new Error('Verification unavailable')) }
        else resolve(windowImpl.turnstile)
      }
      const timer = setTimeout(() => settle(true), timeoutMs)
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.onload = () => settle(!apiReady())
      script.onerror = () => settle(true)
      try { documentImpl.head.appendChild(script) } catch { settle(true) }
    }).catch(error => { loading = null; throw error })
    return loading
  }
}
