import test from 'node:test'
import assert from 'node:assert/strict'
import {validateReleaseConfig} from '../scripts/release-config.mjs'
import {GAS_WEBAPP_URL} from '../src/data.js'

const good={VITE_TURNSTILE_SITE_KEY:'0x4AAAAA-example-public-key'}
for(const key of ['', 'local-browser-test-key', '1x00000000000000000000AA','1x00000000000000000000BB','2x00000000000000000000AB','3x00000000000000000000AA','3x00000000000000000000FF']) {
  test('release rejects missing or mock site key: '+key.slice(0,5),()=>assert.throws(()=>validateReleaseConfig({...good,VITE_TURNSTILE_SITE_KEY:key})))
}
test('release refuses alternate API URLs',()=>assert.throws(()=>validateReleaseConfig({...good,VITE_GAS_WEBAPP_URL:'http://127.0.0.1:4187/test-gas'})))
test('release rejects unexpected browser variables without echoing their secret values',()=>{
  assert.throws(()=>validateReleaseConfig({...good,VITE_CLAUDE_API_KEY:'PRIVATE_value'}),error=>!error.message.includes('PRIVATE_value'))
})
test('release accepts the approved endpoint and a public-key-shaped value only',()=>{
  assert.doesNotThrow(()=>validateReleaseConfig(good))
  assert.doesNotThrow(()=>validateReleaseConfig({...good,VITE_GAS_WEBAPP_URL:GAS_WEBAPP_URL}))
})
