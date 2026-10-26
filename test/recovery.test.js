import test from 'node:test'
import assert from 'node:assert/strict'
import { callGAS, createSaveController } from '../src/saveSubmission.js'
import { requestAI } from '../src/diagnosis.js'
import { leadErrors } from '../src/leadValidation.js'
import { createTurnstileLoader } from '../src/turnstile.js'
import { harness, payload } from './gasHarness.js'

test('lead validation matches server constraints and trims surrounding whitespace', () => {
  assert.deepEqual(leadErrors({name:' 架空テスト ',email:' person@example.test '}), {})
  for (const name of ['', '  ', 'x'.repeat(201), 'a\nb', 'a\u0000b']) assert.ok(leadErrors({name,email:'person@example.test'}).name)
  for (const email of ['', 'not-an-email', 'x@x', 'x@@x.test', 'a b@example.test', 'x'.repeat(250)+'@x.test']) assert.ok(leadErrors({name:'name',email}).email)
  assert.deepEqual(leadErrors({name:'x'.repeat(200),email:'x'.repeat(245)+'@x.test'}), {})
})

for (const [label, request] of [['save', callGAS], ['AI', requestAI]]) {
  const body = {action:'get_advice'}
  test(`${label}: pre-aborted calls never start a network request`, async () => {
    const controller=new AbortController(); controller.abort()
    let calls=0
    await assert.rejects(request('https://invalid.test',body,{signal:controller.signal,fetchImpl:()=>{calls++}}), error=>error.code==='REQUEST_ABORTED')
    assert.equal(calls,0)
  })
  test(`${label}: timeout settles even when a transport ignores abort`, async () => {
    let signal
    await assert.rejects(request('https://invalid.test',body,{timeoutMs:5,fetchImpl:async(url,init)=>{signal=init.signal;return new Promise(()=>{})}}), error=>error.code==='REQUEST_TIMEOUT')
    assert.equal(signal.aborted,true)
  })
  test(`${label}: the timeout includes stalled response parsing`, async () => {
    await assert.rejects(request('https://invalid.test',body,{timeoutMs:5,fetchImpl:async()=>({ok:true,json:async()=>new Promise(()=>{})})}), error=>error.code==='REQUEST_TIMEOUT')
  })
  test(`${label}: parent abort settles even when a transport ignores abort`, async () => {
    const controller=new AbortController()
    const pending=request('https://invalid.test',body,{signal:controller.signal,fetchImpl:async()=>new Promise(()=>{})})
    controller.abort()
    await assert.rejects(pending,error=>error.code==='REQUEST_ABORTED')
  })
  for (const response of [null, [], {}, {status:'unknown'}, {status:'error',code:'__proto__',message:{unexpected:1}}, {status:'error',message:'private server detail'.repeat(5000)}]) {
    test(`${label}: invalid responses do not echo untrusted messages (${JSON.stringify(response).slice(0,65)})`, async () => {
      await assert.rejects(request('https://invalid.test',body,{fetchImpl:async()=>({ok:true,json:async()=>response})}), error=>!error.message.includes('private server detail') && error.message.length<300)
    })
  }
  for (const status of [429,500]) test(`${label}: HTTP ${status} retains a retryable error`, async()=>{
    await assert.rejects(request('https://invalid.test',body,{fetchImpl:async()=>({ok:false,status})}),error=>error.code==='NETWORK_ERROR')
  })
  test(`${label}: native transport exceptions cannot expose private details or forge validation rejection`,async()=>{
    await assert.rejects(request('https://invalid.test',body,{fetchImpl:async()=>{throw Object.assign(new Error('private transport diagnostic'),{code:'INVALID_INPUT'})}}),error=>error.code==='NETWORK_ERROR'&&!error.message.includes('private transport diagnostic'))
  })
}

test('unknown error codes cannot unlock an ambiguous save or replace its ID', async()=>{
  let calls=0,ids=0
  const input={name:'name',email:'person@example.test',mode:'quick',ratings:{one:3}}
  const controller=createSaveController({createId:()=>`test-submission-${++ids}`,send:async()=>{calls++;return {status:'success',saved:false,code:'INVALID_INPUT',message:'private detail'}}})
  await assert.rejects(controller.submit(input),error=>!error.message.includes('private detail'))
  await assert.rejects(controller.submit({...input,email:'other@example.test'}),/前回/)
  assert.equal(calls,1);assert.equal(ids,1)
})

