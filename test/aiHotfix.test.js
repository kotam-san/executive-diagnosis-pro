import test from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './gasHarness.js'

// Replace the network stub in a fresh context with one that records the Claude request.
function withClaude(content) {
  const h = harness({ props: { CLAUDE_API_KEY: 'test-key' } })
  const requests = []
  const ctx = h.context()
  ctx.UrlFetchApp = { fetch(url, options) {
    requests.push({ url, body: JSON.parse(options.payload) })
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content, stop_reason: 'end_turn' }) }
  } }
  return { ctx, requests }
}

test('AI requests use Sonnet 5.5 with thinking off and room for the requested length', () => {
  const { ctx, requests } = withClaude([{ type: 'text', text: 'ok' }])
  ctx.generateAnalysis('架空テスト', { 'ビジネス・仕事': 5 }, 'quick')
  ctx.generateActionPlan({ 'ビジネス・仕事': 5 })
  assert.equal(requests[0].body.model, 'claude-sonnet-5-5')
  assert.deepEqual(requests[0].body.thinking, { type: 'between_tools' })
  assert.deepEqual(requests.map(r => r.body.max_tokens), [768, 1024])
})

test('AI prompts ask for plain text within the length, because the screen shows Markdown symbols as-is', () => {
  const { ctx, requests } = withClaude([{ type: 'text', text: 'ok' }])
  ctx.generateAnalysis('架空テスト', { 'ビジネス・仕事': 5 }, 'quick')
  ctx.generateActionPlan({ 'ビジネス・仕事': 5 })
  assert.ok(requests[0].body.messages[0].content.includes('300文字を超えないでください'))
  assert.ok(requests[1].body.messages[0].content.includes('400文字を超えないでください'))
})

test('only text blocks reach the screen even when another block comes first', () => {
  const { ctx } = withClaude([{ type: 'thinking', thinking: '' }, { type: 'text', text: '本文' }])
  assert.equal(ctx.generateAnalysis('架空テスト', { 'ビジネス・仕事': 5 }, 'quick'), '本文')
})
