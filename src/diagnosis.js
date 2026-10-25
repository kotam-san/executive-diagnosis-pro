import { categories } from './data.js'

export const categoriesFor = mode => categories.filter(category => mode === 'full' || (mode === 'quick' && category.quick))

export function completeRatings(mode, ratings) {
  const fields = categoriesFor(mode)
  return fields.length > 0 && ratings !== null && typeof ratings === 'object' && !Array.isArray(ratings) &&
    Object.keys(ratings).length === fields.length && fields.every(({ name }) =>
      Object.prototype.hasOwnProperty.call(ratings, name) && Number.isInteger(ratings[name]) && ratings[name] >= 1 && ratings[name] <= 5)
}

// Reset invalidates callbacks even when a transport ignores AbortSignal.
export function createRequestScope() {
  let generation = 0
  const active = new Map()
  return {
    start(action) {
      if (active.size) return null
      const controller = new AbortController()
      const request = { action, generation, controller }
      active.set(action, request)
      return request
    },
    current(request) {
      return request.generation === generation && active.get(request.action) === request
    },
    finish(request) {
      if (active.get(request.action) === request) active.delete(request.action)
    },
    reset() {
      generation++
      for (const request of active.values()) request.controller.abort()
      active.clear()
    },
  }
}

export async function requestAI(endpoint, body, { signal, fetchImpl = fetch, timeoutMs = 45000 } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; abort() }, timeoutMs)
  try {
    const response = await fetchImpl(endpoint, { method: 'POST', body: JSON.stringify(body), signal: controller.signal })
    if (!response.ok) throw new Error('AIとの通信を確認できませんでした。もう一度お試しください。')
    const data = await response.json()
    if (!data || data.status !== 'success') {
      const error = new Error(typeof data?.message === 'string' ? data.message : 'AIの生成に失敗しました。もう一度お試しください。')
      error.code = data?.code
      throw error
    }
    const text = data[body.action === 'get_advice' ? 'analysis' : 'plan']
    if (typeof text !== 'string' || !text.trim() || text.length > 6000) throw new Error('AIの応答を確認できませんでした。もう一度お試しください。')
    return text
  } catch (error) {
    if (timedOut) throw new Error('AIの生成に時間がかかっています。少し待ってからもう一度お試しください。')
    if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('AIとの通信を確認できませんでした。もう一度お試しください。')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
