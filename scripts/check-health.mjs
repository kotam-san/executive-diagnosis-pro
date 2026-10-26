// GET only: no registration, mail, AI generation, or submitted diagnostic data.
import assert from 'node:assert/strict'
import { GAS_WEBAPP_URL } from '../src/data.js'

const frontend='https://executive-diagnosis-pro.kota-m.workers.dev/'
const strict=process.argv.includes('--require-security-headers')
const response=await fetch(frontend,{signal:AbortSignal.timeout(15000),redirect:'follow'})
assert.equal(response.status,200,'frontend must return HTTP 200')
assert.ok((await response.text()).includes('経営者の「器」診断 Pro'),'expected application title')
if(strict) {
  assert.ok(response.headers.get('content-security-policy')?.includes('https://www.1planet.jp'),'published CSP')
  assert.equal(response.headers.get('x-content-type-options'),'nosniff')
}
assert.equal(new URL(GAS_WEBAPP_URL).hostname,'script.google.com','use the reviewed GAS endpoint')
const gas=await fetch(GAS_WEBAPP_URL,{signal:AbortSignal.timeout(15000),redirect:'follow'})
assert.equal(gas.status,200,'GAS health endpoint must return HTTP 200')
assert.equal((await gas.json()).status,'ok','GAS doGet health response')
console.log('Frontend and GAS GET health checks passed. Save, notification, and AI generation were not invoked.')
