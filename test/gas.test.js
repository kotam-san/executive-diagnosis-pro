import test from 'node:test'
import assert from 'node:assert/strict'
import { categories } from '../src/data.js'
import { harness, payload } from './gasHarness.js'

function headers(ctx, mode) { return ['日時', '氏名', 'メール', 'モード', ...ctx.DIAGNOSIS_FIELDS[mode], '平均'] }
function sheetName(mode) { return mode === 'quick' ? 'クイック診断' : '精密診断' }

for (const mode of ['quick', 'full']) {
  test(`${mode}: fixed backend fields match the real questionnaire`, () => {
    const {ctx} = harness()
    assert.deepEqual(Array.from(ctx.DIAGNOSIS_FIELDS[mode]), categories.filter(c => mode === 'full' || c.quick).map(c => c.name))
  })
  test(`${mode}: new sheet has correctly mapped values, average and ID`, () => {
    const h = harness(); const p = payload(h.ctx, mode)
    const response = h.post(p)
    assert.equal(response.status, 'success'); assert.equal(response.saved, true)
    const rows = h.state.sheets.get(sheetName(mode)).rows
    assert.equal(rows.length, 2)
    assert.equal(rows[0].at(-1), '送信ID'); assert.equal(rows[1].at(-1), p.submissionId)
    for (const [name, value] of Object.entries(p.ratings)) assert.equal(rows[1][rows[0].indexOf(name)], value)
    assert.match(rows[1][rows[0].indexOf('平均')], /^=AVERAGE\(/)
    assert.equal(h.state.mails.length, 1); assert.equal(h.state.locked, false)
  })
  test(`${mode}: reordered request and existing headers preserve old rows and extra columns`, () => {
    const h = harness(); const p = payload(h.ctx, mode)
    const head = headers(h.ctx, mode).reverse(); head.splice(3, 0, '管理メモ')
    const old = head.map((_,i) => `old-${i}`); const before = [...old]
    const sheet = h.addSheet(sheetName(mode), [head, old])
    p.ratings = Object.fromEntries(Object.entries(p.ratings).reverse())
    assert.equal(h.post(p).status, 'success')
    assert.deepEqual(sheet.rows[1], before)
    assert.deepEqual(sheet.rows[0], [...head, '送信ID'])
    for (const [name, value] of Object.entries(p.ratings)) assert.equal(sheet.rows[2][head.indexOf(name)], value)
    assert.equal(sheet.rows[2][head.indexOf('管理メモ')], '')
    const formula = '=AVERAGE(' + h.ctx.DIAGNOSIS_FIELDS[mode].map(f => `${h.ctx.columnToLetter(head.indexOf(f)+1)}3`).join(',') + ')'
    assert.equal(sheet.rows[2][head.indexOf('平均')], formula)
  })
  test(`${mode}: legacy ID-less requests remain accepted with no deduplication`, () => {
    const h = harness(); const p = payload(h.ctx, mode); delete p.submissionId
    assert.equal(h.post(p).submissionId, null); assert.equal(h.post(p).status, 'success')
    assert.equal(h.state.sheets.get(sheetName(mode)).rows.length, 3)
    assert.equal(h.state.mails.length, 2)
  })
  test(`${mode}: matching retries write and notify once`, () => {
    const h = harness(); const p = payload(h.ctx, mode)
    assert.equal(h.post(p).duplicate, false)
    assert.equal(h.post({...p, ratings:Object.fromEntries(Object.entries(p.ratings).reverse())}).duplicate, true)
    assert.equal(h.state.sheets.get(sheetName(mode)).rows.length, 2)
    assert.equal(h.state.mails.length, 1)
  })
  for (const mutation of ['missing', 'extra', 'unknown', 'null', 'array', 'string', 'fraction', 'zero', 'six', 'boolean']) {
    test(`${mode}: rejects invalid answers: ${mutation} without writes or mail`, () => {
      const h = harness(); const p = payload(h.ctx, mode); const key = Object.keys(p.ratings)[0]
      if (mutation === 'missing') delete p.ratings[key]
      if (mutation === 'extra') p.ratings.extra = 3
      if (mutation === 'unknown') { delete p.ratings[key]; p.ratings.unknown = 3 }
      if (mutation === 'null') p.ratings = null
      if (mutation === 'array') p.ratings = Object.values(p.ratings)
      if (mutation === 'string') p.ratings[key] = '3'
      if (mutation === 'fraction') p.ratings[key] = 2.5
      if (mutation === 'zero') p.ratings[key] = 0
      if (mutation === 'six') p.ratings[key] = 6
      if (mutation === 'boolean') p.ratings[key] = true
      assert.equal(h.post(p).code, 'INVALID_INPUT'); assert.equal(h.state.writes, 0); assert.equal(h.state.mails.length, 0)
    })
  }
}

for (const extra of [{mode:'other'}, {mode:''}, {mode:null}, {name:' '}, {name:123}, {email:'bad'}, {email:''}, {submissionId:''}, {submissionId:3}, {submissionId:'=not-a-valid-id-123'}]) {
  test(`reject invalid metadata ${JSON.stringify(extra)}`, () => {
    const h = harness(); assert.equal(h.post(payload(h.ctx,'quick',extra)).code,'INVALID_INPUT'); assert.equal(h.state.writes,0)
  })
}
test('missing mode defaults to full for legacy callers', () => {
  const h = harness(); const p = payload(h.ctx,'full'); delete p.mode
  assert.equal(h.post(p).status,'success')
})
for (const failure of ['failOpen', 'failWrite', 'failFlush']) {
  test(`${failure}: no success or notification; lock is released`, () => {
    const h = harness({[failure]:true}); assert.equal(h.post(payload(h.ctx)).status,'error')
    assert.equal(h.state.mails.length,0); assert.equal(h.state.locked,false); assert.equal(h.state.acquires,h.state.releases)
  })
}
test('missing sheet config and busy lock cannot return success', () => {
  const h = harness({props:{SHEET_ID:''}}); assert.equal(h.post(payload(h.ctx)).code,'CONFIG_ERROR')
  const busy = harness({forceBusy:true}); assert.equal(busy.post(payload(busy.ctx)).code,'BUSY'); assert.equal(busy.state.writes,0)
})
test('mail failure remains saved and is not retried by a resubmission', () => {
  const h = harness({failMail:true}); const p = payload(h.ctx)
  const r = h.post(p); assert.equal(r.status,'success'); assert.equal(r.notification,'failed')
  h.state.failMail=false; assert.equal(h.post(p).duplicate,true); assert.equal(h.state.mails.length,0)
})
test('notification not configured is explicit', () => {
  const h = harness({props:{NOTIFY_EMAIL:''}}); assert.equal(h.post(payload(h.ctx)).notification,'not_configured')
})
test('flush failure after commit is recoverable with the same ID and no duplicate', () => {
  const h = harness({failFlush:true}); const p = payload(h.ctx)
  assert.equal(h.post(p).status,'error'); h.state.failFlush=false
  assert.equal(h.post(p).duplicate,true); assert.equal(h.state.sheets.get('クイック診断').rows.length,2)
  assert.equal(h.state.mails.length,0)
})
test('ID collision with different answers is rejected', () => {
  const h = harness(); const p = payload(h.ctx); h.post(p)
  p.ratings[Object.keys(p.ratings)[0]]=5
  assert.equal(h.post(p).code,'ID_CONFLICT'); assert.equal(h.state.mails.length,1)
})
for (const change of ['missing','duplicate','duplicateId']) {
  test(`corrupt existing schema: ${change} does not alter data`, () => {
    const h = harness(); const head = headers(h.ctx,'quick')
    if(change==='missing')head.pop()
    if(change==='duplicate')head.push(head[4])
    if(change==='duplicateId')head.push('送信ID','送信ID')
    const sheet=h.addSheet('クイック診断',[head]); const before=JSON.stringify(sheet.rows)
    assert.equal(h.post(payload(h.ctx)).code,'SCHEMA_MISMATCH'); assert.equal(JSON.stringify(sheet.rows),before)
  })
}
test('full sheet expands columns and a full grid expands rows', () => {
  const h=harness(); const sheet=h.addSheet('精密診断',[]); sheet.maxRows=1
  assert.equal(h.post(payload(h.ctx,'full')).status,'success'); assert.equal(sheet.maxRows,2); assert.equal(sheet.maxColumns,30)
})
for (const sameID of [true,false]) {
  test(`two independent executions interleaved during write (${sameID?'same':'different'} ID)`, () => {
    const h=harness(); const second=h.context(); const p=payload(h.ctx)
    const p2={...p,submissionId:sameID?p.submissionId:'test-submission-id-0002'}
    let competingResponse
    h.state.beforeWrite=()=>{ competingResponse=h.post(p2,second) }
    assert.equal(h.post(p).status,'success'); assert.equal(competingResponse.code,'BUSY')
    assert.equal(h.post(p2,second).duplicate,sameID)
    assert.equal(h.state.sheets.get('クイック診断').rows.length,sameID?2:3)
    assert.equal(h.state.mails.length,sameID?1:2)
    assert.equal(h.state.acquires,h.state.releases)
  })
}
test('formula-like names are written as literal text and remain idempotent', () => {
  const h=harness();const p=payload(h.ctx,'quick',{name:'=1+1'})
  assert.equal(h.post(p).status,'success');const sheet=h.state.sheets.get('クイック診断')
  assert.equal(sheet.rows[1][1],"'=1+1");assert.equal(h.post(p).duplicate,true)
})
test('malformed JSON and unknown action return errors', () => {
  const h=harness(); assert.equal(JSON.parse(h.ctx.doPost({postData:{contents:'{'}}).content).status,'error')
  assert.equal(h.post({action:'unknown'}).status,'error')
})
test('AI advice and plan actions keep their existing response interface', () => {
  const h=harness({enableAi:true});h.ctx.generateAnalysis=()=> 'fake advice';h.ctx.generateActionPlan=()=> 'fake plan'
  const p=payload(h.ctx,'quick',{action:'save_only_v2'}),saved=h.post(p),writes=h.state.writes,mails=h.state.mails.length
  const input={name:p.name,mode:p.mode,ratings:p.ratings,aiSession:saved.aiSession}
  assert.deepEqual(h.post({...input,action:'get_advice',challengeToken:h.humanToken()}),{status:'success',analysis:'fake advice'})
  assert.deepEqual(h.post({...input,action:'generate_plan',challengeToken:h.humanToken()}),{status:'success',plan:'fake plan'})
  assert.equal(h.state.writes,writes);assert.equal(h.state.mails.length,mails)
})

test('the same ID cannot be reused across diagnosis modes', () => {
  const h=harness();h.post(payload(h.ctx,'quick'))
  assert.equal(h.post(payload(h.ctx,'full')).code,'ID_CONFLICT')
  assert.equal(h.state.sheets.has('精密診断'),false);assert.equal(h.state.mails.length,1)
})
test('failure reading notification config does not turn a saved row into a save failure', () => {
  const h=harness();h.ctx.getNotifyEmail=()=>{throw Error('properties unavailable')}
  const result=h.post(payload(h.ctx));assert.equal(result.status,'success');assert.equal(result.notification,'failed')
})

test('v2 save requires an ID while the legacy save action remains supported', () => {
  const h=harness();const p=payload(h.ctx,'quick',{action:'save_only_v2'})
  assert.equal(h.post(p).saved,true)
  const noId={...p};delete noId.submissionId
  assert.equal(h.post(noId).code,'INVALID_INPUT')
})
