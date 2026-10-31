# Session browser (`session-history`)

Builds → **Session browser**: every Claude Code session, headless `claude -p` run and agent-swarm run in one live
grid. Built Oct 31 2026 (Angel build `session-history`, Opus; steps s2–s4 were pinned to Fable).

## What it shows

- **Grid** (live: polls `runs?since=<stamp>` every 3 s while visible; pause / resume): agent, build, job, model,
  status (running · done · failed · killed for budget · killed · stopped · ended), tokens, cost, duration, started.
  Every column sorts; search (every word, any field); kind / status / model filters; rows collapse.
  **Totals** of the shown rows at the bottom, with a **per-model** breakdown.
- **Row** opens to its facts (folder, branch, tokens by kind, budget) and tabs:
  - **Watch live** (running runs): its live file tailed every 2 s, readable lines; **Kill** (tap twice) for running
    headless / agent runs.
  - **What it did**: its summary (report → result → last reply) and one line per commit it made (item = subject, what
    was wrong = the body's first paragraph, files with +/− and before / after from `git show`, or from its own Edit calls
    when the checkout is gone), edits not committed, links (commit, file, branch, PR), its Codebase changes entries and
    Session check-in record. Each line has an **est.** price: the tokens of the turns that produced it.
  - **Context**: one item per turn: what flowed into its context since the turn before, what it said back, cost per turn.
  - **Tools**: every call with input and result, cost per command (its share of the turn, est.).
  - **Conversation** (regular sessions): prompts and replies.

## Where runs come from (Settings → Plugins → Session browser)

| Source | Default folders | Format |
|---|---|---|
| Claude Code transcripts | `~/.claude/projects` (+ `$CLAUDE_CONFIG_DIR/projects`) | `<project>/<session id>.jsonl` |
| Headless stream logs | the repo root, `~/b` (and one level down) | `--output-format stream-json` (`deploy/claude-headless.sh` keeps `<log>.jsonl`) |
| Agent reports | `.axf-console/agent-runs`, `.axf-console/plugins/agent-swarm` | `agent-run@1` files, the agent swarm's `runs.json` (`swarm-runs@1`) |

Pieces are merged by Claude Code session id. A report without one is matched to the transcript that ran in its
folder while it ran. Swarm transcripts (entrypoint `axf-swarm`, or a folder under `agent-swarm/worktrees/`) count as
agent runs even before their record is written.

**Cost**: the result's `total_cost_usd` (exact) > the report's `costUsd` > every turn's usage priced with
`framework/schemas/model-pricing.json` (1-h cache writes at 2× input; Haiku uses a built-in price until it's listed).

### agent-run@1 (one JSON file per run, for runners other than the swarm)

```json
{ "$axf": "agent-run@1", "id": "r1", "sessionId": "<claude session id, optional>",
  "agent": "docs-writer", "build": "session-history", "job": "s7", "model": "claude-haiku-5-5",
  "status": "running|done|failed|killed-budget|killed|stopped", "startedAt": "…", "endedAt": "…",
  "worktree": "/abs/folder", "branch": "…", "pid": 1234, "tmux": "axf-<slug>", "pr": "https://github.com/…/pull/n",
  "costUsd": 0.12, "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
  "budget": { "usd": 1, "tokens": 200000, "turns": 30 }, "commits": ["<sha>"],
  "summary": "one or two lines", "changes": [{ "item": "…", "wrong": "…", "before": "…", "after": "…", "files": ["…"] }] }
```

## Kill

`POST runs/{id}/kill {confirm: <id>}`; only running headless / agent runs. The process is the report's `pid` (must be
Claude Code), its `tmux` session (`axf-*`), a process naming the session id, or the only `claude -p` in its folder;
anything else is refused, never guessed. SIGTERM, then SIGKILL after 5 s. Recorded in `killed.json`. The console can
only stop processes it can see (same machine, same container).

## Files

`server/runs.py` (store, incremental parsing, prices) · `did.py` (what it did) · `tabs.py` · `kill.py` (watch + kill)
· `__init__.py` (routes) · `web/core.ts` (rows, sort, filter, totals; `core-check.mts`) · `web/*.tsx`.
Data folder: `config.json`, `killed.json`; the files it reads are never written. Self-test: `python3 test.py`.
