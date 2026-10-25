// Read-only checks against the real local Wrangler static-assets runtime.
import assert from 'node:assert/strict'
const origin=process.argv[2] || 'http://127.0.0.1:8787'
const url=new URL(origin)
assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname), 'this command is local-only')
const response=await fetch(url)
assert.equal(response.status,200)
const csp=response.headers.get('content-security-policy')||''
for(const directive of ["default-src 'none'", "script-src-attr 'none'", 'https://www.1planet.jp', 'https://challenges.cloudflare.com']) assert.ok(csp.includes(directive),directive)
assert.equal(response.headers.get('x-content-type-options'),'nosniff')
assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin')
assert.ok(response.headers.get('strict-transport-security')?.includes('max-age=31536000'))
assert.ok(response.headers.get('permissions-policy')?.includes('camera=()'))
assert.equal(response.headers.get('x-frame-options'),null)
const html=await response.text()
const asset=html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1]
assert.ok(asset)
const js=await fetch(new URL(asset,url))
assert.equal(js.status,200)
assert.ok(js.headers.get('cache-control')?.includes('immutable'))
assert.equal(js.headers.get('x-content-type-options'),'nosniff')
console.log('Wrangler HTTP response headers verified for HTML and JavaScript.')
