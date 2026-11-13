// Plain-language summary for the top of the results: no total score, only the
// three most and least satisfied items. Ties keep the questionnaire order.
const validScore = score => Number.isInteger(score) && score >= 1 && score <= 5

export function summarize(categories, ratings) {
  const scored = (Array.isArray(categories) ? categories : [])
    .map(({ name }, order) => ({ name, score: ratings?.[name], order }))
    .filter(item => validScore(item.score))
  if (scored.length > 1 && scored.every(item => item.score === scored[0].score)) {
    return { high: [], low: [], flat: true }
  }
  const strip = ({ name, score }) => ({ name, score })
  const high = [...scored].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 3)
  const taken = new Set(high.map(item => item.order))
  const low = scored.filter(item => !taken.has(item.order))
    .sort((a, b) => a.score - b.score || a.order - b.order).slice(0, 3)
  return { high: high.map(strip), low: low.map(strip), flat: false }
}
