# Session check-in (spec)

**Status:** built Oct 18 2026 on Opus 5.5 as the console plugin `apps/console-web/plugins/session-checkin` (see "How it's built" at the end). Installed from Dev Console → Settings → **Session check-in**, or `node apps/console-web/plugins/session-checkin/install.mjs` in a terminal.

## What it does

Every new session starts with one short group of questions, asked **before any other work**. Location comes first. The answers check that the session is in the right place, with the right model and effort, and show what the session will cost. The answers and session data then go into an archive you can browse later.

Claude detects as much as it can first and offers it as the default answer. Most check-ins are then a few taps to confirm, not a lot of typing.

## When it runs

| Client | Trigger |
| --- | --- |
| Claude Code (VPS over mosh, desktop, laptop) | `SessionStart` hook, `matcher: "startup"` (a new session only; not resume, clear or compact) |
| Claude Code on the web / phone (cloud container) | same hook (the repo's `.claude/settings.json` travels with the clone) |
| claude.ai chat / Project | a rule in `memory/RULES.md`: on the first message of a new conversation, run the check-in before answering |
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
- **VPS terminal:** Claude Code over mosh on the Hostinger VPS. Detected from the hostname, the presence of `/opt/axhub`, and the `MOSH_*` / `SSH_CONNECTION` variables.
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
  1. axHub `memory/amberx-axf/` (live)
  2. the repo mirror `memory/` (read-only)
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

- **Definition:** `apps/console-web/plugins/session-checkin/baseline/BASELINE-v1.md`, pinned to commit `69e855d` (tag `baseline-v1` to be created from the VPS). The build must:
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
- **Calibration:** `apps/console-web/plugins/session-checkin/baseline/calibration.json`, `{ version: "baseline-v1", runs: [...] }`.
  - The estimate for a model × effort pair is the **median of its measured runs** × current prices.
  - **Pairs not measured yet** are scaled from the nearest measured pair and labelled **"uncalibrated"**.
  - **Recalibrate** only when Brett asks, or when a new model arrives. He approves each calibration run, because every run costs money.
- **Prices:** `apps/console-web/plugins/session-checkin/baseline/pricing.json`, with per-million input / output / cache-read prices for each of the three models.
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
  "memory":    { "source": "axhub", "fallback": false, "files": ["RULES.md", "project-memory/preferences.md", "..."], "opened": ["RULES.md"] },
  "model":     { "recommended": "opus", "why": "…", "picked": "opus", "running": "claude-opus-5-5", "switchNeeded": false },
  "effort":    { "picked": "high", "applied": "high" },
  "estimate":  { "baseline": "baseline-v1", "model": "opus", "effort": "high", "usd": 0.00, "calibrated": true, "pricesAsOf": "2026-10-18", "plan": true },
  "pending":   ["…ids waiting on the picked model"],
  "end":       { "at": null, "usage": null, "commits": [] }   // filled by the SessionEnd hook when the client has one
}
```

- **Where it's written** (first that works):
  1. the hub persist folder: `/opt/axhub/persist/amberx-axf/sessions/<YYYY>/<MM>/<id>.json`, plus an `index.jsonl` line, through `framework/cli/persist.mjs`
  2. the console API: `POST /api/sessions`
  3. axHub (`call`)
  4. the repo's `sessions/` folder, committed with the session's next commit
- **The cloud container is never the only copy:** it's temporary.
- **Never logged:** tokens, keys or other secrets, environment values, memory file contents, or the text of his messages.
- **Browsing:**
  - **Console:** a **Sessions** view: a newest-first table with filters (location, model, effort, mismatches, unattended) and a detail panel per session.
  - **Command line:** `node framework/cli/sessions.mjs [--last 20] [--location vps]`.
  - **MCP:** not exposed. Console plugin routes are never reachable through the console's MCP server (plugin security rule).
  - **Totals:** sessions per model, check-in mismatches, baseline estimate over time. A price change shows up as a step in that line.
- **Retention:** keep everything; records are small. Deleting needs Brett's approval, as with memory.

## How it's built

Plugin folder `apps/console-web/plugins/session-checkin/` (id `ai.amberx.axf.console.session-checkin`):

| File | Job |
| --- | --- |
| `lib.mjs` | Shared logic: config (`session-checkin-config@1`), install targets and hook entries, detection, memory listing, baseline estimates, archive read/write with secret scrubbing |
| `checkin.mjs` | The hook and CLI: `detect` (SessionStart), `log`, `end` (SessionEnd), `open <n>` (memory, read-only), `list`, `get`, `baseline`, `calibrate` |
| `install.mjs` | Installer: interactive in a terminal, `--json` for the console wizard (`status`, `preview`, `install`, `uninstall`) |
| `server/__init__.py` | Console routes `/api/plugins/session-checkin/{status,preview,install,uninstall,sessions,sessions/{id},baseline,pricing,detect}` (console token on every method) |
| `web/index.tsx` | **Sessions** view (nav → Plugins) and the Settings tab **Session check-in**: Status, Install or change (5-step wizard), Baseline build costs (prices form) |
| `baseline/` | `BASELINE-v1.md` (the fixed task), `calibration.json` (placeholder seed + measured runs), `pricing.json` |
| `test.mjs` | Self-test, run in CI |

Install targets: **this clone** (`.claude/settings.local.json`, git-ignored; on the VPS that's the console's clone `/opt/axf`), **every clone** (`.claude/settings.json`, commit + push), or **user** (`~/.claude/settings.json`, only from a terminal on that device). The installer only adds or removes its own hook entries (marked by `session-checkin/checkin.mjs` in the command) and keeps a `.bak` of the file. SessionStart runs on `startup` (optionally `resume`); stdout becomes the check-in instructions for Claude, ending with the record skeleton to fill in and pipe to `checkin.mjs log`.

Archive: `sessions/<YYYY>/<MM>/<id>.json`; written to the hub's `/projects/amberx-axf/_data/sessions/` where it's mounted, else the repo's `sessions/` (in the root manifest's `data.shared`, so `claude-sync` carries it to the hub). Unattended runs (`CLAUDE_CODE_SESSION_ATTENDED=0`, SDK entrypoints) are logged without questions.

## Done when

- A new Claude Code session on the VPS, in the cloud container and on a laptop opens with the check-in, location first, defaults pre-filled from detection.
- A repo or container mismatch is flagged before any other work happens.
- The memory step lists the files and opens any of them read-only; no write path exists from it.
- The model step follows the top-three policy and tells him the switch command when the pick differs.
- The effort step shows a baseline cost per level, labelled calibrated or uncalibrated, with the price date.
- Every check-in, including skipped and unattended ones, has an archive record off the container. Records are browsable in the console and the CLI.
- Nothing secret is ever written to the archive.
