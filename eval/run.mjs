// AIフィードバックの評価ランナー。
// gas/Code.gs を vm で読み込み、generateAnalysis / generateActionPlan が組み立てる
// Claude へのリクエストをそのまま取り出してから、ローカルから API を直接呼ぶ。
// GAS（本番・テスト用とも）には一切アクセスしない。
//
//   node eval/run.mjs --dry-run            リクエストの取り出しだけ（APIキー不要・費用なし）
//   node --env-file-if-exists=eval/.env.local eval/run.mjs [--repeat 2] [--model claude-...]
//   --model は作業ツリー版の CLAUDE_MODEL スクリプトプロパティとして渡す（本番版はコード内の固定モデル）
//
// APIキーは環境変数 ANTHROPIC_API_KEY から読む（eval/.env.local は .gitignore 済み）。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cases } from './cases.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const repeat = Number(args[args.indexOf('--repeat') + 1]) || 1
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : null

// 本番に出ている版と、作業ツリーの次回反映用の版を比べる
const versions = [
  { id: 'production', label: '本番（production-2026-10-19）',
    source: execFileSync('git', ['show', 'production-2026-10-19:gas/Code.gs'], { cwd: root, encoding: 'utf8' }) },
  { id: 'working', label: '作業ツリー（gas/Code.gs）',
    source: fs.readFileSync(path.join(root, 'gas/Code.gs'), 'utf8') },
]

// Code.gs が作る UrlFetchApp.fetch の引数をそのまま捕まえる
function captureRequest(source, invoke) {
  let captured = null
  const sandbox = {
    console: { log() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'CLAUDE_API_KEY' ? 'capture-only' : key === 'CLAUDE_MODEL' ? model : null }) },
    UrlFetchApp: {
      fetch(url, options) {
        captured = { url, headers: { ...options.headers }, body: JSON.parse(options.payload) }
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: 'captured' }], stop_reason: 'end_turn' }) }
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  invoke(sandbox)
  if (!captured || captured.url !== 'https://api.anthropic.com/v1/messages') throw new Error('Claude へのリクエストを取り出せませんでした')
  return captured
}

function buildJobs() {
  const jobs = []
  for (const version of versions) {
    for (const testCase of cases) {
      const ratings = JSON.parse(JSON.stringify(testCase.ratings))
      jobs.push({ version: version.id, caseId: testCase.id, action: 'analysis',
        request: captureRequest(version.source, gs => gs.generateAnalysis(testCase.name, ratings, testCase.mode)) })
      jobs.push({ version: version.id, caseId: testCase.id, action: 'plan',
        request: captureRequest(version.source, gs => gs.generateActionPlan(ratings)) })
    }
  }
  return jobs
}

async function callApi(request, apiKey) {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now()
    const response = await fetch(request.url, {
      method: 'POST',
      headers: { ...request.headers, 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(request.body),
    })
    const data = await response.json().catch(() => null)
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)))
      continue
    }
    return { status: response.status, ms: Date.now() - started, data }
  }
}

