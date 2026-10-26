# 定期メンテナンスと監査

本番を守るための定期点検です。毎月のメンテナンス（健康診断）と、四半期ごとの監査（精密検査）の2種類があります。どちらも Claude Code の自動タスクから実行し、結果を所有者に報告します。手順はこのファイルにまとめます。自動タスクはここを読んで動きます。

| 種類 | 時期 | 所要 | 変更の有無 |
| --- | --- | --- | --- |
| 毎月のメンテナンス | 毎月1日 10:00 | 約10分（自動） | 読み取りだけ。何も変えない |
| 四半期の監査 | 1・4・7・10月の5日 10:00 | 半日程度（判断は所有者） | 読み取りとレビューだけ。修正は所有者の了承後に別作業として行う |

## 共通のルール

- 本番配備（`npm run deploy`・`wrangler deploy`）、GAS の公開・プロパティ変更、Cloudflare の設定変更、PR のマージ、スプレッドシートの編集は行わない。必要なら提案だけをする。
- 本番 GAS への POST（保存・通知・AI 生成）を送らない。確認は GET と、所有者向けの読み取り専用関数 `inspectOperations` だけで行う。
- 秘密の値（`CLAUDE_API_KEY`・`TURNSTILE_SECRET_KEY`・`AI_SESSION_SECRET` など）を画面出力・チャット・ログ・Git に出さない。プロパティは「名前があるか」と「値の長さ」だけを見る。
- 作業前に [CLAUDE.md](../CLAUDE.md) と [OPERATIONS.md](OPERATIONS.md) を読む。
- 現在の公開版は [RELEASE.md](RELEASE.md) の「現在の公開版」の表と、`releases/` の最新の記録で確かめる。
- この環境では `gh` から git を呼べないことがある。GitHub の情報は `gh api` で読む。
- 確認できなかった項目は、できなかったと明記する。推測で「問題なし」としない。

## 毎月のメンテナンス

1. **最新化**：`git fetch`。作業ツリーが clean なら main を fast-forward する。clean でなければ、そのまま読み取りだけを行い、その旨を報告する。
2. **死活確認**：`npm run healthcheck -- --require-security-headers`（画面と GAS への GET だけ）。
3. **公開版の照合**：`node scripts/verify-production-baseline.mjs --live`。本番画面のファイルが最新の公開記録と一致するか。
4. **意図しない配備がないか**：`npx wrangler versions list` の最新が、公開記録の Worker 版と同じか。
5. **GitHub**：main の最新コミットの CI 結果、週次監査（Actions）の直近の結果、開いている PR（Dependabot を含む）の一覧と、それぞれの影響の大きさ（小：Actions やパッチ版、大：メジャー版）。
6. **依存の脆弱性**：`npm audit --audit-level=moderate`。
7. **利用状況と失敗**：Claude in Chrome で Apps Script エディタを開き、`inspectOperations` を実行して、ログの JSON を読む。「実行数」画面で、過去30日の「失敗」の実行を数える。
   - アカウント：kota.m@1planet.jp（`/u/2/`）
   - プロジェクト：「リード集計Pro用」 <https://script.google.com/u/2/home/projects/14HM8wE5BKrpLh2VKX-m-ZZ_CFECeKA7BvTM0m5E1hIbKSpuozoZVTjZj/edit>
   - Chrome が使えない場合は、所有者向けの手順を案内するだけにする。
8. **利用上限**：AI（1時間30回・1日100回）、保存（1時間120件）、通知（1時間20通）に、正規の利用者が引っかかった形跡がないか。項目7の数字と失敗の実行から判断する。
9. **Claude モデルの廃止予定**：使っているモデル（`gas/Code.gs` の `DEFAULT_CLAUDE_MODEL`）に廃止予定が出ていないか、Anthropic の公開情報で確かめる。新しい Sonnet が出ていれば、[AI-SECURITY.md](AI-SECURITY.md) の「モデルの選択」の手順で更新を提案する。

報告は `audit/maintenance/YYYY-MM.md` にも保存する（`audit/` は Git の対象外。手元の履歴として残る）。

## 四半期の監査

毎月のメンテナンスの全項目に加えて、次を行う。

1. **本番コードの一致**：Apps Script エディタの `Code.gs`・`appsscript.json` の SHA-256 が、最新の公開記録の `source_sha256` と一致するか（ブラウザ内で計算し、比較結果だけを出す）。
2. **設定の一致**：GAS のスクリプトプロパティに、[AI-SECURITY.md](AI-SECURITY.md) の「本番反映に必要な設定」がそろっているか（名前と値の長さだけ）。Cloudflare の Turnstile ウィジェットの許可ホストが本番画面だけか。
3. **独立レビュー**：Codex CLI に、main のコード全体を [.codex/workflows/code-review.md](../.codex/workflows/code-review.md) の観点でレビューさせる。手順は [CLAUDE.md](../CLAUDE.md) の「Codex による客観チェック」に従う（版の確認、既定モデル、`codex exec -s read-only`）。Claude 自身のレビュー結果は Codex に渡さない。
4. **docs と実態のずれ**：README・RELEASE・AI-SECURITY・OPERATIONS に書いた版・手順・設定が、実態と合っているか。
5. **運用方針の未決事項**：[OPERATIONS.md](OPERATIONS.md) の「残る運用上の確認」（ブラウザ確認、CI 失敗通知の担当者、同意の記録、保持期間、削除依頼への対応、旧保存APIの廃止方針）の進み具合。
6. **秘密の値の見直し**：漏えいの疑い、担当者の交代、公開範囲の変更がなかったか。あれば鍵の作り直しを提案する（`AI_SESSION_SECRET` を変えると、それまでの利用証明は無効になる）。

指摘は重大度（P1 は早急、P2 は次の作業で、P3 は任意）付きで要約し、採否を所有者に確認する。修正は了承を得てから、通常の変更の流れ（ブランチ・テスト・PR）で行う。監査の結論は、下の「監査の履歴」に1行で追記する（PR で反映）。

## 報告の形

- 冒頭に一言の結論（問題なし／要対応）
- 項目ごとに結果を1〜2行で
- 要対応の項目は、何が起きているか、放置すると何が困るか、どう直すかを、専門用語を避けて説明する。実行はしない
- 残っている運用作業の再掲

## 監査の履歴

| 日付 | 種類 | 結論 | 主な対応 |
| --- | --- | --- | --- |
| 2026-10-26 | 公開時の確認 | 問題なし | 工程2〜4を公開（GAS 18、Worker `da4a0827`）。手順書と定期タスクを作成 |
