import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { harness, payload, gasSource } from './gasHarness.js'

const HOUR = 60 * 60 * 1000
const id = n => `test-submission-id-${String(n).padStart(4, '0')}`
const rows = h => h.state.sheets.get('クイック診断')?.rows.length ?? 0

test('hourly save limit rejects new leads before any write or mail', () => {
  const h = harness({ props: { SAVE_LIMIT_HOURLY: '2' } })
  assert.equal(h.post(payload(h.ctx, 'quick', { submissionId: id(1) })).saved, true)
  assert.equal(h.post(payload(h.ctx, 'quick', { submissionId: id(2) })).saved, true)
  const writes = h.state.writes
  const limited = h.post(payload(h.ctx, 'quick', { submissionId: id(3) }))
  assert.equal(limited.code, 'SAVE_LIMITED'); assert.equal(h.state.writes, writes)
  assert.equal(h.state.mails.length, 2); assert.equal(h.state.locked, false)
})

test('a retried save with an existing ID passes the limit without a second row', () => {
  const h = harness({ props: { SAVE_LIMIT_HOURLY: '1' } })
  const p = payload(h.ctx)
  assert.equal(h.post(p).duplicate, false)
  assert.equal(h.post(p).duplicate, true)
  assert.equal(rows(h), 2); assert.equal(h.state.mails.length, 1)
})

test('save limit resets on the next Japanese hour', () => {
  const h = harness({ props: { SAVE_LIMIT_HOURLY: '1' } })
  h.post(payload(h.ctx, 'quick', { submissionId: id(1) }))
  assert.equal(h.post(payload(h.ctx, 'quick', { submissionId: id(2) })).code, 'SAVE_LIMITED')
  h.state.now += HOUR
  assert.equal(h.post(payload(h.ctx, 'quick', { submissionId: id(2) })).saved, true)
})

test('notifications beyond the hourly limit are suppressed and reported in the next sent mail', () => {
  const h = harness({ props: { NOTIFY_LIMIT_HOURLY: '1' } })
  assert.equal(h.post(payload(h.ctx, 'quick', { submissionId: id(1) })).notification, 'sent')
  const second = h.post(payload(h.ctx, 'quick', { submissionId: id(2) }))
  assert.equal(second.saved, true); assert.equal(second.notification, 'suppressed')
  assert.equal(h.post(payload(h.ctx, 'quick', { submissionId: id(3) })).notification, 'suppressed')
  assert.equal(h.state.mails.length, 1); assert.equal(rows(h), 4)
  h.state.now += HOUR
  assert.equal(h.post(payload(h.ctx, 'quick', { submissionId: id(4) })).notification, 'sent')
  assert.match(h.state.mails[1][2], /2 件/)
  h.post(payload(h.ctx, 'quick', { submissionId: id(5) }))
  h.state.now += HOUR
  h.post(payload(h.ctx, 'quick', { submissionId: id(6) }))
  assert.match(h.state.mails[2][2], /1 件/)
  assert.ok(h.state.logs.some(line => line.includes('"notification":"suppressed"')))
})

for (const [name, value] of [['SAVE_LIMIT_HOURLY', '0'], ['SAVE_LIMIT_HOURLY', 'many'], ['NOTIFY_LIMIT_HOURLY', '501']]) {
  test(`invalid ${name}=${value} fails closed as a configuration error without writes`, () => {
    const h = harness({ props: { [name]: value } })
    assert.equal(h.post(payload(h.ctx)).code, 'CONFIG_ERROR')
    assert.equal(h.state.writes, 0); assert.equal(h.state.mails.length, 0)
  })
}

test('unreadable save counters are rebuilt instead of blocking leads', () => {
  const h = harness({ props: { SAVE_BUDGET: 'PRIVATE corrupted' } })
  assert.equal(h.post(payload(h.ctx)).saved, true)
  assert.equal(JSON.parse(h.props.SAVE_BUDGET).saved, 1)
})

test('a counter write failure stops the save before any row or mail, and the same ID can retry', () => {
  const h = harness({ failPropertyWrite: true, props: { SAVE_LIMIT_HOURLY: '1', NOTIFY_LIMIT_HOURLY: '1' } })
  const p = payload(h.ctx)
  for (let i = 0; i < 3; i++) assert.equal(h.post(p).code, 'SAVE_FAILED')
  assert.equal(h.state.writes, 0); assert.equal(h.state.mails.length, 0); assert.equal(h.state.locked, false)
  h.state.failPropertyWrite = false
  assert.equal(h.post(p).saved, true); assert.equal(rows(h), 2)
  assert.equal(h.post(payload(h.ctx, 'quick', { submissionId: id(2) })).code, 'SAVE_LIMITED')
})

