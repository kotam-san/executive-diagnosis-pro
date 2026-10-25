# 工程4：依存更新・配信防御・運用整備

2026-10-26。ブランチ`codex/diagnosis-maintenance-hardening`。工程3の`9430a93`から継続。本番・GitHubへの反映は未実施。

## 更新内容

| 対象 | 更新前 | 更新後 |
| --- | --- | --- |
| Vite | 5.4.21 | 8.3.5 |
| Vite React plugin | 4.x | 6.1.2 |
| Wrangler | 3.114.17 | 4.152.0 |
| Tailwind CSS | 3.4.19 | 4.3.3＋公式Vite plugin |
| Node.js | 指定なし | 24.22.1（`.nvmrc`） |

React 18.3.1とChart.js 4.5.1は保持。Tailwindの設定をCSSへ移し、旧PostCSS設定・空のTailwind JS設定・不要な直接依存を除去した。ソース検出は`src/`と`index.html`へ限定し、監査資料・検証資料をCSS生成対象にしない。名前が変わったutilityを公式手順に合わせた。デザインの全面変更は行っていない。

対応ブラウザはChrome／Edge 111以降、Firefox 128以降、Safari 16.4以降。Tailwind 4のCSS機能に依存するため、古いブラウザの対応を継続した更新ではない。公開前に対象利用者のブラウザ条件と確認する。[Tailwind移行仕様](https://tailwindcss.com/docs/upgrade-guide)、[Vite移行仕様](https://vite.dev/guide/migration)、[Wrangler移行仕様](https://developers.cloudflare.com/workers/wrangler/migration/update-v3-to-v4/)。Workerのcompatibility dateは今回変更していない。

Wranglerの最新版にも残った`undici`の指摘を、`miniflare`配下だけ7.30.1へ固定して解消した。上流の同一メジャー内修正を使用し、脆弱な旧Wranglerへの自動ダウングレードは採用していない。上流修正後の解除方法は[OPERATIONS.md](OPERATIONS.md)。

## セキュリティと運用

- `public/_headers`にCSP、nosniff、Referrer-Policy、Permissions-Policy、HSTSを追加。JSへのunsafe-inline／unsafe-evalは許可しない。スタイルのインライン許可はChart等の表示のために維持する。
- scriptとframeはTurnstile用ホストを許可。GASの接続元と[ContentServiceのリダイレクト先](https://developers.google.com/apps-script/guides/content#redirects)、Google Fontsを明示的に許可する。[TurnstileのCSP仕様](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)
- 埋め込み元を自分自身・`https://www.1planet.jp`・`https://1planet.jp`へ限定。現在の正規ホームページのiframeを壊すX-Frame-Optionsの一律DENY／SAMEORIGINは付けない。[Workersのヘッダー仕様](https://developers.cloudflare.com/workers/static-assets/headers/)
- テスト・成果物チェック・依存監査・WranglerでのHTTPヘッダー検証を行うCI、週次監査、Dependabotの設定を追加。GitHubへ未反映のため、リモート実行・失敗通知は未確認。
- GASに個人情報を含めない構造化ログ、所有者専用の利用数確認関数を追加。ログ障害でも保存結果を変えない。
- 通知を受信箱アクセスのないMailAppへ変更。実際の権限・送信確認は本番反映前の確認項目。
- GETだけの死活確認コマンドと、障害・利用枠・通知失敗・依存更新の運用手順を追加。
- 通常の配備コマンドに設定検査を追加。本番site keyの不足・既知のテストキー、未確認URL、想定外のVITE変数を、配備へ進む前に拒否する。サーバー側の設定完了や実際のキーの有効性まで証明する検査ではない。

## 検証結果

- `npm audit`（開発依存を含む）：**更新前17件（high 12・moderate 5）→更新後0件**。監査時点の既知情報であり、将来も0件であることを保証しない。
- `npm run check`：自動テスト**199件成功**、本番ビルド、ヘッダー・成果物の検査が成功。
- 空の一時フォルダにコピーし、`npm ci --ignore-scripts --no-fund`からテスト・本番ビルド・成果物検査を再現。最後の追加後も、その一時環境で199件の成功を再確認した。
- 成果物の検査は、模擬API／テストキーを含む`dist-test`を実際に拒否することも確認した。
- キー未設定状態で`predeploy`が失敗し、通常のnpm配備経路の前処理で止まることを確認。本番配備コマンド自体は実行していない。
- クリーンインストール側もWranglerが起動し、実HTTPのHTMLとJSに防御ヘッダーが付くことを確認。
- `npm run healthcheck`：現在公開中のフロントとGASのGETが成功。登録・通知・AI生成は呼んでいない。現在の本番に今回のヘッダーが適用されたという意味ではない。

ブラウザで確認した動作（保存・AI・人間確認は模擬サービス）：

1. 本番と同じCSPの下で、自己オリジンからの埋め込みとアセットを表示。
2. 375px幅でクイック8問、連打防止、模擬保存、グラフ、分析、プランを確認。
3. 320px幅で精密24問、保存、グラフ、24項目の数値表を確認。
4. 320px／375pxの結果画面で横はみ出しなしをDOMで確認。
5. 320px幅のAI HTTP500から、安全確認後の再試行で復旧。
6. 許可外の親オリジンではブラウザが子画面の表示を拒否。

模擬サーバーは本番と同じ`public/_headers`を読み取り、SDKモックはselfの外部JSとして配信する。本番のCSPを緩めてテストを通してはいない。ローカルの埋め込み用親ページだけは、子を表示する専用のframe-srcを使用する。実際のCloudflare TurnstileとGoogleの応答先への結合は未実施。

## 公開前の残件

本番用Turnstile・GASの設定、実際のホームページからの埋め込み、実メール送達とAI生成、対応ブラウザ別の確認、MailAppの承認範囲、GitHub上のCI実行を確認してから公開する。CloudflareのGit連携があるため、pushだけでも配備される可能性を確認する。

同意記録・保持期間・旧保存APIの整理など、コード更新だけで完了とできない運用上の残件は[OPERATIONS.md](OPERATIONS.md)へ明記した。今回の変更で大量HTTPアクセスや個人情報管理の全課題を解決したとは扱わない。
