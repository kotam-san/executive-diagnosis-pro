import { useState, useEffect, useRef, useMemo } from 'react'
import { GAS_WEBAPP_URL, categories } from './data'
import { createSaveController, callGAS as requestGAS } from './saveSubmission'
import { completeRatings, createRequestScope, requestAI } from './diagnosis'
import HumanVerification from './HumanVerification'
import { leadErrors } from './leadValidation'
import ScoreChart from './ScoreChart'
import ResultSummary from './ResultSummary'
import RenderBoundary from './RenderBoundary'

const TURNSTILE_SITE_KEY = import.meta.env?.VITE_TURNSTILE_SITE_KEY || ''

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
  const [isSaving, setIsSaving]                 = useState(false)
  const [errorMsg, setErrorMsg]                 = useState("")
  const [agreedToPolicy, setAgreedToPolicy]     = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [aiSession, setAiSession] = useState('')
  const [challengeToken, setChallengeToken] = useState('')
  const [challengeReset, setChallengeReset] = useState(0)
  const [analysisError, setAnalysisError] = useState('')
  const [planError, setPlanError] = useState('')
  const [inputErrors, setInputErrors] = useState({})
  const [saveUnconfirmed, setSaveUnconfirmed] = useState(false)

  const answerTimer = useRef(null)
  const answering = useRef(false)
  const ratingsSnapshot = useRef({})
  const requestScope = useRef(null)
  const nameInput = useRef(null)
  const emailInput = useRef(null)
  const consentInput = useRef(null)
  if (!requestScope.current) requestScope.current = createRequestScope()

  const activeCategories = useMemo(() => diagMode === 'quick'
    ? categories.filter(c => c.quick)
    : categories, [diagMode])
  const currentCategory = activeCategories[currentStep]
  const canGenerate = Boolean(aiSession && TURNSTILE_SITE_KEY && challengeToken && !isAnalyzing && !isGeneratingPlan)

  const sendSave = (body, options) => requestGAS(GAS_WEBAPP_URL, body, options)
  const saveController = useRef(null)
  if (!saveController.current) saveController.current = createSaveController({ send: sendSave })

  const handleSubmitInfo = async event => {
    event.preventDefault()
    if (isSaving) return
    const errors = leadErrors(userInfo)
    if (!agreedToPolicy) errors.consent = 'プライバシーポリシーへの同意にチェックを入れてください。'
    setInputErrors(errors)
    const firstError = [['name', nameInput], ['email', emailInput], ['consent', consentInput]].find(([key]) => errors[key])
    if (firstError) {
      firstError[1].current?.focus()
      return
    }
    if (!event.currentTarget.reportValidity()) return
    if (!completeRatings(diagMode, ratingsSnapshot.current)) {
      setErrorMsg('回答を確認できませんでした。診断を最初からやり直してください。')
      return
    }
    const request = requestScope.current.start('save')
    if (!request) return
    setIsSaving(true)
    setSaveUnconfirmed(true)
    setErrorMsg("")
    try {
      const data = await saveController.current.submit({
        name: userInfo.name, email: userInfo.email, ratings: ratingsSnapshot.current, mode: diagMode,
      }, { signal: request.controller.signal })
      if (!requestScope.current.current(request)) return
      setAiSession(typeof data.aiSession === 'string' ? data.aiSession : '')
      setAppPhase('results')
    } catch (e) {
      if (requestScope.current.current(request)) {
        setErrorMsg(e.message || '保存を確認できませんでした。同じ画面からもう一度お試しください。')
        setSaveUnconfirmed(saveController.current.unconfirmed())
      }
    } finally {
      if (requestScope.current.current(request)) setIsSaving(false)
      requestScope.current.finish(request)
    }
  }

  const generateAI = async (action) => {
    if (!canGenerate || !completeRatings(diagMode, ratingsSnapshot.current)) return
    const request = requestScope.current.start(action)
    if (!request) return
    const analysis = action === 'get_advice'
    const setBusy = analysis ? setIsAnalyzing : setIsGeneratingPlan
    const setText = analysis ? setAiAnalysis : setAiActionPlan
    const setError = analysis ? setAnalysisError : setPlanError
    setBusy(true)
    setError('')
    try {
      const text = await requestAI(GAS_WEBAPP_URL, {
        action, name: userInfo.name.trim(), mode: diagMode, ratings: ratingsSnapshot.current,
        aiSession, challengeToken,
      }, { signal: request.controller.signal })
      if (requestScope.current.current(request)) setText(text)
    } catch (e) {
      if (requestScope.current.current(request)) setError(e.message || 'AIの生成に失敗しました。もう一度お試しください。')
    } finally {
      if (requestScope.current.current(request)) {
        setBusy(false)
        setChallengeToken('')
        setChallengeReset(value => value + 1)
      }
      requestScope.current.finish(request)
    }
  }

  const resetDiagnosis = () => {
    requestScope.current.reset()
    clearTimeout(answerTimer.current)
    answerTimer.current = null
    answering.current = false
    ratingsSnapshot.current = {}
    saveController.current = createSaveController({ send: sendSave })
    setAppPhase('welcome'); setCurrentStep(0); setRatings({}); setUserInfo({ name: '', email: '' })
    setAiAnalysis(''); setAiActionPlan(''); setAnalysisError(''); setPlanError(''); setAiSession('')
    setChallengeToken(''); setChallengeReset(value => value + 1)
    setIsAnalyzing(false); setIsGeneratingPlan(false); setIsSaving(false)
    setIsTransitioning(false); setAgreedToPolicy(false); setErrorMsg('')
    setInputErrors({}); setSaveUnconfirmed(false)
  }

  const handleAnswer = (rating) => {
    if (appPhase !== 'questions' || answering.current || !currentCategory || !Number.isInteger(rating) || rating < 1 || rating > 5) return
    answering.current = true
    setIsTransitioning(true)
    const nextRatings = { ...ratingsSnapshot.current, [currentCategory.name]: rating }
    ratingsSnapshot.current = nextRatings
    setRatings(nextRatings)
    answerTimer.current = setTimeout(() => {
      answerTimer.current = null
      if (currentStep < activeCategories.length - 1) setCurrentStep(currentStep + 1)
      else if (completeRatings(diagMode, nextRatings)) setAppPhase('lead_capture')
      else setErrorMsg('すべての項目に回答してください。')
      answering.current = false
      setIsTransitioning(false)
    }, 200)
  }

  // Earlier answers stay in ratings, so stepping back shows the previous choice highlighted.
  const goToPreviousQuestion = () => {
    if (appPhase !== 'questions' || answering.current || currentStep === 0) return
    setCurrentStep(currentStep - 1)
    setErrorMsg('')
  }

  const reviewAnswers = () => {
    setAppPhase('questions')
    setCurrentStep(activeCategories.length - 1)
    setErrorMsg('')
  }

  // Each new screen starts at the top; stepping between questions keeps the position.
  useEffect(() => { window.scrollTo(0, 0) }, [appPhase])

  useEffect(() => () => {
    requestScope.current.reset()
    clearTimeout(answerTimer.current)
    answering.current = false
  }, [])

  const startDiagnosis = (mode) => {
    resetDiagnosis()
    setDiagMode(mode)
    setAppPhase('questions')
  }

  const generateAIAnalysis = () => generateAI('get_advice')
  const generateActionPlan = () => generateAI('generate_plan')


  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">

        {/* Phones get a compact header after the first screen so the question or form stays in view. */}
        <header className={`text-center animate-in ${appPhase === 'welcome' ? 'mb-12' : 'mb-6 md:mb-12'}`}>
          <p className={`text-xs tracking-wider text-emerald-700 font-black mb-3 ${appPhase === 'welcome' ? '' : 'hidden md:block'}`}>ONE PLANET 経営者向け自己診断</p>
          <h1 className={`${appPhase === 'welcome' ? 'text-4xl' : 'text-2xl'} md:text-5xl font-black text-slate-900 mb-4 tracking-tight`}>経営者の「器」診断 Pro</h1>
          <div className={`h-1.5 w-24 bg-emerald-600 mx-auto rounded-full shadow-xs ${appPhase === 'welcome' ? '' : 'hidden md:block'}`}></div>
        </header>

        {appPhase === 'welcome' && (
          <div className="bg-white rounded-[2rem] p-8 md:p-12 shadow-2xl border border-slate-100 text-center animate-in">
            <h2 className="text-2xl font-bold mb-8 text-slate-800">診断モードを選択してください</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <button onClick={() => startDiagnosis('quick')}
                className="p-8 border-2 border-emerald-50 rounded-3xl hover:border-emerald-500 hover:bg-emerald-50 transition-all group text-left">
                <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">⚡</div>
                <div className="font-bold text-xl mb-2 text-slate-900">クイック診断 (8問)</div>
                <p className="text-sm text-slate-500 leading-relaxed">主要項目で現状をマクロに把握。目安1分。</p>
              </button>
              <button onClick={() => startDiagnosis('full')}
                className="p-8 border-2 border-emerald-50 rounded-3xl hover:border-emerald-500 hover:bg-emerald-50 transition-all group text-left">
                <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">🔍</div>
                <div className="font-bold text-xl mb-2 text-slate-900">精密診断 (24問)</div>
                <p className="text-sm text-slate-500 leading-relaxed">深層心理までAIが分析。目安3分。</p>
              </button>
            </div>
            <p className="text-sm text-slate-500 mt-6">結果の表示には、お名前とメールアドレスの入力が必要です。</p>
          </div>
        )}

        {appPhase === 'questions' && currentCategory && (
          <div className="bg-white rounded-[2rem] p-5 md:p-10 shadow-2xl border border-slate-100 animate-in">
            <div className="flex justify-between items-center mb-10">
              <div className="px-5 py-2 bg-emerald-50 rounded-full text-xs font-black text-emerald-700 border border-emerald-100">
                {currentCategory.domain}
              </div>
              <div className="text-slate-400 font-mono text-sm font-bold bg-slate-50 px-3 py-1 rounded-lg">
                {currentStep + 1} / {activeCategories.length}
              </div>
            </div>
            <h3 className="text-2xl md:text-4xl font-black text-slate-900 mb-6 leading-tight tracking-tight">
              {currentCategory.name}
            </h3>
            <p className="text-lg md:text-xl text-slate-600 mb-8 md:mb-14 leading-relaxed font-medium">
              {currentCategory.question}
            </p>
            <p className="text-sm text-slate-600 mb-3">今の満足度を5段階で選んでください</p>
            <div className="flex justify-between gap-2 md:gap-6 mb-4 md:mb-14">
              {[1,2,3,4,5].map(n => (
                <button key={n}
                  onClick={() => handleAnswer(n)} disabled={isTransitioning}
                  className={`flex-1 h-20 md:h-28 rounded-2xl font-black text-2xl transition-all active:scale-95
                    ${ratings[currentCategory.name] === n
                      ? 'bg-emerald-700 text-white scale-105 shadow-xl ring-4 ring-emerald-100'
                      : 'bg-white text-slate-700 border-2 border-slate-300 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300'}`}>
                  {n}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-sm font-bold text-slate-600 border-t border-slate-50 pt-6">
              <span>1：改善が必要</span>
              <span>5：理想的な状態</span>
            </div>
            {errorMsg && <p role="alert" className="text-red-700">{errorMsg}</p>}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
              {currentStep > 0 && (
                <button type="button" onClick={goToPreviousQuestion} disabled={isTransitioning}
                  className="text-sm text-slate-500 underline disabled:opacity-50">← 前の質問に戻る</button>
              )}
              <button onClick={resetDiagnosis} className="ml-auto text-sm text-slate-500 underline">診断を最初からやり直す</button>
            </div>
          </div>
        )}

        {appPhase === 'questions' && !currentCategory && <div role="alert">
          回答を確認できませんでした。<button onClick={resetDiagnosis}>診断を最初からやり直す</button>
        </div>}

        {appPhase === 'lead_capture' && (
          <form noValidate onSubmit={handleSubmitInfo} className="bg-white rounded-[2rem] p-6 md:p-14 shadow-2xl border border-slate-100 text-center animate-in">
            <h2 className="text-2xl md:text-3xl font-black mb-4 tracking-tight">診断が完了しました</h2>
            <div className="text-slate-600 mb-6 md:mb-12 text-base md:text-lg font-medium leading-relaxed">
              <p>結果の表示には、お名前とメールアドレスが必要です。入力すると、この画面で次の3つをご覧いただけます。</p>
              <ul className="mt-2 inline-block text-left">
                <li>・満足度のバランスが分かるグラフ</li>
                <li>・AIによる個別フィードバック</li>
                <li>・具体的な行動プラン</li>
              </ul>
            </div>
            <div className="max-w-md mx-auto space-y-6 mb-8 text-left">
              <div>
                <label htmlFor="lead-name" className="block text-sm font-bold text-slate-700 mb-2">お名前（必須）</label>
                <input ref={nameInput} id="lead-name" name="name" type="text" required maxLength={200} autoComplete="name" value={userInfo.name}
                  aria-invalid={Boolean(inputErrors.name)} aria-describedby={inputErrors.name ? 'name-error' : undefined}
                  onChange={e => { setUserInfo({...userInfo, name: e.target.value}); setInputErrors(errors => ({...errors, name: ''})) }}
                  disabled={isSaving || saveUnconfirmed}
                  className="w-full p-4 rounded-xl bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 outline-hidden transition-all font-medium text-lg"
                  placeholder="山田 太郎" />
                {inputErrors.name && <p id="name-error" role="alert" className="mt-2 text-sm text-red-700">{inputErrors.name}</p>}
              </div>
              <div>
                <label htmlFor="lead-email" className="block text-sm font-bold text-slate-700 mb-2">メールアドレス（必須）</label>
                <input ref={emailInput} id="lead-email" name="email" type="email" required maxLength={254} autoComplete="email" value={userInfo.email}
                  aria-invalid={Boolean(inputErrors.email)} aria-describedby={inputErrors.email ? 'email-error' : undefined}
                  onChange={e => { setUserInfo({...userInfo, email: e.target.value}); setInputErrors(errors => ({...errors, email: ''})) }}
                  disabled={isSaving || saveUnconfirmed}
                  className="w-full p-4 rounded-xl bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 outline-hidden transition-all font-medium text-lg"
                  placeholder="taro@example.co.jp" />
                {inputErrors.email && <p id="email-error" role="alert" className="mt-2 text-sm text-red-700">{inputErrors.email}</p>}
              </div>

              <div>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input ref={consentInput} type="checkbox"
                    required disabled={isSaving || saveUnconfirmed}
                    checked={agreedToPolicy}
                    aria-invalid={Boolean(inputErrors.consent)} aria-describedby={inputErrors.consent ? 'consent-error' : undefined}
                    onChange={e => { setAgreedToPolicy(e.target.checked); if (e.target.checked) setInputErrors(errors => ({...errors, consent: ''})) }}
                    className="mt-1 w-5 h-5 accent-emerald-600 cursor-pointer shrink-0" />
                  <span className="text-sm text-slate-600 leading-relaxed">
                    <a href="https://www.1planet.jp/privacy" target="_blank" rel="noopener noreferrer"
                      className="text-emerald-600 underline hover:text-emerald-800 font-bold">プライバシーポリシー</a>
                    に同意して、診断結果の表示および ONE PLANET からの情報提供を受けることに同意します。
                  </span>
                </label>
                {inputErrors.consent && <p id="consent-error" role="alert" className="mt-2 text-sm text-red-700">{inputErrors.consent}</p>}
              </div>
            </div>

            {errorMsg && (
              <div role="alert" className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl text-sm font-bold">{errorMsg}</div>
            )}
            {saveUnconfirmed && !isSaving && <p className="text-sm text-slate-600 mb-4">保存結果が未確認のため、入力内容を保持しています。同じボタンでもう一度確認できます。</p>}
            <button type="submit"
              disabled={isSaving}
              className="w-full py-4 md:py-6 bg-emerald-700 text-white rounded-2xl font-black text-lg md:text-xl shadow-2xl hover:bg-emerald-800 disabled:bg-slate-200 disabled:shadow-none transition-all flex items-center justify-center gap-3 active:scale-95">
              {isSaving ? "保存中..." : saveUnconfirmed ? "保存を再確認する" : "📊 診断レポートを見る"}
            </button>
            {/* Restarting while a save is unconfirmed would send the same lead again under a new ID. */}
            {!saveUnconfirmed && !isSaving && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                <button type="button" onClick={reviewAnswers} className="text-sm text-slate-500 underline">← 回答を見直す</button>
                <button type="button" onClick={resetDiagnosis} className="text-sm text-slate-500 underline">診断を最初からやり直す</button>
              </div>
            )}
          </form>
        )}

        {appPhase === 'results' && (
          <div className="space-y-8 animate-in pb-24">

            <ResultSummary name={userInfo.name} categories={activeCategories} ratings={ratings} />

            <div className="bg-white rounded-[2.5rem] p-8 md:p-12 shadow-2xl border border-slate-100">
              <h3 className="text-sm font-bold text-slate-500 mb-6 md:mb-8">満足度のバランス</h3>
              <ScoreChart categories={activeCategories} ratings={ratings} />
            </div>

            {errorMsg && (
              <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm font-bold">{errorMsg}</div>
            )}

            <div className="bg-slate-900 text-slate-50 rounded-[2.5rem] p-6 md:p-16 shadow-2xl border border-slate-800 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-12 opacity-5 text-[15rem] pointer-events-none font-serif italic">AI</div>

              <div className="mb-10 border-b border-slate-800 pb-10">
                <h3 className="text-xl md:text-3xl font-black flex flex-wrap items-center gap-x-4 gap-y-2 tracking-tight mb-2">
                  <span className="bg-emerald-600 px-4 py-1 rounded-xl text-xs text-white font-black tracking-widest">AIコーチ</span>
                  エグゼクティブ・フィードバック
                </h3>
                <p className="text-slate-500 font-medium">満足度スコアに基づく、経営者の「器」の解析結果</p>
              </div>

              {(!aiAnalysis || !aiActionPlan) && <RenderBoundary message="安全確認を表示できませんでした。回答と診断結果は保持されています。" recoveryLabel="安全確認を再表示する">
                <HumanVerification sitekey={aiSession ? TURNSTILE_SITE_KEY : ''} resetKey={challengeReset} onToken={setChallengeToken} />
              </RenderBoundary>}

              {!aiAnalysis && !isAnalyzing ? (
                <div className="text-center py-12">
                  <button onClick={generateAIAnalysis} disabled={!canGenerate}
                    className="px-12 py-5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black text-xl transition-all shadow-xl active:scale-95 disabled:opacity-50">
                    ✨ AIアドバイスを受ける
                  </button>
                  <p className="text-slate-500 text-sm mt-4">診断スコアをもとにAIが個別分析を行います</p>
                  {analysisError && <p role="alert" className="text-red-300 mt-4">{analysisError}</p>}
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

              <div className="mt-16 bg-emerald-950/20 rounded-[2rem] p-5 md:p-10 border border-emerald-800/30">
                <div className="flex items-center justify-between mb-10 flex-wrap gap-6">
                  <h4 className="text-2xl font-black text-emerald-400 tracking-tight">✨ 具体的アクションプラン</h4>
                  {!aiActionPlan && (
                    <button onClick={generateActionPlan} disabled={!canGenerate}
                      className="px-8 py-4 bg-emerald-700 hover:bg-emerald-600 rounded-2xl text-sm font-black transition-all shadow-lg active:scale-95 disabled:opacity-50">
                      {isGeneratingPlan ? "生成中..." : "✨ プランを提案させる"}
                    </button>
                  )}
                </div>
                {planError && <p role="alert" className="text-red-300 mb-4">{planError}</p>}
                {aiActionPlan ? (
                  <div className="whitespace-pre-wrap text-emerald-100/90 leading-relaxed text-lg border-l-2 border-emerald-600/30 pl-8 ml-2">
                    {aiActionPlan}
                  </div>
                ) : (
                  <p className="text-slate-400 text-center py-8 text-sm">
                    「プランを提案させる」を押すと、ここに表示されます。
                  </p>
                )}
              </div>

              <div className="mt-20 p-5 md:p-14 bg-white/5 rounded-3xl md:rounded-[3rem] border border-white/10 text-center">
                <div className="text-4xl mb-6">💬</div>
                <h4 className="text-2xl md:text-3xl font-black mb-6 tracking-tight">さらなる高み、その先へ</h4>
                <p className="text-slate-400 mb-8 md:mb-12 max-w-xl mx-auto leading-relaxed text-base md:text-lg">
                  AIが指摘した課題を具体的にどう経営判断に活かすか。<br/>
                  30分の無料面談で、あなただけの「次の一手」を一緒に深掘りしませんか？
                </p>
                <a href="https://www.1planet.jp/contact" target="_blank" rel="noopener noreferrer"
                  className="w-full md:w-auto inline-flex items-center justify-center gap-3 px-4 md:px-14 py-4 md:py-5 bg-emerald-600 text-white rounded-2xl font-black text-base md:text-xl hover:bg-emerald-500 transition-all shadow-[0_20px_50px_rgba(5,150,105,0.3)] hover:-translate-y-1 active:scale-95 no-underline">
                  個別面談を依頼する →
                </a>
              </div>
            </div>

            <button onClick={resetDiagnosis} className="w-full py-8 text-slate-400 font-black hover:text-slate-600 transition-all text-sm underline">
              診断を最初からリセットする
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
