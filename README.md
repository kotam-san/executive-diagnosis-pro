# 経営者の「器」診断 Pro

クイック8問・精密24問の診断画面と、Google Apps Script（GAS）の保存・AI連携コードです。

工程2の修正ブランチでは、回答の完全性とAI利用保護を実装しています。本番用のTurnstile設定と反映は未実施です。設定・利用上限・検証・リリース条件は[AIの安全対策](docs/AI-SECURITY.md)を参照してください。稼働中の版は下記の公開版タグで固定しています。

[工程2の検証結果](docs/STEP2-VERIFICATION.md)：自動テスト148件、模擬サービスによる実画面確認13項目が成功。

## ソースと公開版

このリポジトリを、この診断のソース管理先にします。2026-10-19の公開版を作成した作業フォルダから、保存v2を含む元ソース・GAS・テストを回収しました。復元したソースのビルドは、2026-10-25に公開中のHTML・JavaScript・CSSとSHA-256がすべて一致しました。

- 本番画面：<https://executive-diagnosis-pro.kota-m.workers.dev/>
- ホームページの埋め込み：<https://www.1planet.jp/keieishasindanpro>
- 公開版を識別するGitタグ：`production-2026-10-19`
- アセットとソースの指紋：[releases/production-2026-10-19.json](releases/production-2026-10-19.json)
- 公開・復元と今後の記録方法：[docs/RELEASE.md](docs/RELEASE.md)

この取り込みは現在の公開版を保存するものです。機能・安全性の追加改善は別の変更で扱います。依存関係も公開版のlockfileを保持しています。

## ローカルでの確認

再現確認環境：Node.js 24.22.1、npm 11.19.1。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
env -u VITE_GAS_WEBAPP_URL npm run build
npm run verify:baseline
```

`npm test`はNode組み込みのテストランナーを使用します。Sheets・Gmail・外部AIは模擬サービスに置き換わり、実際の保存・通知・AI生成は行いません。

`verify:baseline`は上記公開版とローカルビルドを照合するコマンドです。以後の機能修正でソースやビルドが変われば不一致になるのが正常です。記録済みの公開版タグをチェックアウトした状態で利用してください。

公開中の静的ファイルも読み取り照合する場合：

```sh
npm run verify:baseline -- --live
```

このコマンドもGASへはアクセスせず、公開HTML・JS・CSSのGETだけを行います。

## ファイル構成

| パス | 内容 |
| --- | --- |
| `src/App.jsx` | 診断画面・質問進行・結果表示 |
| `src/data.js` | 設問と公開GASエンドポイント |
| `src/saveSubmission.js` | 保存ID・重複送信の抑止・保存通信のタイムアウト |
| `gas/Code.gs` | 次回反映用のGAS。現在の公開版16は公開版タグに保存 |
| `gas/appsscript.json` | 公開バージョン16のマニフェスト設定 |
| `test/` | 外部送信を伴わない保存処理のテスト |
| `test/fixtures/Code.v15.gs` | 旧GASとの互換性確認専用。配備には使わない |
| `releases/` | 公開版とGitソースを対応付ける記録 |

## GASの設定と秘密情報

GAS側のスクリプトプロパティに`CLAUDE_API_KEY`、`SHEET_ID`、`NOTIFY_EMAIL`を設定します。値はリポジトリに保存しません。`VITE_*`の値はブラウザ用のビルドへ含まれるため、秘密のAPIキーを設定しないでください。

`VITE_GAS_WEBAPP_URL`は検証用エンドポイントの差し替えに使用できます。診断画面のボタンは実際のGASを呼ぶため、手動テストは模擬通信か承認済みの検証環境で行います。

GitHubへのソース保存と本番への配備は別の操作です。CloudflareにはGit連携があるため、push前に自動ビルドの設定を確認してください。`npm run deploy`は本番配備を実行します。
