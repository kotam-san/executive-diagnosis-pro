import test from 'node:test'
import assert from 'node:assert/strict'
import {harness,payload} from './gasHarness.js'

test('operational logs contain outcomes but no lead, receipt, token or provider credentials',()=>{
  const h=harness({enableAi:true}),p=payload(h.ctx,'quick',{action:'save_only_v2'})
  const saved=h.post(p),proof=h.humanToken()
  assert.equal(h.post({...p,action:'get_advice',aiSession:saved.aiSession,challengeToken:proof}).status,'success')
  h.post({...p,action:'generate_plan',aiSession:'invalid',challengeToken:'untrusted-human-token'})
  const log=h.state.logs.join('\n')
  for(const secret of [p.name,p.email,p.submissionId,saved.aiSession,proof,'fake-ai-key','fake-turnstile-secret','untrusted-human-token']) assert.ok(!log.includes(secret),secret)
  const events=h.state.logs.filter(line=>line.startsWith('{')).map(JSON.parse)
  assert.ok(events.some(event=>event.action==='save_only_v2'&&event.notification==='sent'))
  assert.ok(events.some(event=>event.action==='get_advice'&&event.outcome==='success'))
  assert.ok(events.some(event=>event.code==='AI_ACCESS_REQUIRED'&&event.outcome==='error'))
})
test('notification failures appear in aggregate events but confirmed saves remain successful',()=>{
  const h=harness({failMail:true}),p=payload(h.ctx)
  assert.equal(h.post(p).saved,true)
  assert.ok(h.state.logs.some(line=>line.includes('"notification":"failed"')))
})
test('registration notification uses the send-only service without Gmail inbox access',()=>{
  const h=harness()
  h.ctx.GmailApp={sendEmail(){throw Error('Gmail access must not be used')}}
  const result=h.post(payload(h.ctx))
  assert.equal(result.saved,true);assert.equal(result.notification,'sent');assert.equal(h.state.mails.length,1)
})
test('logging outages cannot change a confirmed save',()=>{
  const h=harness({failLogging:true})
  assert.equal(h.post(payload(h.ctx)).saved,true)
})
test('owner helper reports only configuration flags and recorded budget counts without side effects',()=>{
  const h=harness({enableAi:true}),p=payload(h.ctx,'quick',{action:'save_only_v2'})
  const saved=h.post(p)
  h.post({...p,action:'get_advice',aiSession:saved.aiSession,challengeToken:h.humanToken()})
  const network=h.state.requests.length,writes=h.state.writes,mails=h.state.mails.length
  const report=h.ctx.inspectOperations()
  assert.equal(report.aiConfigured,true);assert.equal(report.dayAttempts,1);assert.equal(report.pendingAttempts,0)
  assert.equal(h.state.requests.length,network);assert.equal(h.state.writes,writes);assert.equal(h.state.mails.length,mails)
  for(const value of [p.name,p.email,p.submissionId,h.props.CLAUDE_API_KEY,h.props.AI_SESSION_SECRET]) assert.ok(!JSON.stringify(report).includes(value))
  assert.equal(h.post({action:'inspectOperations'}).code,'INVALID_INPUT')
  assert.ok(!h.ctx.doGet({}).content.includes('dayAttempts'))
})
test('owner helper tolerates absent and unreadable usage without disclosing raw property text',()=>{
  const h=harness();assert.equal(h.ctx.inspectOperations().aiConfigured,false)
  h.props.AI_USAGE_BUDGET='PRIVATE corrupted data'
  const report=h.ctx.inspectOperations()
  assert.equal(report.usageUnreadable,true);assert.ok(!JSON.stringify(report).includes('PRIVATE'))
})
