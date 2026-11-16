# merge-main-land-server-gate-one-session

Main merged into `claude/server-gate-one-session-per-build-no` (PR #610). All six code clashes are resolved, keeping what both sides intended. No new PR.

## Conflicts and how they were resolved
| File | Resolution |
|---|---|
| `apps/console-web/plugins/build-orchestrator/pipeline.mjs` | Both `server-gate.mjs` and main's `build-lock.mjs` are imported. The launch loop stops trying other accounts in two cases: main's `e.code === 'live'` path (launch-gated, adopt the live session) and the branch's server-gate "One session per build" refusal (still logged as a refusal). |
| `apps/console-web/plugins/build-orchestrator/server/__init__.py` | The branch's `/gate-log` and `/gate-banner` routes and main's `console-focus@1` service are both kept. |
| `apps/console-web/plugins/build-orchestrator/web/index.tsx` | Main's `open` / `focus` / `tab` actions (with `effect` metadata) are kept, plus the branch's `gate-log` (navigate) and `gate-banner` (write) actions with `params` / `effect` added. |
| `apps/console-web/plugins/push-banner/land/merge-queue.mjs` | Main's import line is used. The main-gate log entry now runs `framework/cli/server-gate.mjs record` as a CLI (the same pattern as `crewSay`), because main's land test allows only node built-ins and imports from this folder. |
| `deploy/claude-headless.sh` | The branch's `gate_hold` calls and the slot-limit gate record are kept, along with main's build-account pick, build-limit release and build-lock check. The tmux env list is the union of both. |
| `framework/plan/builds-merge-core.mjs` | The branch's `mergeRun` is kept and main's `alias` carry-over is added. |
| `_claude/builds/*` | Main's copy is used (newer wins). |

## Tests
- `node --test` on pipeline, build-id, land, merge-queue, server-gate, claude-workers and claude-login: 7/7 files pass.
- `tracker.mjs --check`, `check-theme.mjs` and `check-controls.mjs` pass.
- `claude-workers` and `claude-login` launch the real `claude-headless.sh`. On this VPS they are refused by main's hard build limit (8/8 builds running) unless they run with `AXF_BUILD_LIMIT=off`. That behaviour comes from main and depends on the environment; CI is not affected.
- I didn't run a TypeScript check locally because the temporary worktree has no node_modules. CI covers it.
- A trial merge of the newest main into the branch is clean.

## API
This build adds no new UI. The gate-log and gate-banner actions already existed on the branch and are reached through REST (`/gate-log`, `/gate-banner`), MCP, `server-gate.mjs` and voice, as before.
