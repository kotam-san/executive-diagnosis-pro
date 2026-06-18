import { useState, useEffect, useRef } from 'react'
import Chart from 'chart.js/auto'
import { GAS_WEBAPP_URL, categories } from './data'

export default function App() {
  const [appPhase, setAppPhase]               = useState('welcome')
  const [diagMode, setDiagMode]               = useState('full')
  const [currentStep, setCurrentStep]         = useState(0)
  const [ratings, setRatings]                 = useState({})
  const [userInfo, setUserInfo]               = useState({ name: '', email: '' })
  const [aiAnalysis, setAiAnalysis]             = useState("")
  const [aiActionPlan, setAiActionPlan]         = useState("")
  const [isAnalyzing, setIsAnalyzing]           = useState(false)
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false)
  const [isMeetingRequested, setIsMeetingRequested] = useState(false)
  const [isSaving, setIsSaving]                 = useState(false)
  const [errorMsg, setErrorMsg]                 = useState("")
  const [agreedToPolicy, setAgreedToPolicy]     = useState(false)

  const chartRef      = useRef(null)
  const chartInstance = useRef(null)

  const activeCategories = diagMode === 'quick'
    ? categories.filter(c => c.quick)
    : categories

  const callGAS = async (body) => {
    const res  = await fetch(GAS_WEBAPP_URL, { method: 'POST', body: JSON.stringify(body) })
    const data = await res.json()
    if (data.status !== 'success') throw new Error(data.message || 'GASエラー')
    return data
  }

  const handleSubmitInfo = async () => {
    if (!userInfo.email || !userInfo.name) return
    setIsSaving(true)
    setErrorMsg("")
    try {
      await callGAS({
        action: 'save_only',
        name: userInfo.name,
        email: userInfo.email,
        ratings,
        mode: diagMode,
      })
    } catch (e) {
      console.error("保存エラー:", e.message)
    } finally {
      setIsSaving(false)
      setAppPhase('results')
    }
  }

  const generateAIAnalysis = async () => {
    if (isAnalyzing) return
    setIsAnalyzing(true)
    setAiAnalysis("AIコーチがあなたの回答を分析しています...")
    try {
      const data = await callGAS({
        action: 'get_advice',
        name: userInfo.name,
        ratings,
        mode: diagMode,
      })
      setAiAnalysis(data.analysis)
    } catch (e) {
      setAiAnalysis("分析の生成に失敗しました: " + e.message)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const generateActionPlan = async () => {
    if (isGeneratingPlan) return
    setIsGeneratingPlan(true)
    try {
      const data = await callGAS({ action: 'generate_plan', ratings })
      setAiActionPlan(data.plan)
    } catch (e) {
      setAiActionPlan("プランの生成に失敗しました。")
    } finally {
      setIsGeneratingPlan(false)
    }
  }

  const requestMeeting = async () => {
    try {
      await callGAS({ action: 'meeting_request', name: userInfo.name, email: userInfo.email })
      setIsMeetingRequested(true)
    } catch (e) {
      console.error("面談リクエストエラー:", e.message)
      setIsMeetingRequested(true)
    }
  }

  useEffect(() => {
    if (appPhase === 'results' && chartRef.current) {
      const ctx = chartRef.current.getContext('2d')
      if (chartInstance.current) chartInstance.current.destroy()
      const isMobile = window.innerWidth < 768
      chartInstance.current = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: activeCategories.map(c => c.name),
          datasets: [{
            label: '現状スコア',
            data: activeCategories.map(c => ratings[c.name] || 0),
            backgroundColor: 'rgba(26, 77, 46, 0.2)',
            borderColor: '#1a4d2e',
            borderWidth: 2,
            pointBackgroundColor: activeCategories.map(c => ratings[c.name] <= 2 ? '#ef4444' : '#1a4d2e'),
            pointRadius: 4,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              min: 0, max: 5,
              ticks: { stepSize: 1, display: false },
              grid: { color: 'rgba(0,0,0,0.05)' },
              pointLabels: {
                display: !isMobile,
                font: { size: 10, weight: '600' },
                color: '#475569',
              },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: 'rgba(15,23,42,0.9)', padding: 12 },
          },
        },
      })
    }
  }, [appPhase, ratings, activeCategories])

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">

        <header className="text-center mb-12 animate-in">
          <p className="text-[10px] tracking-[0.2em] text-emerald-700 font-black mb-3 uppercase">FOR EXECUTIVE LEADERSHIP</p>
          <h1 className="text-4xl md:text-5xl font-black text-slate-900 mb-4 tracking-tight">経営者の「器」診断 Pro</h1>
          <div className="h-1.5 w-24 bg-emerald-600 mx-auto rounded-full shadow-sm"></div>
        </header>

        {appPhase === 'welcome' && (
          <div className="bg-white rounded-[2rem] p-8 md:p-12 shadow-2xl border border-slate-100 text-center animate-in">
            <h2 className="text-2xl font-bold mb-8 text-slate-800">診断モードを選択してください</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <button onClick={() => { setDiagMode('quick'); setAppPhase('questions') }}
                className="p-8 border-2 border-emerald-50 rounded-3xl hover:border-emerald-500 hover:bg-emerald-50 transition-all group text-left">
                <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">⚡</div>
                <div className="font-bold text-xl mb-2 text-slate-900">クイック診断 (8問)</div>
                <p className="text-sm text-slate-500 leading-relaxed">主要項目で現状をマクロに把握。目安1分。</p>
              </button>
              <button onClick={() => { setDiagMode('full'); setAppPhase('questions') }}
                className="p-8 border-2 border-emerald-50 rounded-3xl hover:border-emerald-500 hover:bg-emerald-50 transition-all group text-left">
                <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">🔍</div>
                <div className="font-bold text-xl mb-2 text-slate-900">精密診断 (24問)</div>
                <p className="text-sm text-slate-500 leading-relaxed">深層心理までAIが分析。目安3分。</p>
              </button>
            </div>
          </div>
        )}

        {appPhase === 'questions' && (
          <div className="bg-white rounded-[2rem] p-10 shadow-2xl border border-slate-100 animate-in">
            <div className="flex justify-between items-center mb-10">
              <div className="px-5 py-2 bg-emerald-50 rounded-full text-[10px] font-black text-emerald-700 uppercase tracking-widest border border-emerald-100">
                {activeCategories[currentStep].domain}
              </div>
              <div className="text-slate-400 font-mono text-sm font-bold bg-slate-50 px-3 py-1 rounded-lg">
                {currentStep + 1} / {activeCategories.length}
              </div>
            </div>
            <h3 className="text-3xl md:text-4xl font-black text-slate-900 mb-6 leading-tight tracking-tight">
              {activeCategories[currentStep].name}
            </h3>
            <p className="text-xl text-slate-600 mb-14 leading-relaxed font-medium">
              {activeCategories[currentStep].question}
            </p>
            <div className="flex justify-between gap-3 md:gap-6 mb-14">
              {[1,2,3,4,5].map(n => (
                <button key={n}
                  onClick={() => {
                    const cat = activeCategories[currentStep]
                    setRatings(prev => ({ ...prev, [cat.name]: n }))
                    if (currentStep < activeCategories.length - 1) {
                      setTimeout(() => setCurrentStep(p => p + 1), 200)
                    } else {
                      setAppPhase('lead_capture')
                    }
                  }}
                  className={`flex-1 h-20 md:h-28 rounded-2xl font-black text-2xl transition-all active:scale-95
                    ${ratings[activeCategories[currentStep].name] === n
                      ? 'bg-emerald-700 text-white scale-105 shadow-xl ring-4 ring-emerald-100'
                      : 'bg-slate-50 text-slate-300 border border-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300'}`}>
                  {n}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-t border-slate-50 pt-6">
              <span>Low: 改善が必要</span>
              <span>High: 理想的な状態</span>
            </div>
          </div>
        )}

        {appPhase === 'lead_capture' && (
          <div className="bg-white rounded-[2rem] p-10 md:p-14 shadow-2xl border border-slate-100 text-center animate-in">
            <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-8">
              <span className="text-4xl">✨</span>
            </div>
            <h2 className="text-3xl font-black mb-4 tracking-tight">診断が完了しました</h2>
            <p className="text-slate-600 mb-12 text-lg font-medium leading-relaxed">
              AIコーチがあなたの「経営課題波及分析」を行います。<br/>
              フィードバックを生成するために、詳細を入力してください。
            </p>
            <div className="max-w-md mx-auto space-y-6 mb-8 text-left">
              <div>
                <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">お名前 *</label>
                <input type="text" value={userInfo.name}
                  onChange={e => setUserInfo({...userInfo, name: e.target.value})}
                  className="w-full p-4 rounded-xl bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 outline-none transition-all font-medium text-lg"
                  placeholder="姓名" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase tracking-widest">メールアドレス *</label>
                <input type="email" value={userInfo.email}
                  onChange={e => setUserInfo({...userInfo, email: e.target.value})}
                  className="w-full p-4 rounded-xl bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 outline-none transition-all font-medium text-lg"
                  placeholder="ex@company.com" />
              </div>

              <label className="flex items-start gap-3 cursor-pointer group">
                <input type="checkbox"
                  checked={agreedToPolicy}
                  onChange={e => setAgreedToPolicy(e.target.checked)}
                  className="mt-1 w-5 h-5 accent-emerald-600 cursor-pointer flex-shrink-0" />
                <span className="text-sm text-slate-600 leading-relaxed">
                  <a href="https://www.1planet.jp/privacy" target="_blank" rel="noopener noreferrer"
                    className="text-emerald-600 underline hover:text-emerald-800 font-bold">プライバシーポリシー</a>
                  に同意して、診断結果の表示および ONE PLANET からの情報提供を受けることに同意します。
                </span>
              </label>
            </div>

            <button onClick={handleSubmitInfo}
              disabled={!userInfo.email || !userInfo.name || !agreedToPolicy || isSaving}
              className="w-full py-6 bg-emerald-700 text-white rounded-2xl font-black text-xl shadow-2xl hover:bg-emerald-800 disabled:bg-slate-200 disabled:shadow-none transition-all flex items-center justify-center gap-3 active:scale-95">
              {isSaving ? "保存中..." : "📊 診断レポートを見る"}
            </button>
          </div>
        )}

        {appPhase === 'results' && (
          <div className="space-y-8 animate-in pb-24">

            <div className="bg-white rounded-[2.5rem] p-8 md:p-12 shadow-2xl border border-slate-100">
              <h3 className="font-black text-slate-400 tracking-[0.2em] uppercase text-xs mb-8">Satisfaction Balance Radar</h3>
              <div className="h-[400px] md:h-[550px] relative">
                <canvas ref={chartRef}></canvas>
              </div>
            </div>

            {errorMsg && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm font-bold">{errorMsg}</div>
            )}

            <div className="bg-slate-900 text-slate-50 rounded-[2.5rem] p-10 md:p-16 shadow-2xl border border-slate-800 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-12 opacity-5 text-[15rem] pointer-events-none font-serif italic">AI</div>

              <div className="mb-10 border-b border-slate-800 pb-10">
                <h3 className="text-3xl font-black flex items-center gap-4 tracking-tight mb-2">
                  <span className="bg-emerald-600 px-4 py-1 rounded-xl text-xs text-white uppercase font-black tracking-widest">AI Coach</span>
                  エグゼクティブ・フィードバック
                </h3>
                <p className="text-slate-500 font-medium">満足度スコアに基づく、経営者の「器」の解析結果</p>
              </div>

              {!aiAnalysis && !isAnalyzing ? (
                <div className="text-center py-12">
                  <button onClick={generateAIAnalysis}
                    className="px-12 py-5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black text-xl transition-all shadow-xl active:scale-95">
                    ✨ AIアドバイスを受ける
                  </button>
                  <p className="text-slate-500 text-sm mt-4">診断スコアをもとにAIが個別分析を行います</p>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <div className="absolute -left-6 top-0 bottom-0 w-1 bg-emerald-600 rounded-full opacity-50"></div>
                    <div className="text-slate-200 leading-[2.2] text-lg md:text-xl font-medium tracking-wide whitespace-pre-wrap pl-4">
                      {isAnalyzing ? "AIコーチがあなたの回答を分析しています..." : aiAnalysis}
                    </div>
                  </div>
                  {!isAnalyzing && aiAnalysis && (
                    <div className="mt-8 p-5 bg-slate-800/60 rounded-2xl border border-slate-700">
                      <p className="text-slate-400 text-xs leading-relaxed">
                        ⚠️ <span className="font-bold text-slate-300">ご注意：</span>
                        上記はAIによる自動生成のフィードバックです。回答内容に基づく参考情報としてご活用ください。
                        AIの性質上、実際の状況と異なる内容や不正確な表現が含まれる場合があります（ハルシネーション）。
                        重要な経営判断の際は、専門家への相談を推奨します。
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-16 bg-emerald-950/20 rounded-[2rem] p-10 border border-emerald-800/30">
                <div className="flex items-center justify-between mb-10 flex-wrap gap-6">
                  <h4 className="text-2xl font-black text-emerald-400 tracking-tight">✨ 具体的アクションプラン</h4>
                  {!aiActionPlan && (
                    <button onClick={generateActionPlan} disabled={isGeneratingPlan}
                      className="px-8 py-4 bg-emerald-700 hover:bg-emerald-600 rounded-2xl text-sm font-black transition-all shadow-lg active:scale-95 disabled:opacity-50">
                      {isGeneratingPlan ? "生成中..." : "✨ プランを提案させる"}
                    </button>
                  )}
                </div>
                {aiActionPlan ? (
                  <div className="whitespace-pre-wrap text-emerald-100/90 leading-relaxed text-lg border-l-2 border-emerald-600/30 pl-8 ml-2">
                    {aiActionPlan}
                  </div>
                ) : (
                  <p className="text-emerald-900/50 text-center py-8 font-bold italic tracking-widest uppercase text-sm">
                    Action items will be generated here
                  </p>
                )}
              </div>

              <div className="mt-20 p-10 md:p-14 bg-white/5 rounded-[3rem] border border-white/10 text-center">
                <div className="text-4xl mb-6">💬</div>
                <h4 className="text-3xl font-black mb-6 tracking-tight">さらなる高み、その先へ</h4>
                <p className="text-slate-400 mb-12 max-w-xl mx-auto leading-relaxed text-lg">
                  AIが指摘した課題を具体的にどう経営判断に活かすか。<br/>
                  30分の無料面談で、あなただけの「次の一手」を一緒に深掘りしませんか？
                </p>
                <a href="https://www.1planet.jp/contact" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 px-14 py-5 bg-emerald-600 text-white rounded-2xl font-black text-xl hover:bg-emerald-500 transition-all shadow-[0_20px_50px_rgba(5,150,105,0.3)] hover:-translate-y-1 active:scale-95 no-underline">
                  個別面談を依頼する →
                </a>
              </div>
            </div>

            <button onClick={() => {
              setAppPhase('welcome'); setRatings({}); setUserInfo({name:'',email:''})
              setAiAnalysis(''); setAiActionPlan(''); setIsMeetingRequested(false); setErrorMsg(''); setCurrentStep(0)
            }} className="w-full py-8 text-slate-400 font-black hover:text-slate-600 transition-all uppercase tracking-[0.3em] text-xs">
              診断を最初からリセットする
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