// 画面に出る文字列：本番版は content[0].text をそのまま返し、途中切れでも表示する。
// 作業ツリー版は max_tokens で止まると AI_INVALID_RESPONSE（エラー表示）にする。
function shownText(version, data) {
  if (!data?.content?.length) return null
  if (version === 'production') return data.content[0].text ?? null
  if (data.stop_reason === 'max_tokens') return null
  return data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

function checks(job, testCase, data) {
  const text = data?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
  const chars = text.replace(/\s/g, '').length
  const [min, max] = job.action === 'analysis' ? [200, 300] : [300, 400]
  const scores = Object.values(testCase.ratings)
  const lowest = Math.min(...scores)
  const lowestFields = Object.keys(testCase.ratings).filter(field => testCase.ratings[field] === lowest && lowest < Math.max(...scores))
  const surname = testCase.name.split(/[\s（(]/)[0]
  return {
    stopReason: data?.stop_reason ?? null,
    outputTokens: data?.usage?.output_tokens ?? null,
    inputTokens: data?.usage?.input_tokens ?? null,
    chars,
    withinLength: chars >= min && chars <= max,
    truncated: data?.stop_reason === 'max_tokens',
    markdown: /\*\*|^#{1,6}\s|^\s*[-*]\s/m.test(text),
    usesName: text.includes(surname),
    lowestMentioned: lowestFields.length ? `${lowestFields.filter(field => text.includes(field)).length}/${lowestFields.length}` : '-',
    mentionsUtsuwa: text.includes('器'),
    asciiHeavy: (text.match(/[A-Za-z]/g) ?? []).length > text.length * 0.3,
  }
}

function report(results, outDir) {
  const lines = ['# AIフィードバック評価結果', '', `実行：${new Date().toLocaleString('ja-JP')}　モデル：${[...new Set(results.map(r => r.request.body.model))].join(', ')}`, '']
  lines.push('## 自動チェック一覧', '', '| ケース | 版 | 種別 | 回 | 文字数 | 目安内 | 途中切れ | Markdown | 名前 | 最低点項目への言及 | 「器」 |', '|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of results) {
    const c = r.checks
    lines.push(`| ${r.caseId} | ${r.version} | ${r.action} | ${r.run} | ${c.chars} | ${c.withinLength ? '○' : '×'} | ${c.truncated ? '**切れ**' : ''} | ${c.markdown ? 'あり' : ''} | ${c.usesName ? '○' : ''} | ${c.lowestMentioned} | ${c.mentionsUtsuwa ? '○' : ''} |`)
  }
  for (const testCase of cases) {
    lines.push('', `## ${testCase.id}（${testCase.mode === 'quick' ? 'クイック8問' : '精密24問'}）`, '', `狙い：${testCase.intent}`, '',
      `スコア：${Object.entries(testCase.ratings).map(([field, score]) => `${field} ${score}`).join(' / ')}`)
    for (const r of results.filter(r => r.caseId === testCase.id)) {
      lines.push('', `### ${r.version} / ${r.action} / ${r.run}回目（${r.checks.chars}字・${r.ms}ms・stop=${r.checks.stopReason}）`, '')
      if (r.status !== 200) lines.push(`HTTP ${r.status}: ${JSON.stringify(r.data?.error ?? r.data)}`)
      else lines.push(r.shown === null ? '> 【画面ではエラー表示になる】生成文：' : '', ...(r.rawText || '').split('\n').map(line => `> ${line}`))
    }
  }
  fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n') + '\n')
}

const jobs = buildJobs()
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = path.join(here, 'results', dryRun ? 'dry-run' : stamp)
fs.mkdirSync(outDir, { recursive: true })

if (dryRun) {
  const sample = jobs.filter(job => ['q-biz-high-private-low', 'f-biz-high-private-low'].includes(job.caseId))
  fs.writeFileSync(path.join(outDir, 'requests.json'), JSON.stringify(jobs.map(({ request, ...job }) => ({ ...job, body: request.body })), null, 2))
  console.log(`取り出したリクエスト：${jobs.length}件（${versions.length}版 × ${cases.length}ケース × 2種別）→ ${path.relative(root, outDir)}/requests.json`)
  for (const job of sample.slice(0, 4)) {
    console.log(`\n--- ${job.version} / ${job.caseId} / ${job.action} ---`)
    console.log(JSON.stringify({ ...job.request.body, messages: undefined }))
    console.log(job.request.body.messages[0].content)
  }
  process.exit(0)
}

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY が未設定です。eval/.env.local に ANTHROPIC_API_KEY=... を書き、--env-file-if-exists=eval/.env.local を付けて実行してください。')
  process.exit(1)
}

const queue = []
for (let run = 1; run <= repeat; run++) for (const job of jobs) queue.push({ ...job, run })
const results = []
let next = 0
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < queue.length) {
    const job = queue[next++]
    const testCase = cases.find(c => c.id === job.caseId)
    const { status, ms, data } = await callApi(job.request, apiKey)
    const rawText = data?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
    results.push({ ...job, status, ms, data, rawText, shown: shownText(job.version, data), checks: checks(job, testCase, data) })
    process.stdout.write(`${results.length}/${queue.length} ${job.version} ${job.caseId} ${job.action} HTTP ${status}\n`)
  }
}))

const order = job => [versions.findIndex(v => v.id === job.version), cases.findIndex(c => c.id === job.caseId), job.action, job.run]
results.sort((a, b) => { const x = order(a), y = order(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0 })
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results.map(({ request, ...r }) => ({ ...r, requestBody: request.body })), null, 2))
report(results, outDir)
// 100万トークンあたりのドル単価（入力, 出力）。表にないモデルは費用を出さない
const prices = { 'claude-sonnet-4-5': [3, 15], 'claude-sonnet-5-5': [2, 10] }
const usage = results.reduce((sum, r) => {
  const input = r.data?.usage?.input_tokens ?? 0, output = r.data?.usage?.output_tokens ?? 0
  const price = prices[r.request.body.model]
  return { input: sum.input + input, output: sum.output + output, cost: price && sum.cost !== null ? sum.cost + (input * price[0] + output * price[1]) / 1e6 : null }
}, { input: 0, output: 0, cost: 0 })
const msOf = (version, action) => results.filter(r => r.version === version && r.action === action && r.status === 200).map(r => r.ms).sort((a, b) => a - b)
for (const version of versions) for (const action of ['analysis', 'plan']) {
  const ms = msOf(version.id, action)
  if (ms.length) console.log(`${version.id} ${action}：中央値${ms[Math.floor(ms.length / 2)]}ms・最大${ms[ms.length - 1]}ms（${ms.length}件）`)
}
console.log(`\n完了：${path.relative(root, outDir)}/report.md　入力${usage.input}・出力${usage.output}トークン（${usage.cost === null ? '単価未登録のモデルを含むため費用は未計算' : `約$${usage.cost.toFixed(3)}`}）`)
