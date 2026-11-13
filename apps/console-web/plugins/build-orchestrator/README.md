# Build orchestrator

Breaks every build into small Fable / Opus steps and runs the build pipeline (Pending → Queue → Active). The plugin's
description in `plugin.json` covers the tabs, the dispatcher and the accounts; this file covers auto-recovery.

## Auto-recovery (build auto-recover-stuck-builds, Nov 13 2026)

Brett: "if anything stops working, the server/orchestrator fixes it automatically with no one asking."

Every dispatcher tick (`pipeline.mjs tick`, cron every minute on the VPS) runs `recover.mjs` first, then fills every free
agent slot from the Queue (a refused launch hands its slot to the next Queue build in the same tick).

| Part | Where |
| --- | --- |
| Contract: stuck states, actions, retry counter + backoff, recovery-event@1, pure `plan()` | `framework/core/build-recovery.mjs` (fixtures `framework/spec/fixtures/build-recovery.json`) |
| Exit records + heartbeats (session-status@1): exit code, signal (143 = SIGTERM), end time, account, log | `deploy/claude-headless.sh` → `framework/cli/agent-slots.mjs session …`, files in `<agent-slots dir>/sessions/` |
| Liveness: running builds × PIDs, heartbeats, tmux, exit records, slots → the `plan()` input | `framework/cli/session-liveness.mjs list [--json]` |
| Executor: reset the open step, back to Queued with a note, counter + backoff, release leaked slots, end hung sessions, park at the cap | `recover.mjs` |
| Another worker after a usage limit or login error | hint on `pipeline.planned`, `pipeline-core.mjs` `recoveryHint` / `hinted` |
| FYI per fix | notify types `build-recovered`, `build-recovery-parked` (`notify.json`) |
| Systems check item `builds-stuck-recovery`, auto-fix on by default | `server/__init__.py` (axf.health@1) |

Stuck states: `no-session` (marked running, nothing live), `killed` (exit 143 / 137), `failed` (any other non-zero exit,
or the pipeline marked it failed in the last 24 h), `stale-heartbeat` (hung: stream still for 20 min), `slot-leaked`.
A session that ended with exit 0 is left to the dispatcher's session-end pass for 15 minutes (a phase that ended on
purpose). A slot under a live session, or taken in the last 5 minutes, is never released.

### Reach it

| | |
| --- | --- |
| UI | Build orchestrator → **Recovery** tab (log, Retry / Park, Run now / Dry run); Settings → Plugins → Build orchestrator → **Recovery**; a badge on every build card |
| Deep link | `console_show builds/orchestrator/recovery` (also `build-orchestrator/recovery`, action `build-orchestrator.open:recovery`) |
| REST | `GET recovery` · `POST recovery/run {dry_run}` · `POST recovery/settings` · `POST recovery/retry/<id>` · `POST recovery/park/<id> {why}` under `/api/plugins/build-orchestrator/` |
| MCP | plugin commands `recovery-status`, `recovery-run`, `recovery-settings`, `recovery-retry`, `recovery-park` |
| CLI | `node apps/console-web/plugins/build-orchestrator/recover.mjs status | run [--dry-run] | retry <id> | park <id> [--why w] | settings [set k=v…] | health` |
| Voice (AmberX) | `recovery.status`, `recovery.run`, `recovery.retry:<build>` |

Settings (Claude settings, group Builds): `builds.recovery.enabled` (on), `builds.recovery.maxRetries` (3),
`builds.recovery.staleHeartbeatMin` (20), `builds.recovery.backoffMin` ("1,5,15"), `builds.recovery.fyi` (on).

Data: `recovery-state.json`, `recovery.jsonl`, `recovery.lock`, `recovery-request.json` in the pipeline's data folder
(removed by uninstall through `hooks.mjs`); every build's own record (`recovery` on builds@1) stays in the builds store.

Tests: `test/recover.test.mjs`, `server/test_recovery.py` (both in CI).
