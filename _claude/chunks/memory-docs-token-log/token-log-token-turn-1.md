<!-- memory-chunk@1 source=_claude/memory/docs/token-log.md tokens=141 -->
## Token log (token-turn@1)
`framework/core/token-log.mjs`, CLI `framework/cli/token-log.mjs`. Store: `/projects/amberx-axf/_data/token-log/<YYYY>/<MM>/<DD>.jsonl`.
- Headless: `deploy/claude-stream.mjs` writes each turn live.
- Other Claude Code sessions: `scan` reads transcripts by byte offset. These turns carry no account or build.
- Chat and voice: `chats` estimates from synced chats and session notes (`estimated: true`, length / 4).
- `check` does both and writes `tally.json`. The console runs it every 10 minutes (claude-settings clock). No model call.
