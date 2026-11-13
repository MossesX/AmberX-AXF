# Auto-recover stuck builds (`auto-recover-stuck-builds`)

Brett, Nov 13 2026 11:45: "if anything stops working, the server/orchestrator fixes it automatically with no one
asking. Detect builds marked running with no live session (killed exit 143, failed exit 1), reset and requeue them,
retry failed sessions, keep every slot filled, FYI to phone per fix."

Phase 1 (Fable, s1–s2): the `build-recovery@1` contract, `framework/core/build-recovery.mjs`, with its golden fixtures.
Phase 2 (Opus, s3–s15): everything below.

## What was added

| Step | Part | Files |
| --- | --- | --- |
| s3 | Exit records + heartbeats (`session-status@1`). Each headless session writes `<agent-slots dir>/sessions/<session>.json` when claude starts and when it ends: exit code, signal (143 = SIGTERM, 137 = SIGKILL), end time, account and log. TERM / HUP / INT are trapped and recorded. `<session>.heartbeat` holds the time claude's stream last moved. | `deploy/claude-headless.sh`, `framework/cli/agent-slots.mjs` (`session start\|beat\|end\|list\|dir`) |
| s4 | Liveness reader: joins running / waiting / failed builds with exit records, heartbeats, PIDs (on their own host), tmux and agent slots, and returns the `plan()` input | `framework/cli/session-liveness.mjs list [--json] \| input` |
| s5 | Executor: one builds-store write under the store lock, journalled and published to main by builds-live. It resets the open step, puts the build back in Queued with a note, adds to the retry counter and backoff, releases the leaked slot, ends a hung session first, and parks the build in Pending with the reason at the cap. `--dry-run` changes nothing. | `apps/console-web/plugins/build-orchestrator/recover.mjs` |
| s6 | Dispatcher: every tick runs recovery first, then fills every free slot. A refused launch hands its slot to the next Queue build in the same tick (up to 3 planning rounds). The backoff is respected (`canLaunch`), and a person queuing a build resets its counter. The cron is unchanged. | `pipeline.mjs`, `pipeline-core.mjs` |
| s7 | Another worker: when the run's log shows a usage limit or a login error (`claude-workers hitOf`), the retry carries a hint on `pipeline.planned` naming the worker `claude-workers route` picked. Routing puts that worker first and the account that stopped last. | `recover.mjs`, `pipeline-core.mjs` (`recoveryHint`, `hinted`) |
| s8 | FYI per fix: notify types `build-recovered` and `build-recovery-parked` send one plain line each through the alerts hub (axf.notify@1). Parked builds always get one; other fixes follow the FYI setting. | `notify.json`, `recover.mjs` |
| s9 | Systems check item `builds-stuck-recovery` (axf.health@1) with an auto-fix in mode auto (Fix it yourself: on). It turns red only when a build is parked or a recovery round failed. | `server/__init__.py`, `recover.mjs health` |
| s10 | Recovery settings sub-tab on framework controls, following the level toolbar (Basic shows the switches, Developer adds the numbers). The values are Claude settings `builds.recovery.*`, each with a level. | `web/RecoverySettings.tsx`, `claude-settings/registry.json` |
| s11 | Recovery log tab (DataGrid with a PriorityTag per row, TabGroup tab) and a recovery badge on every pipeline card and in the All builds grid | `web/RecoveryLog.tsx`, `web/recovery.ts`, `web/ui.tsx`, `web/pipeline.tsx` |
| s12 | API parity (REST, MCP, CLI, voice, deep link) | see below |
| s13 | Tests: `test/recover.test.mjs` (12) and `server/test_recovery.py` (26), both in CI | `.github/workflows/android.yml` |
| s14 | Uninstall removes the recovery files (`hooks.mjs`). Also: help entries, app menu Builds → Recovery log, `README.md`, catalog feature `cx.buildengine.autorecover`, and a Shipped features seed entry. | |
| s15 | UI Review with 3 layouts for the log, report, THREADS row, PR | |

## Stuck states handled

