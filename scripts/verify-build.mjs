import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.argv[2] || 'dist')
const headers = await fs.readFile(path.join(root, '_headers'), 'utf8')
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8')
assert.equal(headers, await fs.readFile('public/_headers', 'utf8'), 'build must carry the reviewed security headers')
assert.ok(!/unsafe-eval|script-src[^;]*unsafe-inline|X-Frame-Options/i.test(headers), 'do not relax script execution or break the authorized iframe')
for (const directive of ["default-src 'none'", "object-src 'none'", "base-uri 'none'", "script-src-attr 'none'", "frame-ancestors 'self' https://www.1planet.jp https://1planet.jp"]) assert.ok(headers.includes(directive), directive)
for (const name of ['X-Content-Type-Options: nosniff', 'Permissions-Policy:', 'Referrer-Policy:', 'Strict-Transport-Security:']) assert.ok(headers.includes(name), name)
for (const host of ['https://challenges.cloudflare.com', 'https://script.google.com', 'https://script.googleusercontent.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com']) assert.ok(headers.includes(host), host)
assert.ok([...headers.split('\n')].every(line=>line.length<=2000), 'Cloudflare header line limit')
assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'HTML must not require inline scripts')
const scripts=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match=>match[1])
assert.ok(scripts.length>0, 'module script must be present')
for(const asset of scripts) {
  assert.ok(/^\/assets\/[A-Za-z0-9_-]+\.js$/.test(asset), 'local fingerprinted scripts only')
  const source=await fs.readFile(path.join(root,asset),'utf8')
  assert.ok(!/sk-ant-[A-Za-z0-9_-]{16,}/.test(source), 'no provider secret in browser code')
  assert.ok(!/local-browser-test-key|127\.0\.0\.1:4187|localhost:4187/.test(source), 'production build cannot point to mock services')
}
console.log('Built assets and security headers verified.')
