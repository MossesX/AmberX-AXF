<!-- Moved from .claude/SESSION-CHECKIN.md on Oct 18 2026 (claude-fs@1); paths updated to _memory and /Claude. -->
# Session check-in (spec)

**Status:** defined Oct 18 2026, not built yet. Suggested build model: Opus 5.5. It's hooks, a small CLI, an archive, a console view and MCP tools, and nothing in it needs Fable.

## What it does

Every new session starts with one short group of questions, asked **before any other work**. Location comes first. The answers check that the session is in the right place, with the right model and effort, and show what the session will cost. The answers and session data then go into an archive you can browse later.

Claude detects as much as it can first and offers it as the default answer. Most check-ins are then a few taps to confirm, not a lot of typing.

## When it runs

| Client | Trigger |
| --- | --- |
| Claude Code (VPS over mosh, desktop, laptop) | `SessionStart` hook, `matcher: "startup"` (a new session only; not resume, clear or compact) |
| Claude Code on the web / phone (cloud container) | same hook (the repo's `.claude/settings.json` travels with the clone) |
| claude.ai chat / Project | a rule in `_memory/shared/rules/` (synced to the hub): on the first message of a new conversation, run the check-in before answering |
| Unattended runs (`claude -p`, scheduled tasks, no one to ask) | ask nothing; use the detected values and the last archived answers for that location; log the run as `unattended` |

Words that skip or shorten the check-in:
- **"skip":** no questions. Log the session with `skipped: true` and whatever was detected.
- **"same as last":** reuse the last archived answers for this location. Show them in one line and still run the checks.

## The questions, in order

Each question shows the **detected** value as the first option, marked "(detected)". A question that doesn't apply to this client is **left out**, not asked with an "n/a" answer. If the client limits how many questions fit in one prompt, ask them in two rounds:
- **Round 1:** where am I? (1–4)
- **Round 2:** how should I work? (5–7)

### 1. Location
Where is this session running?
- **VPS terminal:** Claude Code over mosh on the Hostinger VPS. Detected from the hostname, the presence of `/Claude`, and the `MOSH_*` / `SSH_CONNECTION` variables.
- **Cloud container:** Claude Code on the web or phone. Detected from the remote-session environment markers.
- **Desktop / laptop:** local Claude Code.
- **claude.ai:** a chat or Project, so there's no shell.

The answer decides which of questions 2–5 apply.

### 2. Repo (if there is a working directory)
- **Show:**
  - `git remote get-url origin`, the branch and short HEAD
  - clean or dirty
  - ahead or behind `origin`
- **Expected:** `MossesX/AmberX-AXF` unless Brett names another repo.
- **Options:**
  - **This repo is right:** the detected one.
  - **A different repo:** he names it; Claude switches to it, or clones it if it's missing.
  - **No repo for this session.**
- **On a mismatch, or when behind `origin`:** say so before doing anything else, and offer to pull or switch.

### 3. Container (if there is one)
- **Show:** what the session runs inside. One of:
  - the cloud container, which is temporary and reclaimed when idle
  - a Docker container: its name, read from `/proc/1/cgroup` or `/.dockerenv`
  - the bare VPS host
- **Expected by location:**
  - VPS terminal → the host, **not** inside the `axf-console` container, unless he says so
  - cloud → a temporary container. Remind him that only pushed work and archived data survive it.
- **On a mismatch:** say so before doing anything else.

### 4. Project (if one applies)
- **Show:**
  - the claude.ai Project attached to the session (e.g. "AmberX Framework"), if any
  - otherwise the project the repo belongs to (from `CLAUDE.md` / the plan)
- **Options:** confirm, or name another.

### 5. Memory files (if any are reachable)
- **Show:** where memory was loaded from, in priority order:
  1. `/Claude` on the hub (live, through `claude-sync`)
  2. the project's `_memory/` (synced copy; used as-is when the hub can't be reached)
  3. the claude.ai memory store, in claude.ai or a session attached to a Project
