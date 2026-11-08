<!-- memory-chunk@1 source=_claude/memory/docs/codebase-changes.md tokens=992 -->
## Build stats + every session, every machine (Oct 21 2026)

Brett: anything any Claude session builds (VPS, other computers, claude.ai, console launches, subagents) is reported to
axHub before it starts and kept live; the Build manager shows it (Live + Built). change-log@1 gained optional build
fields (old entries still valid; validators `changes-core.mjs` = `server/store.py`, agreement checked by `test.py`, schema updated):
`buildRef {kind, id}` · `status` queued|running|done|failed (derived from the result) · `surface` (vps-claude-code,
claude-code, claude-code-cloud, claude-ai, console-launch, subagent, backfill, … open) · `startedAt` / `finishedAt` /
`lastSeenAt` (heartbeat; running + silent 10 min = "no word") · `estimate {minutes, costUsd}` · `actual {minutes,
costUsd, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, source}` · `costEstimated` · `branch` · `areas`
(relative paths: the overlap check) · `parent` (subagent / launched-under) · `progress` 0..1 · `doing` (what it's doing now, short) ·
`verify {state pending|running|verified|broken|skipped, at, summary, checks}`. Every write while running is a heartbeat.

- **CLI:** `open … --ref pending:<id> --model opus --estimate-min 90 [--estimate-cost USD] --areas "a,b" --branch b`;
  `update <id>` (same flags + `--doing`, `--progress`); `beat <id>`; `result … --minutes --cost --input-tokens
  --output-tokens …`. Without `--estimate-cost` the cost = minutes × the model's per-minute heuristic.
- **Prices:** `framework/schemas/model-pricing.json` (model-pricing@1, shared with session-checkin, which keeps its
  own `baseline/pricing.json` as a fallback and now saves its settings-tab prices to the shared file) +
  `framework/cli/model-pricing.mjs` (`costUsd`, `estimateCost`, `transcriptUsage`).
- **Writes from anywhere:** after `AXF_CHANGES_DIR` and `/projects`, `changes.mjs` writes **straight to axHub over MCP**
  (`axhub.memory_write`, project amberx-axf, area data) with the hub token (`AXHUB_TOKEN` or `~/.config/axhub/token`
  from `claude-sync login`), so Claude Code on any computer reports live; then the console API, `--to-repo`, the queue.
- **Hooks** (`hooks install` → `~/.claude/settings.json`: every project on that machine): UserPromptSubmit opens a live
  entry (surface, host, model, start, heartbeat) and tells Claude how to add the estimate; **PreToolUse** sends what it's
  doing (one write per 30 s; tool names and file names only, never command arguments) and a subagent start
  as a running child step; **SubagentStop** ends it; **Notification** = "Waiting for you"; **Stop / SessionEnd** fill
  `actual` tokens + cost from the session transcript (each message counted once). `AXF_ADOPT_CHANGE=<id>` makes a
  session report on an existing entry (console "Start build now"); `AXF_PARENT_CHANGE` links a new one under another.
- **claude.ai (no shell):** write the JSON with `axhub.memory_write`: `_claude/memory/docs/build-reporting.md`.
- **Server:** POST/PATCH accept the build fields (`beat: true` = heartbeat); `axf.changes@1` adds `summaries()`,
  `stamp()` (cheap "anything new?") and `cli()`.
- **Backfill:** `node apps/console-web/plugins/codebase-changes/backfill.mjs` (dry run) / `--write [--update] [--out dir]` <!-- axf-plugin:codebase-changes -->
  — one `surface: backfill` entry per thing built before builds reported themselves (pending items complete, build-queue
  steps done, rebuild LOG.md, harvest reports, CLAUDE.md Status entries with dates), dates + commits from `origin/main`
  git history, estimates from the item (effort S 45 min / M 2 h / L 4 h / XL 8 h, rebuilds and harvests 4 h, plugins
  3 h, else 2 h) × the price heuristic, `costEstimated: true`. Idempotent ids; real entries with the same buildRef win;
  real entries recorded before build stats get the estimate merged in. Oct 21 2026 run: 101 entries, 282.5 h,
  $2,923.80 estimated (Fable 22 / 68 h / $1,122; Opus 79 / 214.5 h / $1,801.80), written to axHub.
