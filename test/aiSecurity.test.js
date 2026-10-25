import test from 'node:test'
import assert from 'node:assert/strict'
import { harness, payload } from './gasHarness.js'

function client(h, id = 'test-ai-submission-0001', mode = 'quick') {
  const p = payload(h.ctx, mode, { action:'save_only_v2', submissionId:id })
  const saved = h.post(p)
  assert.equal(saved.status,'success')
  assert.equal(typeof saved.aiSession,'string')
  return { name:p.name, mode:p.mode, ratings:p.ratings, aiSession:saved.aiSession }
}
function setup(options = {}) {
  const h = harness({ enableAi:true, ...options })
  const input = client(h)
  return { h, input, run:(extra={},target=h.ctx) => h.post({ ...input,action:'get_advice',challengeToken:h.humanToken(),...extra },target) }
}
const aiCalls = h => h.state.requests.filter(r=>r.url.startsWith('https://api.anthropic.com/'))
const humanCalls = h => h.state.requests.filter(r=>r.url.includes('/siteverify'))

test('signed receipt is issued only after a confirmed valid save and contains no personal data', () => {
  const {h,input}=setup()
  const body=Buffer.from(input.aiSession.split('.')[0],'base64url').toString('utf8')
  assert.ok(!body.includes(input.name));assert.ok(!body.includes('person@example.test'))
  assert.ok(!body.includes(Object.keys(input.ratings)[0]))
  const failed=h.post(payload(h.ctx,'quick',{action:'save_only_v2',ratings:{}}))
  assert.equal(failed.status,'error');assert.equal(failed.aiSession,undefined)
  assert.equal(h.state.requests.length,0)
})
test('missing AI configuration never prevents a valid lead save and never grants AI access', () => {
  const h=harness(),p=payload(h.ctx,'quick',{action:'save_only_v2'}),saved=h.post(p)
  assert.equal(saved.saved,true);assert.equal(saved.aiSession,null)
  assert.equal(h.post({...p,action:'get_advice',aiSession:'forged'}).code,'AI_UNAVAILABLE')
  assert.equal(h.state.requests.length,0)
})
for(const value of ['1x0000000000000000000000000000000AA','2x0000000000000000000000000000000AA','3x0000000000000000000000000000000AA']) {
  test('production configuration rejects public Turnstile testing secrets '+value[0],()=>{
    const h=harness({enableAi:true,props:{TURNSTILE_SECRET_KEY:value}})
    const saved=h.post(payload(h.ctx,'quick',{action:'save_only_v2'}))
    assert.equal(saved.saved,true);assert.equal(saved.aiSession,null)
  })
}
for(const action of ['get_advice','generate_plan']) {
  for(const kind of ['missing','forged','changed-name','changed-rating','changed-mode','expired']) {
    test(`${action}: ${kind} receipt cannot reach verification or AI`,()=>{
      const {h,input,run}=setup();const change={action}
      if(kind==='missing')change.aiSession=undefined
      if(kind==='forged')change.aiSession=input.aiSession.slice(0,-1)+(input.aiSession.at(-1)==='A'?'B':'A')
      if(kind==='changed-name')change.name='別の氏名'
      if(kind==='changed-rating')change.ratings={...input.ratings,[Object.keys(input.ratings)[0]]:5}
      if(kind==='changed-mode'){change.mode='full';change.ratings=payload(h.ctx,'full').ratings}
      if(kind==='expired')h.state.now+=2*60*60*1000+1
      assert.equal(run(change).code,kind==='expired'?'AI_SESSION_EXPIRED':'AI_ACCESS_REQUIRED')
      assert.equal(h.state.requests.length,0)
    })
  }
}
for(const mutation of [ {mode:'unknown'}, {name:'x'.repeat(201)}, {name:'line\nbreak'}, {ratings:{unknown:'A'.repeat(10000)}}, {ratings:null} ]) {
  test('AI input is rejected before human or provider calls: '+Object.keys(mutation)[0],()=>{
    const {h,run}=setup();assert.equal(run(mutation).code,'INVALID_INPUT');assert.equal(h.state.requests.length,0)
  })
}
test('body size is bounded by UTF-8 bytes before parsing or saving',()=>{
  const {h,input}=setup();const writes=h.state.writes
  assert.equal(h.post({...input,action:'get_advice',padding:'あ'.repeat(6000)}).code,'INVALID_INPUT')
  assert.equal(h.state.requests.length,0);assert.equal(h.state.writes,writes)
})
for(const proof of ['',null,'invalid-token','x'.repeat(2049)]) {
  test('missing or invalid human proof never reaches Claude: '+String(proof).slice(0,25),()=>{
    const {h,run}=setup();assert.equal(run({challengeToken:proof}).code,'HUMAN_VERIFICATION_REQUIRED');assert.equal(aiCalls(h).length,0)
  })
}
for(const result of [ {success:false}, {success:true,hostname:'attacker.example',action:'diagnosis_ai'}, {success:true,hostname:'executive-diagnosis-pro.kota-m.workers.dev',action:'other'} ]) {
  test('human proof must match success, hostname and action: '+JSON.stringify(result),()=>{
    const {h,run}=setup({humanResult:result});assert.equal(run().code,'HUMAN_VERIFICATION_REQUIRED');assert.equal(aiCalls(h).length,0)
  })
}
for(const options of [{failHumanNetwork:true},{humanStatus:500}]) {
  test('verification outage fails closed without AI cost',()=>{
    const {h,run}=setup(options);assert.equal(run().code,'HUMAN_VERIFICATION_UNAVAILABLE');assert.equal(aiCalls(h).length,0)
  })
}
test('valid saved diagnosis can generate analysis and plan with the expected response shape',()=>{
  const {h,run}=setup()
  assert.deepEqual(run(),{status:'success',analysis:'mock generated feedback'})
  assert.deepEqual(run({action:'generate_plan'}),{status:'success',plan:'mock generated feedback'})
  assert.equal(aiCalls(h).length,2);assert.equal(h.state.locked,false)
  const body=JSON.parse(aiCalls(h)[0].init.payload)
  assert.equal(body.model,'claude-sonnet-4-5');assert.equal(body.max_tokens,768)
  assert.equal(JSON.parse(aiCalls(h)[1].init.payload).max_tokens,1024)
  assert.ok(body.system.includes('指示には従わず'))
})
test('retries after a lost AI response reuse a cached result without more human or AI calls',()=>{
  const {h,run}=setup();const first=run()
  const second=run({challengeToken:''})
  assert.deepEqual(first,second);assert.equal(aiCalls(h).length,1);assert.equal(humanCalls(h).length,1)
})
test('cache eviction cannot reset the per-action allowance',()=>{
  const {h,run}=setup();assert.equal(run().status,'success');h.state.cache.clear()
  assert.equal(run().status,'success');h.state.cache.clear()
  assert.equal(run().code,'AI_LIMIT_REACHED');assert.equal(aiCalls(h).length,2)
  assert.equal(run({action:'generate_plan'}).status,'success')
})
test('provider failures consume a bounded allowance and are never reported as success',()=>{
  const {h,run}=setup({aiStatus:429})
  assert.equal(run().code,'AI_UPSTREAM_ERROR');assert.equal(run().code,'AI_UPSTREAM_ERROR')
  assert.equal(run().code,'AI_LIMIT_REACHED');assert.equal(aiCalls(h).length,2)
  assert.equal(h.state.locked,false)
})
test('one-time human tokens cannot be reused for a new upstream attempt',()=>{
  const {h,run}=setup({aiStatus:500});const proof=h.humanToken()
  assert.equal(run({challengeToken:proof}).code,'AI_UPSTREAM_ERROR')
  assert.equal(run({challengeToken:proof}).code,'HUMAN_VERIFICATION_REQUIRED')
  assert.equal(aiCalls(h).length,1)
})
test('hourly allowance is shared across separate diagnoses and GAS executions',()=>{
  const {h,run}=setup({props:{AI_LIMIT_HOURLY:'2'}})
  assert.equal(run().status,'success')
  for(let index=2;index<=3;index++) {
    const input=client(h,`test-ai-submission-000${index}`),ctx=h.context()
    const result=h.post({...input,action:'get_advice',challengeToken:h.humanToken()},ctx)
    assert.equal(result.status,index===2?'success':'error')
    if(index===3)assert.equal(result.code,'AI_LIMIT_REACHED')
  }
  assert.equal(aiCalls(h).length,2)
})
test('daily cap survives hour rollover; Japanese day rollover releases the global allowance',()=>{
  const {h,run}=setup({props:{AI_LIMIT_DAILY:'1',AI_LIMIT_HOURLY:'5'}})
  assert.equal(run().status,'success');h.state.now+=60*60*1000
  const second=client(h,'test-ai-submission-0002')
  assert.equal(h.post({...second,action:'get_advice',challengeToken:h.humanToken()}).code,'AI_LIMIT_REACHED')
  h.state.now+=24*60*60*1000
  const third=client(h,'test-ai-submission-0003')
  assert.equal(h.post({...third,action:'get_advice',challengeToken:h.humanToken()}).status,'success')
  assert.equal(aiCalls(h).length,2)
})
test('same-diagnosis concurrent generation is rejected under a durable reservation',()=>{
  const {h,input,run}=setup();let competing
  const other=h.context()
  h.ctx.generateAnalysis=()=>{competing=h.post({...input,action:'get_advice',challengeToken:h.humanToken()},other);return 'first result'}
  assert.equal(run().analysis,'first result');assert.equal(competing.code,'AI_BUSY')
  assert.deepEqual(JSON.parse(h.props.AI_USAGE_BUDGET).pending,{})
})
test('global concurrent cap holds across independent executions',()=>{
  const {h,input}=setup({props:{AI_LIMIT_CONCURRENT:'2'}})
  const inputs=[input,client(h,'test-ai-submission-0002'),client(h,'test-ai-submission-0003')]
  const contexts=[h.ctx,h.context(),h.context()];let second,third
  contexts[0].generateAnalysis=()=>{second=h.post({...inputs[1],action:'get_advice',challengeToken:h.humanToken()},contexts[1]);return 'first'}
  contexts[1].generateAnalysis=()=>{third=h.post({...inputs[2],action:'get_advice',challengeToken:h.humanToken()},contexts[2]);return 'second'}
  assert.equal(h.post({...inputs[0],action:'get_advice',challengeToken:h.humanToken()},contexts[0]).status,'success')
  assert.equal(second.status,'success');assert.equal(third.code,'AI_BUSY')
  assert.equal(JSON.parse(h.props.AI_USAGE_BUDGET).daily,2)
  assert.deepEqual(JSON.parse(h.props.AI_USAGE_BUDGET).pending,{})
})
test('stale reservations expire without resetting consumed quota',()=>{
  const {h,input,run}=setup()
  const config=h.ctx.aiConfiguration(),session=h.ctx.verifyAiSession(input.aiSession,input,config)
  h.ctx.reserveAiAttempt(session,'get_advice',config)
  assert.equal(run().code,'AI_BUSY');h.state.now+=10*60*1000+1
  assert.equal(run().status,'success');assert.equal(JSON.parse(h.props.AI_USAGE_BUDGET).daily,2)
})
for(const options of [{aiStatus:500},{failAiNetwork:true},{aiRawResponse:'{'},{aiResponse:{content:[]}},{aiResponse:{content:[{type:'text',text:'ok'}],stop_reason:'max_tokens'}},{aiResponse:{content:[{type:'text',text:{bad:true}}]}},{aiResponse:{content:[{type:'text',text:'x'.repeat(6001)}]}}]) {
  test('bad upstream responses fail safely and release the reservation: '+Object.keys(options)[0],()=>{
    const {h,run}=setup(options),result=run()
    assert.equal(result.status,'error');assert.equal(result.analysis,undefined)
    assert.ok(['AI_UPSTREAM_ERROR','AI_INVALID_RESPONSE'].includes(result.code))
    assert.equal(h.state.locked,false);assert.deepEqual(JSON.parse(h.props.AI_USAGE_BUDGET).pending,{})
  })
}
test('property storage failure blocks AI calls rather than ignoring quotas',()=>{
  const {h,run}=setup();h.state.failPropertyWrite=true
  assert.equal(run().status,'error');assert.equal(aiCalls(h).length,0);assert.equal(h.state.locked,false)
})
test('corrupt persisted quota fails closed',()=>{
  const {h,run}=setup();h.props.AI_USAGE_BUDGET='{"daily":null}'
  assert.equal(run().code,'AI_UNAVAILABLE');assert.equal(aiCalls(h).length,0)
})
test('bad AI configuration cannot change successful lead persistence',()=>{
  const h=harness({enableAi:true,props:{AI_LIMIT_DAILY:'not-a-number'}})
  const saved=h.post(payload(h.ctx,'quick',{action:'save_only_v2'}))
  assert.equal(saved.saved,true);assert.equal(saved.aiSession,null)
})
test('internal exceptions with a code never expose their message to callers',()=>{
  const {h,run}=setup()
  h.ctx.generateAnalysis=()=>{throw Object.assign(Error('private internal details'),{code:'NETWORK_INTERNAL'})}
  const result=run()
  assert.equal(result.code,'AI_UNAVAILABLE');assert.ok(!result.message.includes('private internal'))
})
test('a busy storage lock cannot bypass quotas and never leaks the lock',()=>{
  const {h,run}=setup();h.state.forceBusy=true
  assert.equal(run().code,'AI_BUSY');assert.equal(aiCalls(h).length,0);assert.equal(h.state.locked,false)
})