test('a failed notification keeps the carried-over omitted count for the next sent mail', () => {
  const h = harness({ props: { NOTIFY_LIMIT_HOURLY: '1' } })
  h.post(payload(h.ctx, 'quick', { submissionId: id(1) }))
  h.post(payload(h.ctx, 'quick', { submissionId: id(2) })); h.post(payload(h.ctx, 'quick', { submissionId: id(3) }))
  h.state.now += HOUR; h.state.failMail = true
  assert.equal(h.post(payload(h.ctx, 'quick', { submissionId: id(4) })).notification, 'failed')
  h.state.now += HOUR; h.state.failMail = false
  assert.equal(h.post(payload(h.ctx, 'quick', { submissionId: id(5) })).notification, 'sent')
  assert.match(h.state.mails.at(-1)[2], /2 件/)
})

test('owner helper reports save and notification counts without lead data', () => {
  const h = harness({ props: { NOTIFY_LIMIT_HOURLY: '1' } })
  const p = payload(h.ctx)
  h.post(p); h.post(payload(h.ctx, 'quick', { submissionId: id(2) }))
  const report = h.ctx.inspectOperations()
  assert.equal(report.saveHourCount, 2); assert.equal(report.notificationHourCount, 1); assert.equal(report.notificationsSuppressed, 1)
  for (const value of [p.name, p.email, p.submissionId]) assert.ok(!JSON.stringify(report).includes(value))
})

for (const prefix of ['=', '+', '-', '@']) {
  test(`spreadsheet text starting with ${prefix} is stored as literal text and stays idempotent`, () => {
    const h = harness(); const p = payload(h.ctx, 'quick', { name: `${prefix}1+1` })
    assert.equal(h.post(p).saved, true)
    const sheet = h.state.sheets.get('クイック診断')
    assert.equal(sheet.rows[1][sheet.rows[0].indexOf('氏名')], `'${prefix}1+1`)
    assert.equal(h.post(p).duplicate, true)
  })
}

test('name and email cells are formatted as plain text before the row is written', () => {
  const h = harness(); h.post(payload(h.ctx))
  const head = h.state.sheets.get('クイック診断').rows[0]
  const columns = h.state.formats.filter(f => f.row === 2 && f.format === '@').map(f => f.col).sort()
  assert.deepEqual(columns, [head.indexOf('氏名') + 1, head.indexOf('メール') + 1].sort())
})

test('the GAS manifest declares only the scopes the code needs', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../gas/appsscript.json', import.meta.url), 'utf8'))
  assert.deepEqual([...manifest.oauthScopes].sort(), [
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.send_mail',
    'https://www.googleapis.com/auth/spreadsheets',
  ])
  assert.ok(!/\b(GmailApp|DriveApp|DocumentApp|CalendarApp|FormApp|ScriptApp)\b/.test(gasSource))
})

function aiRun(props) {
  const h = harness({ enableAi: true, props })
  const p = payload(h.ctx)
  const saved = h.post(p)
  return { h, result: h.post({ action: 'get_advice', name: p.name, mode: p.mode, ratings: p.ratings, aiSession: saved.aiSession, challengeToken: h.humanToken() }) }
}

test('the Claude model defaults to the current ID and can be changed by script property', () => {
  const model = run => JSON.parse(run.h.state.requests.find(r => r.url.includes('anthropic')).init.payload).model
  assert.equal(model(aiRun({})), 'claude-sonnet-4-5')
  assert.equal(model(aiRun({ CLAUDE_MODEL: 'claude-sonnet-5-5' })), 'claude-sonnet-5-5')
})

test('an invalid Claude model setting fails before reserving AI quota', () => {
  const { h, result } = aiRun({ CLAUDE_MODEL: 'gpt-4' })
  assert.equal(result.code, 'AI_UNAVAILABLE')
  assert.ok(!h.state.requests.some(r => r.url.includes('anthropic')))
  assert.equal(h.props.AI_USAGE_BUDGET, undefined)
})

test('AI reservations wait up to five seconds for the shared lock', () => {
  const { h, result } = aiRun({})
  assert.equal(result.status, 'success')
  assert.ok(h.state.lockWaits.includes(5000))
  assert.ok(!h.state.lockWaits.includes(1000))
})