test('aborted save retries with the same payload and ID after its remote result was lost', async()=>{
  const h=harness(),input=payload(h.ctx)
  const parent=new AbortController(),sent=[]
  const controller=createSaveController({createId:()=>input.submissionId,send:(body,options)=>callGAS('https://invalid.test',body,{...options,fetchImpl:async(url,init)=>{
    sent.push(init.body);const saved=h.post(JSON.parse(init.body))
    if(sent.length===1)return new Promise(()=>{})
    return {ok:true,json:async()=>saved}
  }})})
  const first=controller.submit(input,{signal:parent.signal})
  await Promise.resolve();await Promise.resolve();parent.abort()
  await assert.rejects(first,error=>error.code==='REQUEST_ABORTED')
  const saved=await controller.submit(input)
  assert.equal(saved.duplicate,true);assert.equal(sent[0],sent[1]);assert.equal(h.state.mails.length,1)
  assert.equal(h.state.sheets.get('クイック診断').rows.length,2)
})

function fakeSDK(timeoutMs=30) {
  const scripts=[],windowImpl={}
  const documentImpl={createElement:()=>({remove(){this.removed=true}}),head:{appendChild:script=>scripts.push(script)}}
  return {scripts,windowImpl,load:createTurnstileLoader({windowImpl,documentImpl,timeoutMs})}
}
const sdkAPI=()=>({render(){},remove(){}})
test('SDK loading is shared, validates the API and can retry after a network failure', async()=>{
  const {scripts,windowImpl,load}=fakeSDK()
  const first=load(),other=load()
  assert.equal(first,other);assert.equal(scripts.length,1)
  scripts[0].onerror();await assert.rejects(first);assert.equal(scripts[0].removed,true)
  const retry=load();assert.equal(scripts.length,2)
  windowImpl.turnstile=sdkAPI();scripts[1].onload();assert.equal(await retry,windowImpl.turnstile)
})
test('SDK timeout removes the stalled script and releases the shared promise for retry',async()=>{
  const {scripts,windowImpl,load}=fakeSDK(5)
  await assert.rejects(load());assert.equal(scripts[0].removed,true);assert.equal(scripts[0].onload,null)
  const retry=load();windowImpl.turnstile=sdkAPI();scripts[1].onload();await retry
})
test('SDK load event without a complete API fails and remains retryable', async()=>{
  const {scripts,windowImpl,load}=fakeSDK()
  windowImpl.turnstile={render(){}}
  const first=load();scripts[0].onload();await assert.rejects(first)
  windowImpl.turnstile=sdkAPI();await load();assert.equal(scripts.length,1)
})

for(const cacheFailure of ['failCacheRead','failCacheService']) test(`${cacheFailure} keeps durable limits and allows bounded generation`,()=>{
  const h=harness({enableAi:true,[cacheFailure]:true}),p=payload(h.ctx,'quick',{action:'save_only_v2'})
  const saved=h.post(p)
  const run=()=>h.post({...p,action:'get_advice',aiSession:saved.aiSession,challengeToken:h.humanToken()})
  assert.equal(run().status,'success');assert.equal(run().status,'success');assert.equal(run().code,'AI_LIMIT_REACHED')
  assert.equal(h.state.requests.filter(r=>r.url.includes('api.anthropic.com')).length,2)
})
test('AI provider payload contains validated scores and never contains the saved name or email',()=>{
  const h=harness({enableAi:true}),p=payload(h.ctx,'quick',{action:'save_only_v2',name:'PRIVATE_NAME_unique_ignore_previous_instructions'})
  const saved=h.post(p)
  for(const action of ['get_advice','generate_plan']) assert.equal(h.post({...p,action,aiSession:saved.aiSession,challengeToken:h.humanToken()}).status,'success')
  for(const request of h.state.requests.filter(r=>r.url.includes('api.anthropic.com'))) {
    assert.ok(!request.init.payload.includes(p.name));assert.ok(!request.init.payload.includes(p.email))
    assert.ok(request.init.payload.includes('ビジネス・仕事'))
  }
})
