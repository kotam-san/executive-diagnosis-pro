// Verify the current production baseline (2026-10-27, GAS 18). This never calls GAS.
// Without --live, all checks are local. --live performs GETs for public assets only.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await fs.readFile(path.join(root, 'releases/production-2026-10-27.json'), 'utf8'))
const args = process.argv.slice(2)
assert.ok(args.every(arg => arg === '--live'), 'Supported argument: --live')
const sha256 = data => createHash('sha256').update(data).digest('hex')

for (const asset of manifest.assets) {
  const bytes = await fs.readFile(path.join(root, 'dist', asset.file))
  assert.equal(sha256(bytes), asset.sha256, `Build differs from production: ${asset.file}`)
  assert.equal(bytes.length, asset.bytes, `Build size differs: ${asset.file}`)
  console.log(`Build matches production: ${asset.file}`)
}
for (const [file, hash] of Object.entries(manifest.source_sha256)) {
  assert.equal(sha256(await fs.readFile(path.join(root, file))), hash, `Source differs from recorded baseline: ${file}`)
}
console.log('Recorded source fingerprints match')

if (args.includes('--live')) {
  for (const asset of manifest.assets) {
    const url = new URL(asset.url_path, manifest.frontend_origin)
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' })
    assert.equal(response.status, 200, `Unexpected response: ${url}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(sha256(bytes), asset.sha256, `Live asset differs: ${url}`)
    assert.equal(bytes.length, asset.bytes, `Live asset size differs: ${url}`)
    console.log(`Live GET matches production: ${asset.url_path}`)
  }
}
console.log('Production baseline verified; no deployment or GAS request was made')
