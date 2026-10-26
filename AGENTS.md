# 経営者の「器」診断 Pro — Codex の作業境界

Claude Code が実装の主系を担う。Codex は独立した反証・レビュー・検証を担当し、依頼された範囲を完了まで進める。Claude のレビュー結果の有無を着手条件にしない。

## 編集範囲

- レビュー・調査の依頼ではファイルを変更しない。指摘と根拠だけを返す。
- 実装を明示的に依頼された場合だけ、専用の worktree またはブランチで編集する。既存の未コミット変更を編集・stage・discard・stash しない。
- `CLAUDE.md`・`.claude/**` を作成・編集・移動・削除しない。

## 外部への影響

- GAS の Web アプリへの POST（保存・通知メール・AI 生成）、`npm run deploy`・`wrangler deploy`、Cloudflare・Google・Anthropic の API 呼び出しを行わない。検証は `npm test` などの模擬サービスで行う。
- 秘密情報（API キー、署名鍵、Turnstile の秘密鍵、トークン）を出力・保存しない。

## 業務別の手順

- コード・計画の独立レビュー：[.codex/workflows/code-review.md](.codex/workflows/code-review.md)
