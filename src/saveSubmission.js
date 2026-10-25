import { postJSON } from './transport.js'

// One controller per diagnosis. Keep its ID after an ambiguous network failure.
export function createSaveController({ send, createId = () => crypto.randomUUID() }) {
  let pending = null
  let inFlight = null
  let completed = null

  function submit(input, { signal } = {}) {
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

    inFlight = Promise.resolve().then(() => send(pending.payload, { signal })).then(data => {
      if (data?.status !== 'success' || data.saved !== true || data.submissionId !== pending.payload.submissionId) {
        throw new Error('保存を確認できませんでした。入力を変えずに、同じ画面からもう一度お試しください。')
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

export function callGAS(endpoint, body, { timeoutMs = 30000, ...options } = {}) {
  const retry = '保存結果を確認できませんでした。入力を変えずに、同じ画面からもう一度お試しください。'
  return postJSON(endpoint, body, { ...options, timeoutMs, messages: {
    network: retry, timeout: retry, invalid: retry, failed: retry,
    codes: {
      INVALID_INPUT: '入力内容を確認してください。お名前・メールアドレス・回答が正しい場合は、同じ画面から再試行してください。',
      BUSY: '保存処理が混み合っています。入力を変えずに、同じ画面からもう一度お試しください。',
      ID_CONFLICT: '前回と異なる内容は送信できません。入力内容を前回の状態に戻してください。',
      SCHEMA_MISMATCH: '集計シートの項目を確認する必要があります。管理者へお問い合わせください。',
      CONFIG_ERROR: '保存先の設定を確認する必要があります。管理者へお問い合わせください。',
      SAVE_FAILED: retry,
    },
  } })
}