- **Also show:** whether the hub was reachable or the mirror was used as a fallback.
- **List the files** (path, size, last updated) as a numbered list.
- **Open:** Brett can open any of them to **read only**: "open 3" or "open RULES" prints the file.
  - Nothing in this step edits, saves or deletes memory.
  - Changes go through the normal channels (`axhub.memory_write`, or the claude.ai memory tools on an explicit ask).
- **This step logs file names only, never their contents.**

### 6. Model
- **Recommend** one of the top three models only, using the existing policy:
  - **Fable 5.1:** kernel internals, porting, cross-port contracts, heavy refactors
  - **Opus 5.5:** everything else, and anything security-adjacent
  - **Sonnet 5.5:** only when Opus is clearly not needed
- **Show:** the model the session is actually running on.
- **If his pick differs:** Claude can't switch models itself. Tell him the command (`/model <fable|opus|sonnet>`, or relaunch with `claude --model …`) and wait.
- **Check the pending build list** (`pending_list`) here as well: if something there is waiting on the picked model, mention it.
- **If no task has been given yet:** recommend from the open build-queue step (`build_next`). That's the most likely work.

### 7. Effort level, with a cost estimate
- **Levels:** `low · medium · high · xhigh · max` (where the client can set effort; otherwise record "client default").
- **Each option shows the estimated cost of the baseline build** (below) for the chosen model at that effort level.
- **Why a fixed baseline:** the same reference build every time gives a consistent number to compare across sessions, models and price changes. It is **not** an estimate of today's task.
- **On a Claude plan** (`claude-pick` → plan), show the API-equivalent cost and label it so: a plan doesn't bill per token.

## The baseline build (fixed reference)

A small, fully specified build that never changes. Its cost per model × effort is **measured**, not guessed.

- **Definition:** `.claude/baseline/BASELINE-v1.md`, pinned to git tag `baseline-v1`. The build must:
  1. Read three named files: `framework/core/engines/layout.ts`, `framework/spec/PORTING.md`, `framework/schemas/asset-types.json`.
  2. Add one fully specified pure function (`compareSlots(a, b)`, spec in the file) to a scratch copy of `layout.ts`, with five named unit tests.
  3. Run `tsc --noEmit` and the tests; both must pass.
- **Where it runs:** always in a throwaway worktree at `baseline-v1`. It's never merged or pushed.
- **What's measured per run:**
  - input, output and cache-read tokens
  - tool calls and wall time
  - pass/fail
  - model and effort
- **Usage sources:** Claude Code's `/cost` / usage output, or the API `usage` fields when on an API key.
- **Calibration:** `.claude/baseline/calibration.json`, `{ version: "baseline-v1", runs: [...] }`.
  - The estimate for a model × effort pair is the **median of its measured runs** × current prices.
  - **Pairs not measured yet** are scaled from the nearest measured pair and labelled **"uncalibrated"**.
  - **Recalibrate** only when Brett asks, or when a new model arrives. He approves each calibration run, because every run costs money.
- **Prices:** `.claude/baseline/pricing.json`, with per-million input / output / cache-read prices for each of the three models.
  - Filled in and dated from docs.claude.com when calibrated.
  - The check-in shows the date. If it's older than 60 days, the estimate carries a "prices may be stale" tag.
- **A new baseline version** (`baseline-v2`) starts a new calibration. It never overwrites v1, so the history stays comparable.

## The archive

Every check-in writes one record, `session-log@1`:

