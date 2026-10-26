import { GAS_WEBAPP_URL } from '../src/data.js'

export function validateReleaseConfig(env) {
  const allowed=new Set(['VITE_TURNSTILE_SITE_KEY','VITE_GAS_WEBAPP_URL'])
  if(Object.keys(env).some(key=>key.startsWith('VITE_')&&!allowed.has(key))) throw Error('公開用環境変数は確認済みの2項目だけを使用してください。値は出力しません。')
  const key=env.VITE_TURNSTILE_SITE_KEY||''
  if(!/^[A-Za-z0-9_-]{10,100}$/.test(key)||/^[123]x0+[A-Z]{2}$/.test(key)||key==='local-browser-test-key') throw Error('本番用のTurnstile公開site keyを設定してください。')
  if(env.VITE_GAS_WEBAPP_URL&&env.VITE_GAS_WEBAPP_URL!==GAS_WEBAPP_URL) throw Error('本番のGAS URLが確認済みの配備先と一致しません。')
}
