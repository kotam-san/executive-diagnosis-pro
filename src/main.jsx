import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import RenderBoundary from './RenderBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RenderBoundary message="画面を表示できませんでした。再読み込みすると入力中の回答は失われます。保存中だった場合は、保存済みの可能性があります。" recoveryLabel="画面を再読み込みする" onRecover={() => window.location.reload()}>
      <App />
    </RenderBoundary>
  </React.StrictMode>,
)
