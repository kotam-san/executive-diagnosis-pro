// Keep GAS requests as simple POSTs (no JSON Content-Type / CORS preflight).
class TransportError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export async function postJSON(endpoint, body, { signal, fetchImpl = fetch, timeoutMs, messages }) {
  const controller = new AbortController()
  let timer, cancel
  const failure = (code, message) => new TransportError(code, message)
  const cancelled = new Promise((resolve, reject) => { cancel = reject })
  const abort = () => {
    cancel(failure('REQUEST_ABORTED', messages.network))
    controller.abort()
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    if (signal?.aborted) throw failure('REQUEST_ABORTED', messages.network)
    timer = setTimeout(() => {
      cancel(failure('REQUEST_TIMEOUT', messages.timeout))
      controller.abort()
    }, timeoutMs)
    const operation = (async () => {
      const response = await fetchImpl(endpoint, { method: 'POST', body: JSON.stringify(body), signal: controller.signal })
      if (!response.ok) throw failure('NETWORK_ERROR', messages.network)
      const data = await response.json()
      if (!data || typeof data !== 'object' || Array.isArray(data) || !['success', 'error'].includes(data.status)) {
        throw failure('INVALID_RESPONSE', messages.invalid)
      }
      if (data.status === 'error') {
        // Display only messages owned by this app, never arbitrary server text.
        const code = typeof data.code === 'string' && Object.prototype.hasOwnProperty.call(messages.codes, data.code) ? data.code : 'SERVER_ERROR'
        throw failure(code, messages.codes[code] || messages.failed)
      }
      return data
    })()
    return await Promise.race([operation, cancelled])
  } catch (error) {
    if (error instanceof TransportError) throw error
    if (error instanceof SyntaxError) throw failure('INVALID_RESPONSE', messages.invalid)
    throw failure('NETWORK_ERROR', messages.network)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
