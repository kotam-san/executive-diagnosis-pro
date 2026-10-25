// One controller per diagnosis. Keep its ID after an ambiguous network failure.
export function createSaveController({ send, createId = () => crypto.randomUUID() }) {
  let pending = null
  let inFlight = null
  let completed = null

  function submit(input) {
    const payload = {
      action: 'save_only_v2',
      name: input.name.trim(),
      email: input.email.trim(),
      mode: input.mode,
      ratings: Object.fromEntries(Object.entries(input.ratings).sort(([a], [b]) => a.localeCompare(b))),
    }
    const signature = JSON.stringify(payload)
    if (pending && pending.signature !== signature) {
      return Promise.reject(new Error('前回の保存結果を確認できていません。入力内容を前回の状態に戻して、もう一度お試しください。'))
    }
    if (completed) return Promise.resolve(completed)
    if (inFlight) return inFlight
    if (!pending) pending = { signature, payload: { ...payload, submissionId: createId() } }

    inFlight = Promise.resolve().then(() => send(pending.payload)).then(data => {
      if (data?.status !== 'success' || data.saved !== true || data.submissionId !== pending.payload.submissionId) {
        const error = new Error(data?.message || '保存を確認できませんでした。同じ画面からもう一度お試しください。')
        error.code = data?.code
        throw error
      }
      completed = data
      return data
    }).catch(error => {
      // This response guarantees validation failed before any sheet write.
      if (error.code === 'INVALID_INPUT') pending = null
      throw error
    }).finally(() => { inFlight = null })
    return inFlight
  }

  return { submit }
}

export async function callGAS(endpoint, body, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // Keep the existing simple POST: a JSON Content-Type would introduce preflight.
    const response = await fetchImpl(endpoint, {
      method: 'POST', body: JSON.stringify(body), signal: controller.signal,
    })
    if (!response.ok) throw new Error('通信を確認できませんでした。同じ画面からもう一度お試しください。')
    const data = await response.json()
    if (data.status !== 'success') {
      const error = new Error(data.message || '保存を確認できませんでした。同じ画面からもう一度お試しください。')
      error.code = data.code
      throw error
    }
    return data
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError || error instanceof SyntaxError) {
      throw new Error('保存結果を確認できませんでした。入力を変えずに、同じ画面からもう一度お試しください。')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
