import test from 'node:test'
import assert from 'node:assert/strict'
import { categoriesFor, completeRatings, createRequestScope, requestAI } from '../src/diagnosis.js'

for (const mode of ['quick', 'full']) {
  test(`${mode}: only the exact complete questionnaire may proceed`, () => {
    const ratings = Object.fromEntries(categoriesFor(mode).map(({ name }) => [name, 3]))
    assert.equal(completeRatings(mode, ratings), true)
    const first = Object.keys(ratings)[0]
    const missing = { ...ratings }; delete missing[first]
    for (const invalid of [missing, { ...ratings, unknown: 3 }, { ...ratings, [first]: 0 }, { ...ratings, [first]: 6 }, { ...ratings, [first]: 2.5 }, { ...ratings, [first]: '3' }, { ...ratings, [first]: NaN }, null, []]) {
      assert.equal(completeRatings(mode, invalid), false)
    }
  })
}
test('unknown mode cannot produce a completed diagnosis', () => assert.equal(completeRatings('bad', {}), false))
test('reset aborts old transport and invalidates old success, error and finally callbacks', () => {
  const scope = createRequestScope(), old = scope.start('get_advice')
  assert.equal(scope.start('generate_plan'), null)
  scope.reset()
  assert.equal(old.controller.signal.aborted, true)
  assert.equal(scope.current(old), false)
  const current = scope.start('get_advice')
  scope.finish(old)
  assert.equal(scope.current(current), true)
  assert.equal(scope.start('generate_plan'), null)
  scope.finish(current)
  assert.ok(scope.start('generate_plan'))
})
test('even a transport that ignores abort cannot publish an old diagnosis', async () => {
  const scope = createRequestScope(), old = scope.start('get_advice')
  let finish, displayed = ''
  const pending = new Promise(resolve => { finish = resolve }).then(value => { if (scope.current(old)) displayed = value })
  scope.reset(); const current = scope.start('get_advice')
  displayed = 'new diagnosis'; finish('old diagnosis'); await pending
  assert.equal(displayed, 'new diagnosis'); assert.equal(scope.current(current), true)
})
for (const body of [null, {}, { status:'error', message:'rejected' }, { status:'success', analysis:{} }, { status:'success', analysis:[] }, { status:'success', analysis:'' }, { status:'success', analysis:'x'.repeat(6001) }]) {
  test('AI transport rejects untrusted response: ' + JSON.stringify(body).slice(0,70), async () => {
    await assert.rejects(requestAI('https://invalid.test', {action:'get_advice'}, { fetchImpl:async()=>({ok:true,json:async()=>body}) }))
  })
}
test('AI transport retains simple POST and accepts only text from the requested action', async () => {
  let sent
  const text=await requestAI('https://invalid.test',{action:'generate_plan'},{fetchImpl:async(url,init)=>{sent=init;return {ok:true,json:async()=>({status:'success',plan:'valid plan'})}}})
  assert.equal(text,'valid plan');assert.equal(sent.headers,undefined);assert.equal(sent.method,'POST')
})
test('AI timeout actually aborts and leaves a retryable error', async () => {
  await assert.rejects(requestAI('https://invalid.test',{action:'get_advice'},{timeoutMs:5,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error(),{name:'AbortError'}))))}),/時間/)
})
test('parent reset aborts the in-flight AI request', async () => {
  const parent=new AbortController()
  let called
  const request=requestAI('https://invalid.test',{action:'get_advice'},{signal:parent.signal,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>{called=signal;signal.addEventListener('abort',()=>reject(Object.assign(Error(),{name:'AbortError'})))})})
  parent.abort();await assert.rejects(request);assert.equal(called.aborted,true)
})
