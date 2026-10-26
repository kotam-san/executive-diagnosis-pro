import test from 'node:test'
import assert from 'node:assert/strict'
import { createSaveController, callGAS } from '../src/saveSubmission.js'
import { harness, payload } from './gasHarness.js'
import fs from 'node:fs'
import vm from 'node:vm'

const input = {name:'架空テスト',email:'person@example.test',mode:'quick',ratings:{項目:3}}
const success = body => ({status:'success',saved:true,submissionId:body.submissionId})

test('rapid repeated submission shares one request and one ID', async () => {
  let count=0,finish
  const c=createSaveController({createId:()=> 'test-submission-id-0001',send:body=>{count++;return new Promise(resolve=>{finish=()=>resolve(success(body))})}})
  const first=c.submit(input),second=c.submit(input)
  await Promise.resolve();assert.equal(count,1);assert.equal(first,second)
  finish();await first;await c.submit(input);assert.equal(count,1)
})
test('lost server response is retried with the exact same payload and ID', async () => {
  const sent=[];let ids=0
  const c=createSaveController({createId:()=>`id-${++ids}`,send:async body=>{sent.push(JSON.stringify(body));if(sent.length===1)throw new TypeError('network');return success(body)}})
  await assert.rejects(c.submit(input));await c.submit({...input, name:' 架空テスト '})
  assert.equal(sent[0],sent[1]);assert.equal(ids,1)
})
test('changed content after ambiguous failure is not sent with a new ID', async () => {
  let calls=0;const c=createSaveController({createId:()=> 'test-submission-id-0001',send:async()=>{calls++;throw Error('unknown')}})
  await assert.rejects(c.submit(input));await assert.rejects(c.submit({...input,email:'other@example.test'}),/前回/)
  assert.equal(calls,1)
})
test('explicit validation failure allows corrected input', async () => {
  let calls=0;const c=createSaveController({createId:()=> 'test-submission-id-0001',send:async body=>{if(++calls===1)throw Object.assign(Error('bad email'),{code:'INVALID_INPUT'});return success(body)}})
  await assert.rejects(c.submit(input));await c.submit({...input,email:'corrected@example.test'});assert.equal(calls,2)
})
for(const response of [{status:'success'}, {status:'success',saved:false}, {status:'error'}, {status:'success',saved:true,submissionId:'wrong'}]) {
  test(`unconfirmed response never completes the save: ${JSON.stringify(response)}`,async()=>{
    const c=createSaveController({createId:()=> 'test-submission-id-0001',send:async()=>response})
    await assert.rejects(c.submit(input))
  })
}
test('controller snapshots caller ratings and ignores key order',async()=>{
  const source={...input,ratings:{b:2,a:3}};let observed
  const c=createSaveController({createId:()=> 'test-submission-id-0001',send:async body=>{observed=body;return success(body)}})
  const p=c.submit(source);source.ratings.a=5;await p;assert.equal(observed.ratings.a,3)
  await c.submit({...input,ratings:{a:3,b:2}})
})
test('resetting a diagnosis creates a new submission ID',async()=>{
  let ids=0;const options={createId:()=>`test-submission-id-${++ids}`,send:async body=>success(body)}
  const a=await createSaveController(options).submit(input),b=await createSaveController(options).submit(input)
  assert.notEqual(a.submissionId,b.submissionId)
})
test('end-to-end save, response loss and retry writes once and notifies once',async()=>{
  const h=harness();const p=payload(h.ctx);let count=0
  const c=createSaveController({createId:()=> p.submissionId,send:async body=>{
    const result=h.post(body);if(++count===1)throw new TypeError('response lost');return result
  }})
  await assert.rejects(c.submit(p));const result=await c.submit(p)
  assert.equal(result.duplicate,true);assert.equal(h.state.sheets.get('クイック診断').rows.length,2);assert.equal(h.state.mails.length,1)
})
test('notification failure does not make frontend retry a confirmed save',async()=>{
  const h=harness({failMail:true});const p=payload(h.ctx)
  const c=createSaveController({createId:()=>p.submissionId,send:async body=>h.post(body)})
  assert.equal((await c.submit(p)).notification,'failed');await c.submit(p)
  assert.equal(h.state.sheets.get('クイック診断').rows.length,2)
})
test('transport keeps simple POST and propagates GAS error codes',async()=>{
  let request
  await assert.rejects(callGAS('https://invalid.test',input,{fetchImpl:async(url,init)=>{
    request=init;return {ok:true,json:async()=>({status:'error',code:'INVALID_INPUT',message:'確認してください'})}
  }}),error=>error.code==='INVALID_INPUT')
  assert.equal(request.method,'POST');assert.equal(request.headers,undefined);assert.deepEqual(JSON.parse(request.body),input)
})
for(const failure of ['http','json','network']) {
  test(`transport error ${failure} is surfaced`,async()=>{
    await assert.rejects(callGAS('https://invalid.test',input,{fetchImpl:async()=>{
      if(failure==='network')throw new TypeError('failed fetch')
      return {ok:failure!=='http',json:async()=>{throw new SyntaxError('not JSON')}}
    }}),/確認/)
  })
}
test('timeout aborts the request and presents a retry message',async()=>{
  await assert.rejects(callGAS('https://invalid.test',input,{timeoutMs:5,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})))
  })}),/同じ画面/)
})

