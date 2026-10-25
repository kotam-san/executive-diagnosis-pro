import fs from 'node:fs'
import vm from 'node:vm'
import { createHash, createHmac, randomUUID } from 'node:crypto'

export const gasSource = fs.readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8')

export function harness(options = {}) {
  const state = {
    sheets: new Map(), mails: [], locked: false, acquires: 0, releases: 0,
    failOpen: false, failWrite: false, failFlush: false, failMail: false,
    beforeWrite: null, writes: 0, now: Date.UTC(2026,9,25,0,0,0), cache: new Map(), requests: [], usedTokens: new Set(), tokenSequence: 0, ...options,
  }
  const props = { SHEET_ID: 'fake-sheet', NOTIFY_EMAIL: 'owner@example.test',
    ...(options.enableAi ? { CLAUDE_API_KEY: 'fake-ai-key', AI_SESSION_SECRET: 'fake-signing-key-with-at-least-32-characters', TURNSTILE_SECRET_KEY: 'fake-turnstile-secret-for-unit-tests' } : {}), ...options.props }
  const bytes = value => Array.from(value, byte => byte > 127 ? byte - 256 : byte)
  const blob = value => {
    const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
    return { getBytes: () => bytes(buffer), getDataAsString: () => buffer.toString('utf8') }
  }
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])) }
    static now() { return state.now }
  }
  class Sheet {
    constructor(name, rows = []) { this.name = name; this.rows = rows.map(r => [...r]); this.maxColumns = Math.max(26, ...rows.map(r => r.length)); this.maxRows = 1000 }
    getLastRow() { return this.rows.length }
    getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)) }
    getMaxColumns() { return this.maxColumns }
    getMaxRows() { return this.maxRows }
    insertColumnsAfter(index, count) { if (index !== this.maxColumns) throw Error('bad expansion'); this.maxColumns += count }
    insertRowsAfter(index, count) { if (index !== this.maxRows) throw Error('bad expansion'); this.maxRows += count }
    getRange(row, col, height = 1, width = 1) {
      if (row + height - 1 > this.maxRows || col + width - 1 > this.maxColumns) throw Error('grid too small')
      return {
        getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => this.rows[row - 1 + i]?.[col - 1 + j] ?? '')),
        setValues: values => {
          if (!state.locked) throw Error('unlocked write')
          if (values.length !== height || values.some(r => r.length !== width)) throw Error('wrong shape')
          if (state.failWrite) throw Error('write failed')
          if (state.beforeWrite) { const callback = state.beforeWrite; state.beforeWrite = null; callback() }
          for (let i = 0; i < height; i++) {
            this.rows[row - 1 + i] ||= []
            for (let j = 0; j < width; j++) this.rows[row - 1 + i][col - 1 + j] = values[i][j]
          }
          state.writes++
        },
        setValue: value => this.getRange(row, col).setValues([[value]]),
      }
    }
  }
  const ss = {
    getSheetByName: name => state.sheets.get(name) || null,
    insertSheet: name => { const sheet = new Sheet(name); state.sheets.set(name, sheet); return sheet },
  }
  const services = {
    Date: Clock,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF-8' }, newBlob: blob,
      computeDigest: (algorithm, value) => bytes(createHash('sha256').update(value, 'utf8').digest()),
      computeHmacSha256Signature: (value, secret) => bytes(createHmac('sha256', secret).update(value, 'utf8').digest()),
      base64EncodeWebSafe: value => Buffer.from(value).toString('base64url'),
      base64DecodeWebSafe: value => bytes(Buffer.from(value, 'base64url')),
      getUuid: randomUUID,
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => props[key] ?? null,
      getProperties: () => ({ ...props }),
      setProperty(key, value) {
        assertPropertyWrite(); props[key] = value; return this
      },
      deleteProperty(key) { assertPropertyWrite(); delete props[key]; return this },
    }) },
    CacheService: { getScriptCache: () => { if (state.failCacheService) throw Error('cache unavailable'); return ({
      get: key => { if (state.failCacheRead) throw Error('cache unavailable'); const entry = state.cache.get(key); return entry && entry.expiresAt > state.now ? entry.value : null },
      put: (key, value, seconds) => { if (state.failCacheWrite) throw Error('cache unavailable'); state.cache.set(key, { value, expiresAt: state.now + seconds * 1000 }) },
    }) } },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (state.locked || state.forceBusy) return false; state.locked = true; state.acquires++; return true },
      releaseLock: () => { state.locked = false; state.releases++ },
    }) },
    SpreadsheetApp: {
      openById: () => { if (state.failOpen) throw Error('open failed'); return ss },
      flush: () => { if (state.failFlush) throw Error('flush failed') },
    },
    GmailApp: { sendEmail: (...args) => { if (state.failMail) throw Error('mail failed'); state.mails.push(args) } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: value => ({
      content: value, setMimeType() { return this }, setContent(v) { this.content = v; return this },
    }) },
    UrlFetchApp: { fetch: (url, init) => {
      state.requests.push({ url, init })
      if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        if (state.failHumanNetwork) throw Error('verification network unavailable')
        const token = JSON.parse(init.payload).response
        const valid = token.startsWith('valid-human-token-') && !state.usedTokens.has(token)
        if (valid) state.usedTokens.add(token)
        return { getResponseCode: () => state.humanStatus ?? 200, getContentText: () => JSON.stringify(state.humanResult ?? { success: valid, hostname: 'executive-diagnosis-pro.kota-m.workers.dev', action: 'diagnosis_ai' }) }
      }
      if (url === 'https://api.anthropic.com/v1/messages') {
        if (state.failAiNetwork) throw Error('AI network unavailable')
        return { getResponseCode: () => state.aiStatus ?? 200, getContentText: () => state.aiRawResponse ?? JSON.stringify(state.aiResponse ?? { content: [{ type: 'text', text: 'mock generated feedback' }], stop_reason: 'end_turn' }) }
      }
      throw Error('External network disabled in tests')
    } },
    console: { error() {}, log() {} },
  }
  function assertPropertyWrite() {
    if (!state.locked) throw Error('unlocked property write')
    if (state.failPropertyWrite) throw Error('properties unavailable')
  }
  function context() { const ctx = vm.createContext({ ...services }); vm.runInContext(gasSource, ctx); return ctx }
  const ctx = context()
  function post(payload, target = ctx) { return JSON.parse(target.doPost({ postData: { contents: JSON.stringify(payload) } }).content) }
  function addSheet(name, rows) { const sheet = new Sheet(name, rows); state.sheets.set(name, sheet); return sheet }
  const humanToken = () => `valid-human-token-${++state.tokenSequence}`
  return { state, props, ctx, context, post, addSheet, humanToken }
}

export function payload(ctx, mode = 'quick', extra = {}) {
  return {
    action: 'save_only', name: '架空テスト', email: 'person@example.test', mode,
    ratings: Object.fromEntries(Array.from(ctx.DIAGNOSIS_FIELDS[mode], (name, i) => [name, i % 5 + 1])),
    submissionId: 'test-submission-id-0001', ...extra,
  }
}