```jsonc
{
  "$axf": "session-log@1",
  "id": "2026-10-18T07-56-12Z-vps-3f9c",       // started-at + location + short random
  "startedAt": "2026-10-18T11:56:12Z",
  "client": "claude-code",                      // claude-code | claude-ai | unattended
  "unattended": false, "skipped": false, "sameAsLast": false,
  "location":  { "answer": "vps", "detected": "vps", "host": "srv1837178" },
  "repo":      { "answer": "MossesX/AmberX-AXF", "detected": "MossesX/AmberX-AXF", "branch": "main", "head": "d74b95d", "dirty": false, "behind": 0, "ok": true },
  "container": { "answer": "host", "detected": "host", "ok": true },
  "project":   { "answer": "AmberX Framework", "detected": "AmberX Framework" },
  "memory":    { "source": "axhub", "fallback": false, "files": ["shared/rules/RULES.md", "rules/RULES.md", "..."], "opened": ["rules/RULES.md"] },
  "model":     { "recommended": "opus", "why": "…", "picked": "opus", "running": "claude-opus-5-5", "switchNeeded": false },
  "effort":    { "picked": "high", "applied": "high" },
  "estimate":  { "baseline": "baseline-v1", "model": "opus", "effort": "high", "usd": 0.00, "calibrated": true, "pricesAsOf": "2026-10-18", "plan": true },
  "pending":   ["…ids waiting on the picked model"],
  "end":       { "at": null, "usage": null, "commits": [] }   // filled by the SessionEnd hook when the client has one
}
```

- **Where it's written** (first that works):
  1. `_memory/sessions/<YYYY>/<MM>/<id>.json` plus an `index.jsonl` line, synced to `/Claude/projects/<project>/_memory/sessions/` by `claude-sync` (claude-fs@1 `sessions/` section)
  2. the console API: `POST /api/sessions`
  3. axHub (`call`)
  4. the repo's `sessions/` folder, committed with the session's next commit
- **The cloud container is never the only copy:** it's temporary.
- **Never logged:** tokens, keys or other secrets, environment values, memory file contents, or the text of his messages.
- **Browsing:**
  - **Console:** a **Sessions** view: a newest-first table with filters (location, model, effort, mismatches, unattended) and a detail panel per session.
  - **Command line:** `node framework/cli/sessions.mjs [--last 20] [--location vps]`.
  - **MCP:** `session_list` / `session_get`.
  - **Totals:** sessions per model, check-in mismatches, baseline estimate over time. A price change shows up as a step in that line.
- **Retention:** keep everything; records are small. Deleting needs Brett's approval, as with memory.

## Pieces to build (when this is picked up)

1. **Detection:** `framework/cli/session-start.mjs detect`
   - Prints the detected context (location, repo, container, project, memory source and file list, running model, pending items, baseline estimates) as a short block for Claude's context.
   - Runs from the `SessionStart` hook, which replaces the current `cat model-policy.md` hook (the policy text is folded into the block).
2. **The questions:** Claude asks them with the multiple-choice question tool, two rounds of up to four. When no question tool is available, it asks in plain text.
3. **Logging:**
   - `session-start.mjs log` writes the record (stdin JSON → validate → write).
   - `session-start.mjs end`, from a `SessionEnd` hook where supported, fills in `end`.
4. **Baseline:**
   - `.claude/baseline/BASELINE-v1.md`, `calibration.json`, `pricing.json`, and the `baseline-v1` tag.
   - `session-start.mjs calibrate --model … --effort …` prints the steps for a measured run and records the usage he pastes or the client reports.
5. **Archive access:** `framework/cli/sessions.mjs`, `GET/POST /api/sessions`, MCP `session_list`/`session_get`, and the console **Sessions** view.
6. **claude.ai side:** a short rule in `_memory/shared/rules/` (synced to the hub) so claude.ai sessions run the same check-in. They log through axHub, since they have no shell.

## Done when

- A new Claude Code session on the VPS, in the cloud container and on a laptop opens with the check-in, location first, defaults pre-filled from detection.
- A repo or container mismatch is flagged before any other work happens.
- The memory step lists the files and opens any of them read-only; no write path exists from it.
- The model step follows the top-three policy and tells him the switch command when the pick differs.
- The effort step shows a baseline cost per level, labelled calibrated or uncalibrated, with the price date.
- Every check-in, including skipped and unattended ones, has an archive record off the container. Records are browsable in the console, the CLI and MCP.
- Nothing secret is ever written to the archive.