test('new frontend against v15 is rejected before any sheet write, including retries', async () => {
  const h=harness();const oldContext=h.context()
  vm.runInContext(fs.readFileSync(new URL('./fixtures/Code.v15.gs',import.meta.url),'utf8'),oldContext)
  const c=createSaveController({createId:()=> 'test-submission-id-0001',send:async body=>h.post(body,oldContext)})
  await assert.rejects(c.submit(input));await assert.rejects(c.submit(input))
  assert.equal(h.state.writes,0);assert.equal(h.state.mails.length,0)
})

for (const code of ['INVALID_INPUT','BUSY','SAVE_LIMITED','CONFIG_ERROR','SCHEMA_MISMATCH']) {
  test(`${code} guarantees no write, so the ID is released and changed input may be sent`,async()=>{
    let calls=0,ids=0;const sent=[]
    const c=createSaveController({createId:()=>`test-submission-id-${++ids}`,send:async body=>{sent.push(body);if(++calls===1)throw Object.assign(Error(code),{code});return success(body)}})
    await assert.rejects(c.submit(input),error=>error.code===code)
    assert.equal(c.unconfirmed(),false)
    await c.submit({...input,email:'corrected@example.test'})
    assert.notEqual(sent[0].submissionId,sent[1].submissionId)
  })
}
for (const code of ['SAVE_FAILED','REQUEST_TIMEOUT','NETWORK_ERROR','ID_CONFLICT',undefined]) {
  test(`ambiguous failure ${code} keeps the save unconfirmed with the same ID`,async()=>{
    const c=createSaveController({createId:()=> 'test-submission-id-0001',send:async()=>{throw Object.assign(Error('unknown'),{code})}})
    await assert.rejects(c.submit(input))
    assert.equal(c.unconfirmed(),true)
  })
}
test('the save limit has its own retry message', async () => {
  await assert.rejects(callGAS('https://invalid.test',input,{fetchImpl:async()=>({ok:true,json:async()=>({status:'error',code:'SAVE_LIMITED'})})}),
    error=>error.code==='SAVE_LIMITED'&&/時間を置いて/.test(error.message))
})
test('a reset after an ambiguous save failure would duplicate the lead, so the screen must not offer it', async () => {
  // Documents why App.jsx hides the restart button while a save is unconfirmed.
  const h=harness();const p=payload(h.ctx);let ids=0
  const options={createId:()=>`test-submission-id-${String(++ids).padStart(4,'0')}`,send:async body=>{const result=h.post(body);if(ids===1)throw new TypeError('response lost');return result}}
  const first=createSaveController(options)
  await assert.rejects(first.submit(p));assert.equal(first.unconfirmed(),true)
  await createSaveController(options).submit(p)
  assert.equal(h.state.sheets.get('クイック診断').rows.length,3)
})
for (const code of ['BUSY','CONFIG_ERROR','SCHEMA_MISMATCH','INVALID_INPUT','SAVE_LIMITED']) {
  test(`${code} after an ambiguous attempt keeps the ID, because the earlier attempt may have saved`,async()=>{
    let calls=0
    const c=createSaveController({createId:()=> 'test-submission-id-0001',send:async()=>{throw Object.assign(Error('x'),{code:++calls===1?'NETWORK_ERROR':code})}})
    await assert.rejects(c.submit(input));await assert.rejects(c.submit(input),error=>error.code===code)
    assert.equal(c.unconfirmed(),true)
  })
}
test('end-to-end: saved response lost, then BUSY on retry, never creates a second row',async()=>{
  const h=harness();const p=payload(h.ctx);let attempt=0,ids=0
  const c=createSaveController({createId:()=>`test-submission-id-${String(++ids).padStart(4,'0')}`,send:async body=>{
    attempt++
    if(attempt===1){h.post(body);throw new TypeError('response lost')}
    if(attempt===2)throw Object.assign(Error('busy'),{code:'BUSY'})
    return h.post(body)
  }})
  await assert.rejects(c.submit(p));await assert.rejects(c.submit(p))
  assert.equal((await c.submit(p)).duplicate,true)
  assert.equal(h.state.sheets.get('クイック診断').rows.length,2);assert.equal(h.state.mails.length,1)
})
