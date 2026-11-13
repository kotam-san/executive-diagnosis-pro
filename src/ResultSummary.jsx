import { summarize } from './resultSummary.js'

const CONTACT_URL = 'https://www.1planet.jp/contact'

function ScoreList({ title, items }) {
  return <div>
    <h4 className="text-sm font-bold text-slate-600 mb-2">{title}</h4>
    <ul className="divide-y divide-slate-100">
      {items.map(({ name, score }) => <li key={name} className="flex justify-between gap-4 py-2">
        <span className="font-medium text-slate-800">{name}</span>
        <span className="shrink-0 font-bold text-slate-700">{score} / 5</span>
      </li>)}
    </ul>
  </div>
}

export default function ResultSummary({ name, categories, ratings }) {
  const { high, low, flat } = summarize(categories, ratings)
  return <section className="bg-white rounded-[2.5rem] p-6 md:p-12 shadow-2xl border border-slate-100">
    <h3 className="text-xl md:text-2xl font-black text-slate-900 mb-6 break-words">{name.trim()}さんの診断結果</h3>
    {flat
      ? <p className="text-slate-700 leading-relaxed">すべての項目が同じ点数でした。下のグラフと、AIのフィードバックをご覧ください。</p>
      : <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
        <ScoreList title="満足度が高い項目" items={high} />
        {low.length > 0 && <ScoreList title="満足度が低い項目" items={low} />}
      </div>}
    <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer"
      className="inline-block mt-6 text-sm font-bold text-emerald-700 underline">結果について、30分の無料面談で相談する →</a>
  </section>
}
