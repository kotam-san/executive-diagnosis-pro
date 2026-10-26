# 運用・更新・障害対応

この手順と新しいログ・所有者向け確認関数は工程4で準備したもの。2026-10-26に本番GAS（バージョン18）とGitHubへ反映し、GitHub上のCIの成功と`inspectOperations`の実行を確認した。監視通知の受信担当は未決。

## 変更を入れるとき

Node.jsは`.nvmrc`の24.22.1を使用する。`npm ci --ignore-scripts --no-fund`、`npm run check`、`npm audit --audit-level=moderate`を実行する。Wrangler実行は`WRANGLER_SEND_METRICS=false npm run preview:worker`、別ターミナルで`npm run verify:headers`。ログ保存先を指定する場合は`WRANGLER_LOG_PATH=/tmp/diagnosis-worker.log`も設定できる。

GitHub Actionsはテスト・本番ビルド・成果物・npm audit・Wranglerの実HTTPヘッダーを検証する。配備やGAS実行はしない。週次監査は月曜00:17 UTC（日本時間09:17）。ActionsをコミットSHAで固定し、リポジトリ権限を読み取りに限定する。Dependabotはnpmを週次、Actionsを月次で確認し、更新PRの自動マージは設定しない。

`npm run build:release`（`npm run deploy`の前半）では、本番site keyの未設定・既知のテストキー・未確認GAS URL・想定外の`VITE_*`変数を拒否し、ビルド後の成果物に公開用site keyが入っていることも確認する。`npm run deploy:built`は検査済みの`dist`を再ビルドせずに配備する。値をエラーに出さない。これは設定値の形の検査であり、実際のキーの有効性やGASプロパティの設定完了を保証しない。公開承認と実連携の確認は別途必要。

これらはGitHubへ反映してから動く。通知はGitHub側の既存設定に依存するため、失敗通知の受信先・担当者は反映時に確認する。CI失敗を放置して依存の固定を解除したり、`npm audit fix --force`を無条件に実行したりしない。

Wranglerの間接依存`miniflare`内の`undici`は7.30.1へ限定して上書きしている。上流が修正版を採用した時点で、overrideを外したlockfileを作り、監査・CI相当確認・画面確認後に解除する。脆弱な旧Wranglerへのダウングレードは行わない。

## 日常の確認

`npm run healthcheck`は公開フロントとGASの`doGet`へGETだけを行う。診断登録・通知・AI生成を呼ばない。初期画面とGASの死活確認であり、保存先・通知送達・Claudeの実生成が動く証明ではない。

新しい版を公開した後は`npm run healthcheck -- --require-security-headers`も使う。現時点の公開版には新ヘッダーがないので、この厳格モードは未適用の旧公開版では失敗する。

GASの実行ログではJSONの`event: diagnosis_request`を確認する。記録するのはaction、成功／失敗、既知のエラーコード、保存重複の有無、通知結果のみ。氏名・メール・回答・送信ID・AI本文・利用証明・CAPTCHAトークン・APIキーは記録しない。ログの障害で診断保存の結果を変えない。

AI利用数と、当時間枠の新規保存数・通知数・省略数（`saveHourCount`・`notificationHourCount`・`notificationsSuppressed`）はGAS所有者がエディタから`inspectOperations`を実行して確認する。設定の有無、記録対象の日・時間と予約回数、現在有効な実行予約数だけを返す。HTTP APIには公開していない。登録・メール・外部AI・人間確認サービスは呼ばない。記録日・時間が現在と異なる場合は、その過去の枠の数字として読む。枠は次回の生成予約時に切り替わる。予約回数は費用の実測ではなく、失敗した上流生成も含む。Anthropicの実利用額・アカウント全体の上限は別途確認する。

## 障害が起きたとき

