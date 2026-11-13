# Server: every failed merge alerts Brett immediately and retries by itself until merged

Push banner 0.9.0. One server lander (`apps/console-web/plugins/push-banner/server/lander.py`).

## What changed
- **One gate.** Every merge attempt goes through `Lander.attempt`: console Merge (POST /merge), auto-merge, Claude
  sessions (`merge-pr.sh`, tagged `via: claude`), the CLI (`land/lander.mjs merge`), MCP (plugin command `merge`).
  Queue kicks from `land/merge-queue.mjs` join it too (`ingest_kicks`, once per kick).
- **Alert at once.** A real merge failure raises `merge:<repo>#<n>` (severity error, notify type `merge.failed`,
  `push: true`, high): what failed, why, who asked, what the server tries next. Bad requests (400/403) are not failures.
- **Retry ladder** (every auto-merge round, 3 min), per head commit:
  pull main in (x2) → Claude Code resolves conflicts / red CI (x1, 3 h to push a fix) → re-run failed CI jobs (x1) →
  merge again (x3). A new head resets the counts. Each attempt is logged in `lander.json` and sent as an FYI
  (`merge-fyi:<repo>#<n>`, info, `merge.retry`, never buzzes).
- **Stops** only when merged (alert resolved, one FYI) or every rung is used up (`stuck`: one error alert listing what
  was tried and exactly what is missing). Things only Brett can do (UI Review hold, draft) are `blocked`: told once,
  watched, and the ladder carries on by itself when they clear. CI running over 90 min on one head ends `stuck`.

## How it is reached (no UI added; server only)
- REST: `GET /api/plugins/push-banner/lander`, `POST …/lander/retry|forget {repo, number}`, `POST …/lander/round`,
  `POST …/merge {repo, number, confirm, via?}`.
- MCP: plugin commands `merge`, `lander-list`, `lander-retry`, `lander-forget`, `lander-round`.
- CLI: `node apps/console-web/plugins/push-banner/land/lander.mjs list|round|merge|retry|forget <owner/repo>#<n>`.
- Voice (AmberX): the plugin commands are on control@1 like every other plugin command; the alerts reach the phone
  through notify type `merge.failed`.

## Tests
- `python3 apps/console-web/plugins/push-banner/test_lander.py`: 38 checks (classify, gate, alerts, every rung, stuck,
  blocked, new head, queue kicks, queued repo, forget). Added to CI (android.yml, Python plugin tests).
- `python3 apps/console-web/plugins/push-banner/test.py`: 183 checks, unchanged, pass through the new gate.

## Choices made (nobody to ask)
- "Resolve" is the existing Claude Code Repair hand-over (axHub `vps.run`, Brett approves the run); the server does
  not resolve code conflicts itself.
- CI re-run is once per head, to catch flakes; then Claude, then stuck.
- On AmberX-AXF the merge rung puts the PR back in the merge queue (the queue lands it); the ladder then waits.
- Queue kicks also raise the queue's own `queue:<n>` alert; the lander's `merge:` alert is the one that says what's next.

## Gaps
- No console view for the lander yet (state is on REST/MCP/CLI and in the alerts). A view in the Merge queue tab is a
  follow-up.
