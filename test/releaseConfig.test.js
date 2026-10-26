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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'

function fakeDist(script) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'diagnosis-dist-'))
  fs.mkdirSync(path.join(root,'assets'))
  fs.copyFileSync('public/_headers',path.join(root,'_headers'))
  fs.writeFileSync(path.join(root,'index.html'),'<script type="module" crossorigin src="/assets/index-abc123.js"></script>')
  fs.writeFileSync(path.join(root,'assets/index-abc123.js'),script)
  return root
}
const verify=(root,env={},release=true)=>spawnSync(process.execPath,['scripts/verify-build.mjs',root,...(release?['--release']:[])],{encoding:'utf8',env:{...process.env,...env}})

test('release artifact check accepts a build that carries the configured public site key',()=>{
  const result=verify(fakeDist('const k="0x4AAAAA-example-public-key"'),good)
  assert.equal(result.status,0,result.stderr)
})
test('release artifact check rejects a build made without the public site key',()=>{
  const result=verify(fakeDist('const k=""'),good)
  assert.notEqual(result.status,0)
})
test('release artifact check rejects a missing or mock site key in the environment',()=>{
  const result=verify(fakeDist('const k="local-browser-test-key"'),{VITE_TURNSTILE_SITE_KEY:'local-browser-test-key'})
  assert.notEqual(result.status,0)
})
test('the plain artifact check still runs without release settings',()=>{
  assert.equal(verify(fakeDist('const k=""'),{},false).status,0)
})
test('deploy scripts verify the release build and never rebuild after GAS is updated',()=>{
  const {scripts}=JSON.parse(fs.readFileSync('package.json','utf8'))
  assert.match(scripts['build:release'],/verify-release-config\.mjs.*vite build.*verify-build\.mjs.*--release/)
  assert.match(scripts['deploy:built'],/verify-build\.mjs.*--release.*wrangler deploy/)
  assert.ok(!/vite build/.test(scripts['deploy:built']))
  assert.match(scripts.deploy,/build:release.*deploy:built/)
})