| 症状／ログ | 確認と対応 |
| --- | --- |
| 保存結果が不明 | 利用者は入力を変更せず、同じ画面で「保存を再確認する」。管理者はGAS実行とシート構造を確認。新IDで無条件に再送しない |
| `SCHEMA_MISMATCH`／`CONFIG_ERROR` | 保存先・必須列・設定（`SAVE_LIMIT_HOURLY`・`NOTIFY_LIMIT_HOURLY`の値を含む）を所有者が確認。既存列や回答を削除して直さない |
| `SAVE_LIMITED` | 1時間の新規保存上限に達した。`inspectOperations`の`saveHourCount`とシートの直近行で、大量登録か正規の集中かを確認。正規の集中なら`SAVE_LIMIT_HOURLY`を引き上げる。同じ送信IDの再送は上限に関係なく保存確認できる |
| ログ`SAVE_BUDGET_WRITE_FAILED` | 上限カウンターを保存できず、行を書き込む前に保存を止めた（利用者には`SAVE_FAILED`。同じ送信IDで再試行できる）。Apps Scriptのプロパティ保存の障害を確認する。上限を守るため、この間は新しい登録を受け付けない |
| `notification: suppressed` | 1時間の通知上限を超えた分。保存は成功している。次に送る通知に省略件数が載る。シートで対象を確認する |
| `notification: failed` | 保存済みのリードは維持。所有者がシートと実行時刻を確認して対象を整理。通知だけの再送は、送信先・内容を確認してから行う。同じ保存IDの再送は通知を再送しない |
| `AI_BUSY` | 実行予約とサービス実行状況を確認し、待ってから再試行。異常終了した予約は10分で期限切れ。稼働中に利用枠を手動で消さない |
| `AI_LIMIT_REACHED` | `inspectOperations`で枠を確認。上限の引き上げは予算と影響を確認して決める |
| `AI_UNAVAILABLE`／安全確認失敗 | キーの設定有無、許可ホスト、Turnstile、Anthropic側の状態を確認。秘密値や回答をログへ貼り付けない |
| グラフ障害 | スコア表を利用し、局所再表示。回答を保持したまま対応する |
| 新しいヘッダーで通信が拒否 | 拒否先・必要な機能・正規のオリジンを確認。CSP全体の削除やワイルドカードへの変更で回避しない |

通知処理を`GmailApp`から`MailApp`へ変更している。MailAppは送信専用で受信箱にアクセスしない。[Google公式仕様](https://developers.google.com/apps-script/reference/mail/mail-app)。GAS反映時に所有者が送信専用の権限を確認する。ソースの変更だけで過去のOAuth許可が失効するとは扱わず、既存の許可の見直し・取消は他の運用への影響を確認して行う。実メールの送信確認には送信先と内容の承認が必要。

## 残る運用上の確認

2026-10-26の公開で、本番キーと許可ホスト、GAS→フロントの更新順序、復元先、GitHub Actionsの有効化は済んだ（[RELEASE.md](RELEASE.md)）。定期点検の手順は[MAINTENANCE.md](MAINTENANCE.md)。残りは次のとおり。

- 所有者のクイック診断1回以外のブラウザ確認（Safari／Firefox、ほかのスマートフォン）と、ホームページの埋め込み内での表示の記録。
- GitHub Actionsの失敗通知の担当者。監視通知を有効にしたとはまだ扱わない。
- 同意文面の版・同意時刻を保存する仕様、保持期間、削除依頼・配信停止対応。未取得の過去の同意を推定で補完しない。保持期間や許諾をコードだけで決めず、所有者の運用方針と揃える。
- 現行の旧保存APIへの大量登録対策と将来の廃止方針。今回のCSPはHTTP APIへの直接アクセスを制限するものではない。

公開・復元手順は[RELEASE.md](RELEASE.md)、AI設定と利用上限は[AI-SECURITY.md](AI-SECURITY.md)。本番変更・既存回答削除・新しい送信や共有は、この手順書を作っただけでは実行しない。
