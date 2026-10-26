import { categories } from './data.js'
import { postJSON } from './transport.js'

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
  const invalid = 'AIの応答を確認できませんでした。安全確認後にもう一度お試しください。'
  const data = await postJSON(endpoint, body, { signal, fetchImpl, timeoutMs, messages: {
    network: 'AIとの通信を確認できませんでした。安全確認後にもう一度お試しください。',
    timeout: 'AIの生成に時間がかかっています。少し待ち、安全確認後にもう一度お試しください。',
    invalid, failed: 'AIの生成に失敗しました。安全確認後にもう一度お試しください。',
    codes: {
      INVALID_INPUT: '回答を確認できませんでした。診断スコアをご確認ください。AIを使うには診断をやり直してください。',
      AI_ACCESS_REQUIRED: 'この診断の保存を確認できません。AIを使うには診断をやり直してください。',
      AI_SESSION_EXPIRED: 'AIをご利用いただける時間を過ぎました。診断スコアは引き続き確認できます。',
      AI_UNAVAILABLE: 'AIフィードバックは現在ご利用いただけません。診断スコアは引き続き確認できます。',
      AI_BUSY: 'AIが混み合っています。少し待ち、安全確認後にもう一度お試しください。',
      AI_LIMIT_REACHED: 'AIの利用上限に達しました。診断スコアをご確認いただくか、時間を置いてお試しください。',
      HUMAN_VERIFICATION_REQUIRED: '安全確認をやり直してからもう一度お試しください。',
      HUMAN_VERIFICATION_UNAVAILABLE: '安全確認の通信ができませんでした。少し待ってからもう一度お試しください。',
      AI_UPSTREAM_ERROR: 'AIの生成を完了できませんでした。少し待ち、安全確認後にもう一度お試しください。',
      AI_INVALID_RESPONSE: invalid,
    },
  } })
  const text = data[body.action === 'get_advice' ? 'analysis' : 'plan']
  if (typeof text !== 'string' || !text.trim() || text.length > 6000) throw Object.assign(new Error(invalid), { code: 'INVALID_RESPONSE' })
  return text
}
