# 経営者の「器」診断 Pro — Claude Code の作業ルール

構成・検証手順は [README.md](README.md)、AI 保護は [docs/AI-SECURITY.md](docs/AI-SECURITY.md)、運用は [docs/OPERATIONS.md](docs/OPERATIONS.md)、公開手順は [docs/RELEASE.md](docs/RELEASE.md)。

## 本番に触れる操作

- 本番配備（`npm run deploy`・`wrangler deploy`）、GAS の公開・プロパティ変更、Cloudflare の設定変更は、ユーザーの明示的な指示があるときだけ行う。
- 実際の GAS への POST（保存・通知・AI 生成）をテストで送らない。検証は `test/` の模擬サービスと `test/browser-server.mjs` で行う。
- Cloudflare の自動ビルド（Workers Builds）は無効のまま運用する。配備は手元の `npm run deploy` に限る。

## Codex による客観チェック

Claude が実装し、Codex CLI が独立レビューを担当する。Codex 側の境界は [AGENTS.md](AGENTS.md)、観点と出力形式は [.codex/workflows/code-review.md](.codex/workflows/code-review.md)。

- 計画が完成したら、実装に入る前に「Codexにも見せますか？」と1回だけ聞く。実装後・push 前にも差分レビューを1回だけ提案する。どちらもゲートにしない（見せないなら即進む）。1箇所の修正や定型作業では聞かない。
- 走らせる前に、聞かずに `codex --version` と `npm view @openai/codex version` を比べて1行で報告する（例：「Codex CLI 0.x.x（最新）・既定モデルで走らせます」）。`-m` は付けず既定モデルで走らせる。更新が要るときだけユーザーの了承を取り、`codex update` → `codex exec -s read-only "1+1の答えを数字だけで返して"` で既定モデルを1回試す → 本番の順。版確認の安全網として `.claude/settings.local.json` の hook（ONEPLANETManagement の `codex-version-gate.py`）が動く。
- 計画レビュー：`codex exec -s read-only -` に計画本文と観点を標準入力で渡す。差分レビュー：`codex review --base <base ブランチ> "<指示>"`。数分かかるのでバックグラウンドで実行する。
- Claude 自身のレビュー結果を Codex に渡さない。Codex の指摘は自動で反映せず、要約して採否をユーザーに戻す。
