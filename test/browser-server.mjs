// Local-only browser verification. All Google, Cloudflare and AI services are mocked.
// Build first with VITE_GAS_WEBAPP_URL=http://127.0.0.1:4187/test-gas
// and VITE_TURNSTILE_SITE_KEY=local-browser-test-key; output must be dist-test.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { harness } from './gasHarness.js'

const root = path.resolve(fileURLToPath(new URL('../dist-test/', import.meta.url)))
const h = harness({ enableAi:true })
const history = []
const held = []
let mode = 'normal'
h.ctx.generateAnalysis = (name, ratings) => {
  if (mode === 'ai-error') throw h.ctx.saveError('AI_UPSTREAM_ERROR', 'AIの生成を完了できませんでした。もう一度お試しください。')
  return `模擬分析：最初の回答は${Object.values(ratings)[0]}点です。`
}
h.ctx.generateActionPlan = ratings => `模擬プラン：最初の回答は${Object.values(ratings)[0]}点です。`
const sdk = `<script>
window.turnstile={render(container,options){
 const node=document.createElement('button');node.type='button';node.textContent='模擬の安全確認';
 node.onclick=()=>{node.disabled=true;options.callback('valid-human-token-'+Date.now()+'-'+Math.random())};
 container.appendChild(node);return node;
},remove(node){node.remove()}};
</script>`
const headers = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'none'; img-src 'self' data:; frame-src 'none'",
  'Cache-Control':'no-store',
}
function json(response, value, status = 200) { response.writeHead(status, { ...headers, 'Content-Type':'application/json' }); response.end(JSON.stringify(value)) }

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:4187')
    if (request.method === 'GET' && url.pathname === '/__audit/control') {
      mode = url.searchParams.get('mode') || 'normal'
      if (mode === 'release') { for (const entry of held.splice(0)) if (!entry.response.destroyed) json(entry.response, entry.result); mode='normal' }
      return json(response,{mode})
    }
    if (request.method === 'GET' && url.pathname === '/__audit/state') return json(response,{
      mode,requests:history,heldResponses:held.length,registrations:h.state.mails.length,
      mockOutboundRequests:h.state.requests.length,realExternalRequests:0,
    })
    if (request.method === 'POST' && url.pathname === '/test-gas') {
      let body=''
      for await (const chunk of request) { body+=chunk; if (body.length>20000) return json(response,{status:'error',code:'INVALID_INPUT'},413) }
      const input=JSON.parse(body)
      if (mode === 'save-error' && input.action === 'save_only_v2') h.state.failWrite=true
      const result=h.post(input)
      h.state.failWrite=false
      history.push({action:input.action,mode:input.mode,ratingCount:Object.keys(input.ratings||{}).length,firstScore:Object.values(input.ratings||{})[0],status:result.status,code:result.code||null})
      if (mode === 'invalid-response' && input.action === 'get_advice') result.analysis={invalid:'object'}
      if (mode === 'delay' && input.action === 'get_advice') { held.push({response,result});return }
      return json(response,result)
    }
    if (request.method !== 'GET') return json(response,{error:'not allowed'},405)
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
    if (!file.startsWith(root+path.sep)) return json(response,{error:'not found'},404)
    let data=await fs.readFile(file)
    const extension=path.extname(file)
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extension]||'application/octet-stream'
    if (extension === '.html') data=Buffer.from(data.toString().replace('<head>','<head>'+sdk))
    response.writeHead(200,{...headers,'Content-Type':mime});response.end(data)
  } catch { if (!response.headersSent) json(response,{error:'local verification server error'},500);else response.destroy() }
}).listen(4187,'127.0.0.1',()=>console.log('Offline browser verification: http://127.0.0.1:4187/'))