| State | Detected by | Action |
| --- | --- | --- |
| `no-session` | marked running / waiting, no record, no tmux session, no slot, past the 5-min launch grace | requeue |
| `killed` | exit record 143 (SIGTERM) or 137 (SIGKILL) | retry (backoff 1 / 5 / 15 min) |
| `failed` | any other non-zero exit (1), or the pipeline marked it failed in the last 24 h | retry; usage limit / login error → another worker |
| `stale-heartbeat` | session alive, stream still for 20 min | end the session, then retry |
| `slot-leaked` | a running slot names a build that is not live | release the slot (never under a live session or within 5 min of being taken) |
| cap reached | 3 retries with no step ticked in between | park in Pending with the reason, red systems check item, FYI |

A session that ended with exit 0 is a phase that stopped on purpose. The dispatcher's session-end pass handles it;
recovery steps in only if it is still unclosed after 15 minutes.

## How each part is reached

| | Deep link | REST (`/api/plugins/build-orchestrator/…`) | MCP | CLI | Voice (AmberX) |
| --- | --- | --- | --- | --- | --- |
| Recovery log / state | `console_show builds/orchestrator/recovery` (also `build-orchestrator/recovery`, action `build-orchestrator.open:recovery`) | `GET recovery` | `recovery-status` | `recover.mjs status [--json]` | `recovery.status` |
| Run recovery | | `POST recovery/run {dry_run}` | `recovery-run` | `recover.mjs run [--dry-run]` | `recovery.run` |
| Retry a build | | `POST recovery/retry/<id>` | `recovery-retry` | `recover.mjs retry <id>` | `recovery.retry:<id>` |
| Park a build | | `POST recovery/park/<id> {why}` | `recovery-park` | `recover.mjs park <id> --why …` | |
| Settings | Settings → Plugins → Build orchestrator → Recovery | `POST recovery/settings` | `recovery-settings` | `recover.mjs settings [set k=v]` | `settings.set:builds.recovery.<key>:<value>` (Claude settings fields) |
| Liveness | | | | `session-liveness.mjs list` | |
| Health item | systems check banner | `GET /api/…/health` (systems check) | | `recover.mjs health` | |

## Decisions (no one to ask)

- The systems check item is `builds-stuck-recovery`, not `builds-stuck`. Systems-check already registers a built-in
  `builds-stuck` (change-log entries), and the registry keys by id, so the same id would replace one of the two
  depending on which plugin loads first.
- The account hint uses the existing `pipeline.planned` field (`why: auto-recovery: <from> stopped …`). That avoids a
  `build-pipeline@1` schema change in an Opus phase.
- Fixed in passing: every dispatcher alert carried the link `#/build-orchestrator`, which the console's alerts API
  refuses with 400 (it takes only `http(s)://`, `view:` or `settings:` links), so none of them arrived. The link is
  now `view:build-orchestrator`.
- The Recovery log ships three looks for UI Review (grouped, timeline, compact) behind the local key
  `orch-recovery-layout`. Grouped is the default until Brett picks.

## Open

- UI Review: Recovery log r-20261113-0b8d5125 (3 options: grouped, timeline, compact; option assets in
  `apps/console-web/plugins/build-orchestrator/assets/interface/`) and Recovery settings r-20261113-7fa47dbf (single
  option, reason on the item) are waiting for Brett. PR #574.
- `plugin-lifecycle check build-orchestrator` still lists three stale references that were already on main
  (`framework/spec/check-build-limit.mjs:24`, `framework/spec/check-projects.mjs:51,61`). They are not from this build.
- Kotlin twin of build-recovery@1: deferred (framework/spec/PORTING.md, from phase 1).
- Fresh exit records start with the first session launched after this merges. Older running sessions are judged by
  tmux and slots only.

## Tests

`framework/spec/check-build-recovery.mjs` 31 · `check-agent-slots.mjs` 56 · `pipeline.test.mjs` 46 ·
`test/recover.test.mjs` 12 · `server/test_recovery.py` 26 · `build-orchestrator/test.py` 41 · `check-build-limit.mjs`
52 · claude-settings 21 · notify-control 133 · check-theme / check-controls / check-toolbars / check-chrome-assets ·
glossary `catalog.mjs --check` · `tsc --noEmit` (console-web): all pass.
