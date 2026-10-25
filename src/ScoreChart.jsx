import { useEffect, useRef } from 'react'
import Chart from 'chart.js/auto'
import RenderBoundary from './RenderBoundary'

function Radar({ categories, ratings }) {
  const canvas = useRef(null)
  useEffect(() => {
    let chart
    try {
      const ctx = canvas.current.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')
      chart = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: categories.map(c => c.name),
          datasets: [{
            label: '現状スコア', data: categories.map(c => ratings[c.name]),
            backgroundColor: 'rgba(26, 77, 46, 0.2)', borderColor: '#1a4d2e', borderWidth: 2,
            pointBackgroundColor: categories.map(c => ratings[c.name] <= 2 ? '#ef4444' : '#1a4d2e'), pointRadius: 4,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { r: {
            min: 0, max: 5, ticks: { stepSize: 1, display: false }, grid: { color: 'rgba(0,0,0,0.05)' },
            pointLabels: { display: window.innerWidth >= 768, font: { size: 10, weight: '600' }, color: '#475569' },
          } },
          plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,23,42,0.9)', padding: 12 } },
        },
      })
    } catch (error) {
      // A Chart constructor can register an instance before it throws.
      Chart.getChart(canvas.current)?.destroy()
      throw error
    }
    return () => chart.destroy()
  }, [categories, ratings])
  return <div className="h-[400px] md:h-[550px] relative"><canvas ref={canvas} role="img" aria-label="各項目の満足度スコア。数値は下の項目別スコアで確認できます。" /></div>
}

export default function ScoreChart({ categories, ratings }) {
  return <>
    <RenderBoundary message="グラフを表示できませんでした。回答は保持されています。下の項目別スコアでも確認できます。" recoveryLabel="グラフを再表示する">
      <Radar categories={categories} ratings={ratings} />
    </RenderBoundary>
    <details className="mt-6 text-sm">
      <summary className="cursor-pointer font-bold text-slate-600">項目別のスコアを確認する</summary>
      <table className="w-full mt-3 text-left">
        <caption className="sr-only">回答した満足度（5点満点）</caption>
        <thead><tr><th scope="col" className="py-2">項目</th><th scope="col">スコア</th></tr></thead>
        <tbody>{categories.map(({ name }) => <tr key={name} className="border-t border-slate-100"><th scope="row" className="py-2 font-medium">{name}</th><td>{ratings[name]} / 5</td></tr>)}</tbody>
      </table>
    </details>
  </>
}
