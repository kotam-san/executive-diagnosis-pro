import test from 'node:test'
import assert from 'node:assert/strict'
import { categoriesFor } from '../src/diagnosis.js'
import { summarize } from '../src/resultSummary.js'

const named = names => names.map(name => ({ name }))
const pick = list => list.map(({ name, score }) => `${name}:${score}`)

test('quick (8 items): three highest and three lowest, never overlapping', () => {
  const categories = categoriesFor('quick')
  assert.equal(categories.length, 8)
  const ratings = Object.fromEntries(categories.map(({ name }, i) => [name, [5, 1, 4, 2, 3, 5, 1, 4][i]]))
  const result = summarize(categories, ratings)
  const n = categories.map(c => c.name)
  assert.equal(result.flat, false)
  assert.deepEqual(pick(result.high), [`${n[0]}:5`, `${n[5]}:5`, `${n[2]}:4`])
  assert.deepEqual(pick(result.low), [`${n[1]}:1`, `${n[6]}:1`, `${n[3]}:2`])
})

test('full (24 items): picks the extremes from all categories', () => {
  const categories = categoriesFor('full')
  assert.equal(categories.length, 24)
  const ratings = Object.fromEntries(categories.map(({ name }) => [name, 3]))
  ratings[categories[23].name] = 5
  ratings[categories[10].name] = 1
  const result = summarize(categories, ratings)
  assert.equal(result.high[0].name, categories[23].name)
  assert.equal(result.low[0].name, categories[10].name)
  assert.equal(result.high.length, 3)
  assert.equal(result.low.length, 3)
  const highNames = new Set(result.high.map(item => item.name))
  assert.ok(result.low.every(item => !highNames.has(item.name)))
})

test('ties keep the category order', () => {
  const categories = named(['A', 'B', 'C', 'D', 'E', 'F'])
  const result = summarize(categories, { A: 3, B: 4, C: 4, D: 4, E: 4, F: 2 })
  assert.deepEqual(pick(result.high), ['B:4', 'C:4', 'D:4'])
  assert.deepEqual(pick(result.low), ['F:2', 'A:3', 'E:4'])
})

test('every category with the same score is reported as flat', () => {
  const categories = named(['A', 'B', 'C', 'D'])
  assert.deepEqual(summarize(categories, { A: 3, B: 3, C: 3, D: 3 }), { high: [], low: [], flat: true })
})

test('scores that are not integers from 1 to 5 are not counted', () => {
  const categories = named(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
  const result = summarize(categories, { A: 5, B: 0, C: 6, D: 2.5, E: '4', F: 1, H: 3 })
  assert.deepEqual(pick(result.high), ['A:5', 'H:3', 'F:1'])
  assert.deepEqual(result.low, [])
  assert.deepEqual(summarize(categories, { A: 5, B: null }), { high: [{ name: 'A', score: 5 }], low: [], flat: false })
})

test('fewer than six scored items never repeat an item', () => {
  const result = summarize(named(['A', 'B', 'C', 'D']), { A: 1, B: 2, C: 3, D: 4 })
  assert.deepEqual(pick(result.high), ['D:4', 'C:3', 'B:2'])
  assert.deepEqual(pick(result.low), ['A:1'])
})

test('missing or empty input yields an empty, non-flat summary', () => {
  assert.deepEqual(summarize([], {}), { high: [], low: [], flat: false })
  assert.deepEqual(summarize(named(['A']), null), { high: [], low: [], flat: false })
})
