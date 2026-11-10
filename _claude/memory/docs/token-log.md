# Token optimization: lean headless, rules briefs, token log, API runs

Build `token-optimize` (optimization part of `token-usage-log-accounts-plan-studio-control-small-steps`), Nov 6 2026.

## Lean headless launches
`deploy/claude-headless.sh` sets `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and passes the composed rules brief with
`--append-system-prompt`, so it sits in the cached system prompt and survives compaction. The chain is dropped only once a
brief exists: no brief, lean off, or a failed CLI means the run loads the full chain. `AXF_LEAN_HEADLESS=off` forces it.

Measured on this repo, Opus 5.5, a one-line prompt, first turn: full chain 69,931 context tokens, $0.47; lean 30,057, $0.15.

## Rules briefs (rules-briefs@1)
`framework/core/rules-brief.mjs`, CLI `framework/cli/rules-brief.mjs`, seed `framework/schemas/rules-briefs.json`, live
document `/projects/_shared/_data/claude/rules-briefs.json`. Claude settings → Rules briefs edits it. Conditions: where it
runs, model, agent, job type, build id, profile, task brief keywords, changes UI. All set conditions must match. A
`generate` brief is built before send by plain keyword scoring over the rules files, so it costs no tokens.
The launch's task brief stays the `--brief` file; the panel shows the orchestrator's brief read-only beside the rules brief.

## Token log (token-turn@1)
`framework/core/token-log.mjs`, CLI `framework/cli/token-log.mjs`. Store: `/projects/amberx-axf/_data/token-log/<YYYY>/<MM>/<DD>.jsonl`.
- Headless: `deploy/claude-stream.mjs` writes each turn live.
- Other Claude Code sessions: `scan` reads transcripts by byte offset. These turns carry no account or build.
- Chat and voice: `chats` estimates from synced chats and session notes (`estimated: true`, length / 4).
- `check` does both and writes `tally.json`. The console runs it every 10 minutes (claude-settings clock). No model call.

## API runs (api-run@1)
`framework/core/api-run.mjs`, CLI `framework/cli/api-run.mjs`, store `/projects/_shared/_data/claude/api-runs/`. A launch with
`AXF_CLAUDE_AUTH=api` or a key in its environment waits; a waiter starts it once Brett approves in the console. Only his
signed-in session is accepted, sessions are refused, and nothing has a timer that lets a run through.

Open: no axHub approval path yet. An axHub tool needs its policy set to `confirm` first, or the default could put it on the
veto countdown. Mid-run failover to an API key is a separate step (s42) and doesn't pass through this gate yet.
