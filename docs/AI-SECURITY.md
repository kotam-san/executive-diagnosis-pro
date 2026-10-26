# 診断の完全性とAI利用の保護（工程2・3）

この変更は実装・検証用です。本番反映と本番用のTurnstile設定はまだ行っていません。現在の公開版は`production-2026-10-26`タグ（GASバージョン17。画面は10/19版のまま）で確認できます。

## 変更内容

- 回答を選んだ直後に同期的に操作をロックし、200msの切り替え中の連打を受け付けない。タイマーをリセット・画面破棄時に取り消す。
- 8問／24問が完全一致し、全項目が整数1〜5点である場合だけ、回答完了と保存へ進む。GASも同じ検証を行う。
- 診断をリセットするとAI通信を中断し、処理の世代を更新する。中断を無視する通信でも、以前の成功・エラー・終了処理が次の診断を変更できない。
- AI本文とエラーを分離し、エラー後も安全確認をやり直して再試行できる。AI通信には45秒の上限を設ける。
- AI応答は空でない6,000文字以内の文字列だけを表示する。外部応答のオブジェクトをReactの子として描画しない。
- グラフ用のカテゴリ配列を安定させ、画面破棄時にChartを破棄する。

## AI呼び出しの条件

1. 保存v2が回答を検証し、保存を確認する。
2. GASが保存ID・氏名・モード・回答に結び付いたHMAC署名付きの利用証明を返す。有効期間は2時間。証明の本文に氏名・メール・回答そのものは入れない。
3. 利用者が結果画面でTurnstileの安全確認を完了する。画面には公開site keyのみを設定する。
4. GASが証明の署名・期限・入力との対応を検証し、TurnstileのSiteverifyで成功・hostname・actionを確認する。
5. ScriptLock内で診断別・全体の利用枠を予約してからClaude APIを呼ぶ。

証明のない旧形式のAI呼び出しは拒否する。旧`save_only`の保存インターフェースは維持するが、IDなし保存にはAI利用証明を発行しない。保存ID単独をAIの認証情報として使わない。

