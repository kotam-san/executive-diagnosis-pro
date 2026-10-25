import fs from 'node:fs'
import vm from 'node:vm'

export const gasSource = fs.readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8')

export function harness(options = {}) {
  const state = {
    sheets: new Map(), mails: [], locked: false, acquires: 0, releases: 0,
    failOpen: false, failWrite: false, failFlush: false, failMail: false,
    beforeWrite: null, writes: 0, ...options,
  }
  const props = { SHEET_ID: 'fake-sheet', NOTIFY_EMAIL: 'owner@example.test', ...options.props }
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
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props[key] }) },
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
    UrlFetchApp: { fetch: () => { throw Error('External network disabled in tests') } },
    console: { error() {}, log() {} },
  }
  function context() { const ctx = vm.createContext({ ...services }); vm.runInContext(gasSource, ctx); return ctx }
  const ctx = context()
  function post(payload, target = ctx) { return JSON.parse(target.doPost({ postData: { contents: JSON.stringify(payload) } }).content) }
  function addSheet(name, rows) { const sheet = new Sheet(name, rows); state.sheets.set(name, sheet); return sheet }
  return { state, props, ctx, context, post, addSheet }
}

export function payload(ctx, mode = 'quick', extra = {}) {
  return {
    action: 'save_only', name: '架空テスト', email: 'person@example.test', mode,
    ratings: Object.fromEntries(Array.from(ctx.DIAGNOSIS_FIELDS[mode], (name, i) => [name, i % 5 + 1])),
    submissionId: 'test-submission-id-0001', ...extra,
  }
}