Turnstileトークンは使い回さず、生成の完了・失敗後にウィジェットを再生成する。サーバー側の検証に失敗した場合、AIを呼ばない。[Cloudflare公式の検証手順](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

## 初期の利用上限

以下は新しくClaude APIを呼ぶ回数の上限。キャッシュ済み結果の取得には課金される生成を追加しない。

| 対象 | 初期値 | 任意のスクリプトプロパティ |
| --- | --- | --- |
| 1診断の分析 | 有効期間内2回まで | `AI_LIMIT_PER_ACTION` |
| 1診断のプラン | 有効期間内2回まで | 同上 |
| GAS全体・1時間 | 30回まで | `AI_LIMIT_HOURLY` |
| GAS全体・1日 | 100回まで | `AI_LIMIT_DAILY` |
| GAS全体・同時実行 | 3件まで | `AI_LIMIT_CONCURRENT` |

時・日の区切りは日本時間の固定窓。失敗した上流呼び出しも枠を消費する。予約はPropertiesServiceで維持し、キャッシュの消失・通信断・別のGAS実行で回数が戻らない。異常終了した処理の予約は10分で期限切れになる。結果のキャッシュは最大1時間、利用証明は2時間で期限切れになる。

分析の出力上限は768トークン、プランは1,024トークン。途中で上限に達した出力は成功扱いしない。固定の設問と検証済みのスコアだけをClaudeへ渡す。工程3で、分析プロンプトから氏名を除いた。メールアドレスもClaudeへ送らない。氏名はGASの登録処理と署名付き証明の照合に引き続き使用する。systemでデータ内の指示に従わないよう指定するが、これだけで生成内容の正しさを保証するものではない。

工程3では、結果キャッシュの読み取り障害でも、保存証明・人間確認・永続的な利用上限を通過すれば生成できるようにした。キャッシュ取得失敗を理由に、利用枠を初期化したり無制限に生成したりしない。

## 本番反映に必要な設定

| 設定先 | 名前 | 内容 |
| --- | --- | --- |
| フロントのビルド環境 | `VITE_TURNSTILE_SITE_KEY` | 公開用のTurnstile site key |
| GASスクリプトプロパティ | `TURNSTILE_SECRET_KEY` | 対応する秘密鍵。VITE変数・Gitへ保存しない |
| GASスクリプトプロパティ | `AI_SESSION_SECRET` | 推測困難な32文字以上の独立した署名鍵。例：安全な乱数32バイトを16進文字列にしたもの |
| GASスクリプトプロパティ | `TURNSTILE_ALLOWED_HOSTNAMES` | 任意。既定は`executive-diagnosis-pro.kota-m.workers.dev`。複数はカンマ区切り |
| GASスクリプトプロパティ | `CLAUDE_MODEL` | 任意。既定は`claude-sonnet-5-5`。`claude-`で始まるIDのみ受け付け、不正値ではAIを止める（利用枠は消費しない） |
| GASスクリプトプロパティ | `SAVE_LIMIT_HOURLY` | 任意。新規保存の1時間あたり上限。既定120（1〜5000）。超過時は`SAVE_LIMITED`、書き込みなし |
| GASスクリプトプロパティ | `NOTIFY_LIMIT_HOURLY` | 任意。登録通知メールの1時間あたり上限。既定20（1〜500）。超過分は送らず、次に送る通知に省略件数を記載 |

既存の`CLAUDE_API_KEY`・`SHEET_ID`・`NOTIFY_EMAIL`を維持する。署名鍵を変更すると既存の利用証明は無効になるため、通常の更新ごとには変更しない。

Turnstileは診断が動作するiframe内に置かれるため、許可ホストは診断画面のオリジンに合わせる。親のSquarespaceだけを許可しても一致しない。ウィジェットは狭い画面でも収まるcompactサイズを使用する。[公式の表示設定](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)

設定不足・無効な上限値・検証サービス障害・検証失敗時にはAIを許可しない。AI設定の問題を理由に、保存済みの診断を未保存扱いにはしない。スコアの表示は利用できる。

## モデルの選択

既定は最新のSonnet（2026-10-26時点で`claude-sonnet-5-5`）とする。Sonnet 5.5は何も指定しないと思考してから答えるため遅くなり、出力上限（分析768・プラン1,024トークン）で途中切れする恐れもある。短いコーチ文に思考は不要なので、Sonnet 5.5のときだけ`thinking: {type: "between_tools"}`（思考オフ）を送る。この指定は他のモデルではエラーになるため、`CLAUDE_MODEL`で別モデルに戻したときは送らない。

最新版を自動で指す指定（エイリアス）はなく、Sonnetは世代ごとにAPIの仕様が変わってきたため、自動では追わない。新しいSonnetが出たら次の順で更新する。

1. Anthropicの移行ガイドで、思考・出力設定の変更点を確認する。
2. `gas/Code.gs`の`DEFAULT_CLAUDE_MODEL`と思考オフの条件を新しいIDに合わせ、`npm test`を通す。
3. `node --env-file-if-exists=eval/.env.local eval/run.mjs`で本番版と比べ、速さ・字数・途中切れを確認する（API費用が発生）。
4. `docs/RELEASE.md`の手順でGASへ反映する。急ぎで戻すときは`CLAUDE_MODEL`に旧IDを設定する。

Cloudflareが公開しているテスト用secret keyは本番設定として拒否する。本番キーの有効性と実際のチャレンジ連携は、反映前に承認された範囲で別途確認する。

## リリース時の確認

1. 対象のTurnstileウィジェットの作成・設定、GASプロパティ設定、本番反映について対象と内容の承認を確認する。既存アカウントの権限を拡大しない。
2. 模擬サービスによるテストとビルドを確認する。
3. 本番用キー・ホストの対応と、AIの上限値を確認する。キー値をログへ出さない。
4. `VITE_TURNSTILE_SITE_KEY`を設定して`npm run build:release`を先に済ませる。
5. GASを新しい公開バージョンへ更新し（既存のURL・保存先を維持）、直後に`npm run deploy:built`で検査済みのフロントを反映する。詳細は[RELEASE.md](RELEASE.md)の「GASとフロントを続けて反映する」。
6. 旧画面のAI呼び出しは新GASで拒否されるため、新しい画面への再読み込みが必要。保存v2は旧GAS16・新GASとも保存できる。GAS16からはAI利用証明が返らないので、新画面のAIは許可されない。
7. 実際の安全確認・保存・AI生成を伴う結合テストは、送信内容を承認した検証環境で行う。現時点では未実施。

## 外部送信をしない検証

```sh
npm test
VITE_GAS_WEBAPP_URL=/test-gas VITE_TURNSTILE_SITE_KEY=local-browser-test-key npm run build -- --outDir dist-test
node test/browser-server.mjs
```

`http://127.0.0.1:4187/`を開く。Google・Cloudflare・ClaudeのAPIは全て模擬サービス。工程4から本番と同じCSPを使うため、Google Fonts等の許可済み表示資源は読み込める。APIはローカルの`/test-gas`だけに送る。模擬の安全確認は本物のCAPTCHAではない。サーバーはloopbackだけで待ち受ける。

ローカルの制御用URL（全て本番には存在しない）：

- `/__audit/control?mode=normal`：正常応答
- `/__audit/control?mode=save-error`：保存失敗
- `/__audit/control?mode=ai-error`：AI生成失敗
- `/__audit/control?mode=invalid-response`：AI応答の型不正
- `/__audit/control?mode=delay`：AI応答を保留
- `/__audit/control?mode=release`：保留応答を返す
- `/__audit/state`：個人情報を含めない模擬リクエストの集計

工程3の追加モード・描画障害の再現と検証結果は[STEP3-VERIFICATION.md](STEP3-VERIFICATION.md)を参照。

工程4では`/__audit/embed?width=375`（320／768／1024も可）で狭いiframeを検証できる。`http://127.0.0.1:4188/`は許可外の親オリジンを模擬し、子のCSPによる表示拒否を確認する。本番サーバーの機能ではない。

## 残る範囲

この対策はAI生成の入力・呼び出し・費用枠を守るもの。保存側は旧APIを廃止し、新規保存と通知メールに1時間あたりの上限を設けた（上表）。ただし上限に達すると正規の利用者も保存できないため、GASへの大量HTTPアクセス自体を止めるものではない。匿名利用者が正常な検証を通過して全体枠を消費する可能性も残る。必要に応じて入口のレート制御を別途検討する。

利用上限はこのGASプロジェクトの単位。Anthropic側の予算や別のアプリの利用枠は未確認。保持データ・同意記録・防御ヘッダー・開発依存の更新は、残る工程で扱う。
