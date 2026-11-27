# emergency-remove-every-leftover-js: Postgres is the one store

Build `emergency-remove-every-leftover-js` (Pipeline 2.0, 7 steps, Nov 27 2026). This report is step s7 (Fable):
tests, guard and report, taken on the seven step branches merged together
(s1 `5db54a89c`, s2 `4fc4855c4`, s3 `d84ea580c`, s4 `6ebdb4b1e`, s5 `91eee0622`, s6 `1c014a49f`, on main `a26f2f9b3`).
No PR of its own: the lander merges every step into one.

Brett, Nov 25 2026: "Postgres is the one store. Delete every JSON data file the database already covers, plus every
reader and writer of it. No dual writes, no JSON backups."

## Result in short

- Direct JSON data writes in runtime code: **222 in 118 files → 11 in 8 files**. The 11 are a closed list, each with
  its reason; 7 of them are the pipeline folder that build `pipeline-fixes-drop-7-mb-status-file` owns.
- axf-data: **21 tables → 107** (`TABLES_VERSION 4`). Every leftover document has rows; one change is one row.
- The path map is `store.mode: cutover`: no file fallback, no shadow write, no drift compare, in Node and in Python.
- Migration dry run on the VPS: **17 151 files, 363 204 rows, 44 namespaces, nothing refused**. `--apply` has **not**
  been run: it deletes live files and is the deploy step below.
- Tests: the data layer, axf-data (SQLite and Postgres), the migration and every framework/spec check that passes on
  main pass. **6 plugin tests that pass on main fail on the merged build** (listed below with the cause). They are
  in files other steps own and two of those steps were running again while this was written, so they are reported
  here, not changed here.

## Needs doing before this code runs on the VPS (order matters)

1. Redeploy `axf-data` first. The live service has 46 tables; the new ones (s1) are created and backfilled when it
   connects (`GET /v1/_meta/tables` → `backfill`, 0 failed expected).
2. Stop the console and the pipeline writers, then run
   `node framework/cli/migrate-json-leftovers.mjs --apply` from `/opt/axf` on the new code. It copies key by key,
   reads every row back, switches the namespace and deletes the file, with no backup copy. It stops a namespace at
   the first mismatch and leaves its files. Exit 0 = nothing left.
3. Start the console and the pipeline.

Why the order: five namespaces are still `local` on the VPS (`builds` 25 files, `console` 203, `phone` 1 452,
`plugins/activity` 18, `plugins/skin-editor` 2). They have no copy in axf-data. New code reads axf-data only, so
started before step 2 it would read them as empty and write fresh rows over nothing. Deleting hub files is Brett's
call (veto item in the old inventory), which is why s7 ran the dry run only.

## What was removed, per area

| Area | Step | What changed | Counted writes before → after |
|---|---|---|---|
| `services/axf-data` | s1 | 86 tables added (below); row get / put / delete on every family; backfill on connect | (the layer, not counted) |
| `framework/schemas/data-store-paths.json` | s2 | `store.mode: cutover`; every `to: null` rule carries its reason; rules for auto-lander, build-rules, host-services, model-triage and the console's host documents | — |
| `framework/cli` | s2 | agent-slots, build-limit, build-hooks cursors, builds-live status, builds-reconcile, engine-rpc, persist, plan, plugin-lifecycle, profiles, projects, reaper, rules-brief, shipped-files, skins, watch-live write through `data-files.mjs`; their temp-file and rename code, the agent-slots shadow copy and `data local` are gone; new `migrate-json-leftovers.mjs` | 118 in 49 → 4 in 4 |
| `framework/core` | s5 | `build-rules.mjs`: a change is one row patch, no `store.json` / `history.jsonl` / `store.lock`; `data-files.mjs`: no mirror on write, no drift compare, no file fallback; `data-store.mjs`: no local-file backend | 3 in 1 → 0 |
| `apps/console-web/server` | s4 | `data_store.py` cutover only; console state, alerts, push subscriptions, home layouts, build profiles, projects, host mode, console-control audit through the layer; the terminal ring buffer is no longer persisted | 2 in 2 → 0 |
| `deploy` | s6 | claude-workers (workers, worker-state, seen: one row per claim / limit / usage), console-nightly state, lander heartbeat / control / settings through `data-files.mjs`; new `deploy/data-rows.mjs`; `dryrun/results/console-down-drill.json` deleted | 12 in 6 → 0 |
| `apps/console-web/plugins` (48 plugins, 92 files) | s3 | below | 87 in 60 → 7 in 4 |

Plugins (s3). Converted to `data_store` / `data-files.mjs`, with their readers, lists and removes:
activity, agent-manager (add-ons, memory, store records), agent-swarm, agent-voice, ai-assistant, amberx-listeners,
approvals-banner, brand-library, chat-viewer (store, audio), claude-accounts, claude-badge, claude-handoff (machines,
config, session notes, state, results runs; uninstall removes rows one by one), claude-session, codebase-changes,
console-commands, console-terminal, container-access, context-menu-designer, demonstration-designer, feature-assist,
feature-matrix (the mirror copy in the plugin folder and its fallback read are deleted), follow-amber, gate,
glossary-index, main-build-status, maintenance (engine and profile clean-up records; runs listed by id), molly-guide,
notify-control, output-recorder, plan-studio-2, plugin-commands, plugin-manager (lazy-load settings and report),
plugins-menu, project-wizard, session-checkin, skin-editor, skin-gallery, snapshot-manager, status-styles,
systems-check, theme-editor, theme-manager, todo-manager, token-control, ui-review (`migrate --apply` no longer makes
`*.pre-schema-*` backup copies), wake-listener, whats-shipped.
builds-page and agent-manager's gittools, hubtools, toolkit and llm kept no JSON data files: nothing to move.

Per plugin, counted writes before → after: activity 4 → 0, agent-manager 1 → 0, agent-swarm 1 → 0,
ai-assistant 1 → 0, amberx-listeners 1 → 0, approvals-banner 2 → 0, **build-orchestrator 11 → 7**, chat-viewer 4 → 0,
claude-accounts 2 → 0, claude-handoff 3 → 0, claude-session 1 → 0, codebase-changes 1 → 0, console-commands 2 → 0,
console-terminal 1 → 0, container-access 1 → 0, demonstration-designer 2 → 0, feature-matrix 1 → 0,
follow-amber 1 → 0, gate 4 → 0, glossary-index 6 → 0, maintenance 2 → 0, molly-guide 1 → 0, notify-control 1 → 0,
output-recorder 2 → 0, plan-studio-2 2 → 0, plugin-commands 2 → 0, plugin-manager 2 → 0, project-wizard 2 → 0,
push-banner 3 → 0, session-checkin 2 → 0, skin-editor 1 → 0, skin-gallery 2 → 0, snapshot-manager 1 → 0,
systems-check 1 → 0, token-control 4 → 0, ui-review 6 → 0, wake-listener 3 → 0.

Repo and manifest (s7):
- `project.manifest.json` `data.shared`: 13 paths → 2. Removed: `framework/plan/{pending,plan,build-queue,profiles,
  projects}.json`, `framework/catalog/{status,libraries}.json`, `framework/schemas/project-rules.json`, `sessions/`,
  `changes/`, `build-rules/` (rows now; `persist.mjs push | pull` no longer copies them to or from the hub, and the
  systems check "Shared data files" item no longer looks for them). Kept: `framework/plan/media/` (binary media) and
  `tracker.json` (read-only export of the catalog status table).
- `framework/spec/DATA-INVENTORY.md`: new first section "After the leftover removal": every JSON file that stays with
  its reason and where that reason is enforced, every file of the old inventory marked gone with its table, and the
  tables added.

## Tables added (`services/axf-data/tables.py`, 21 → 107)

- 63 document tables `plugin_<folder>__<document>` (one row per item, `section = <document>#<list>`): agent-manager
  (addons, agents, hub_runs, lingo, personas, runs, skills, tools, training, workflows), agent-swarm (state, runs,
  chats_index, chats_mentions), agent-voice, ai-assistant (config, usage), auto-lander, build-orchestrator (advice,
  bugs, build_rules_seed, dup_check_checks, matrices, merge_review, origins, pipeline_accounts_host,
  pipeline_dispatch, pipeline_merge_banner, pipeline_routes, pipeline_watchdogs, pipeline_watchdogs_stale,
  pipeline_watchdog2_memory, pipeline_watchdog2_audits, watchdog_github_etags), build-rules, claude-accounts
  (orgs, worker_state, workers), claude-badge, claude-handoff, claude-session, console-terminal (feeds, settings),
  feature-matrix, glossary-index (catalog, changes), host-services, molly-guide, phone-connect, plugin-manager,
  push-banner (done, failed, land, land_control, landing_line, merge_queue, merge_queue_control), systems-check
  (health_state, routine), todo-manager, token-control, ui-review, whats-shipped.
- 18 item families: `plugin_agent_memory`, `plugin_feature_matrices`, `plugin_todo_projects`, `agent_commands`,
  `home_cards`, `client_table_rows`, `phone_items`, `crew_chat_messages`, `plugin_ai_messages`, `plugin_ai_events`,
  `plugin_command_catalog`, `plugin_push_banner_gh_cache`, `plugin_maps`, `plugin_maintenance_plan_items`,
  `plugin_maintenance_profile_cleanups`, `plugin_container_access_items`, `build_profile_matrices`,
  `pipeline_accounts`.
- 5 one-row-per-key tables: `plugin_docs`, `console_docs`, `build_docs`, `ui_review_docs`, `session_inbox`.
- No table claims `orchestrator.json` (the pipeline status file) or a copy of it.

## Migration result

`node framework/cli/migrate-json-leftovers.mjs --dry-run` on the VPS, Nov 27 2026 06:25 UTC (run again after s1's last commit), exit 0, nothing refused.
`--check`: "cutover only, every local rule has its reason, every example maps as written".

| Namespace | Mode on the VPS today | Files | Rows |
|---|---|---|---|
| `builds` | local | 25 | 15 898 |
| `changes` | shadow | 2 641 | 2 641 |
| `console` | local | 203 | 324 354 |
| `phone` | local | 1 452 | 1 452 |
| `planner` | cutover | 279 | 290 |
| `sessions` | shadow | 11 987 | 11 987 |
| `settings` | shadow | 9 | 9 |
| `ui-review` | shadow | 150 | 150 |
| `plugins/*` (36 namespaces; `activity` and `skin-editor` local, the rest shadow) | | 405 | 6 423 |
| **Total (44 namespaces)** | | **17 151** | **363 204** |

The dry run counts from file sizes and line counts; contents are compared at `--apply` (copy, read back, switch,
compare once more, delete). Not applied in this step.

## The guard

`framework/spec/check-json-data-writes.mjs` (already in CI) is now a closed list instead of a ratchet with slack.

| | Before (main) | After |
|---|---|---|
| Baseline | 222 writes in 118 files | **11 writes in 8 files** |
| A file not in the baseline gains a write, or a count goes up | fails | fails |
| A count goes down and the baseline is not updated | passed ("N files below the baseline") | **fails**: the baseline must equal the code, so a removed write cannot come back inside the old count |
| Raising the baseline | `--update --allow-raise` | **no flag does it**: `--update` only lowers counts and drops files |
| Reason per kept file | none | **required** (`kept` in the baseline); a file without one fails, so does a wrong `total` |

Tried by hand: a new `writeFileSync(…JSON.stringify…)` in `framework/cli` fails the check and `--update` refuses it
(with or without `--allow-raise`); a baseline count raised by hand fails as "above the code".

The baseline file keeps its name, `framework/spec/json-data-writes.baseline.json` (CI, `plugin-lifecycle.mjs` and
DATA-STORE.md name it); format `json-data-writes-baseline@2` adds `kept`.

What the 11 are:

| File | Writes | Why it is kept |
|---|---|---|
| `build-orchestrator/pipeline.mjs` | 2 | pipeline folder: state documents and `log.jsonl`; owned by build `pipeline-fixes-drop-7-mb-status-file` |
| `build-orchestrator/watchdog/sessions.mjs` | 3 | pipeline folder: build watchdog state, settings, run request; same build |
| `build-orchestrator/groups.mjs` | 1 | pipeline folder: build-groups document; same build |
| `framework/cli/dispatch-gate.mjs` | 1 | pipeline folder: `dispatch.json`; same build |
| `build-orchestrator/orchestrator.mjs` | 1 | test seam `AXF_ORCH_FILE`; without it the state is the builds store |
| `framework/cli/builds-store.mjs` | 1 | local-file engine of the builds store (scratch stores in tests, a checkout with no axf-data) |
| `framework/cli/builds-data.mjs` | 1 | `builds-data.mjs local --apply`: operator command, journal back to files |
| `framework/cli/data-mode.mjs` | 1 | `data-mode.mjs rollback`: operator command, replay into local files |

When `pipeline-fixes-drop-7-mb-status-file` lands and removes its 7, this check fails with "the baseline is above the
code" until `node framework/spec/check-json-data-writes.mjs --update` is run and committed. That is the intended
behaviour and the fix is that one command.

## Test results, before and after

One runner, 238 test files on main and 240 on the merged build (two new checks): every `framework/spec/check-*.mjs`,
`services/axf-data/test_store.py`, every console server test and every plugin test (Python and Node). "Before" is
main `a26f2f9b3`; "after" is the merged build. The box was under load (load average 20–30), 7 minute timeout a test.

| | Before (main) | After (merged build) |
|---|---|---|
| Pass | 222 | 219 |
| Fail or timeout | 16 | 21 = 15 that fail the same way on main + **6 new** |
| Fixed by the build | | `framework/spec/check-build-limit.mjs` |
| `services/axf-data/test_store.py` | all ok | all ok |
| `services/axf-data/test_pg.py` (throwaway `postgres:16-alpine`) | all ok, 27 cases | all ok, 29 cases (incl. `test_watchdog_state_is_rows`) |
| `apps/console-web/server/test_data_store.py` | ok | ok (rewritten for the one-store model) |
| `check-data-store`, `check-builds-store-data`, `check-agent-slots-data`, `check-data-tables`, `check-data-migrate` | ok | ok (68, 16, 7, 5, 16 checks) |
| `check-migrate-json-leftovers`, `check-build-rules-data` | (new) | ok (8 checks; 5 checks) |
| `check-json-data-writes` | ok, 218 writes in 116 files against a 222 baseline | ok, 11 in 8, all kept with a reason |
| `check-tracking-files`, `project.mjs validate --all` | ok | ok |

**The 6 new failures (pass on main, fail on the merged build with no axf-data configured, which is what CI has):**

| Test | Cause |
|---|---|
| `plugins/claude-handoff/test.py` | the server reads `settings/claude-handoff-look.json` through `data_store`; the key is mapped, so it is axf-data only, and the test has none: `DataStoreError: axf-data isn't configured` |
| `plugins/notes-browser/test.py` | same, on `notes/…` (the Notes store reads and writes through `data_store`) |
| `plugins/phone-connect/test.py` | same, on `phone/pairings/…` |
| `plugins/agent-manager/test.py` | same, on the agent memory records. It passed until s3's follow-up `d84ea580c` moved the memory reads onto `data_store` (the right change: the writes were already there) |
| `plugins/plugin-manager/server/test_lazy.py` | `lazy.py` now does `import data_store`; the test loads the module by path without `apps/console-web/server` on `sys.path`: `ModuleNotFoundError` |
| `plugins/build-orchestrator/test.py` (1 check of the file: "a bare build id from the store") | the test hands `ConsoleFocus` a scratch `store.json`; the server's builds reader no longer has a file side (s4), so the id is not found |

One cause behind the first four: s3 ran its plugin tests on its own branch, where the path map was not yet
`cutover` (s2) and `data_store.py` still had a local side (s4). Together, a test whose scratch folder maps to a key
needs an axf-data. The fix is in the tests: run them against the in-process axf-data that
`apps/console-web/server/test_data_store.py` already sets up (FastAPI TestClient as the transport,
`data_store.set_remote(...)`), add the server folder to `sys.path` in `test_lazy.py`, and give the `ConsoleFocus`
test a scratch builds store the way `test_projects.py` now does. Not fixed in s7: the files belong to s3 and s4,
and s3 and s5 were running again on their branches at the time.

The full run was taken at s3 `02bcd6945`. s3 then pushed `d84ea580c` (eight plugins: reads, lists and removes follow
their writes). The tests of those eight plugins and the failing ones were run again on it: seven of the eight pass,
agent-manager is the sixth failure above, the guard and the tracking check still pass.

s1 then pushed `5db54a89c` (four build-watchdog documents as rows: `tables.py` and `test_pg.py` only). Run again on
it: the guard, `check-data-tables`, `check-data-store`, `check-data-migrate`, `check-migrate-json-leftovers`,
`check-builds-store-data`, `check-agent-slots-data`, `check-build-rules-data`, `check-tracking-files`,
`project.mjs validate --all`, `test_store.py`, `test_pg.py` on Postgres 16 and the dry run: all pass. The plugin
and console server tests were not run again for it (no plugin or server file changed).

The 15 that fail the same way on main (not touched by this build): `plugins/agent-swarm/test.mjs`,
`plugins/build-orchestrator/pipeline.test.mjs`, `plugins/console-commands/server/test_console_commands.py`,
`plugins/context-menu-designer/test.py`, `plugins/maintenance/test.py` (timeout at a real-disk scan),
`plugins/phone-connect/test_server.py`, `plugins/plugin-update/test.py`, `plugins/session-checkin/test.mjs`,
`plugins/shipped-features/test.mjs`, `plugins/shipped-features/test.py`, `server/test_wall_users.py`,
`framework/spec/check-agent-slots.mjs`, `check-build-hook.mjs`, `check-builds-store.mjs`,
`check-shipped-manifest.mjs`.

How the "after" numbers were taken, so they can be repeated: Node tests ran with `AXF_DATA_URL=off`. On this VPS
`framework/core/data-files.mjs` finds the live axf-data by itself (`/root/hub/data/axf-data/conf/env/host.env`), and
with every mapped path now Postgres-only a test whose scratch folder maps to a key would write to the live store.
Python tests ran with no `AXF_DATA_URL` (the Python layer does not know `off`; nine Python and Node tests that failed
only because of that setting pass without it, or fail the same way on main with it, and are counted as such).
A first "after" run had started without that switch and was stopped; axf-data's change feed for that window shows
only the orchestrator's own `builds/*` writes and change-log records, no test rows.

## Left, and why

- **`--apply` not run.** Live files are deleted by it; the order is in "Needs doing" above.
- **6 failing plugin tests** (above). CI on the build PR will be red on them until the tests get an in-process
  axf-data.
- **Tests can reach the live store on the VPS.** Node code with no `AXF_DATA_URL`, `AXF_DATA_DIR` or
  `AXF_BUILDS_STORE` set uses the host env file. Before this build that only mattered for the namespaces already cut
  over; now it is every mapped path. A test run on the VPS should set `AXF_DATA_URL=off` (or the tests should pass
  their own store). Not changed here: it is `framework/core/data-files.mjs` (s5) and each test.
- **The pipeline folder and the pipeline status file** (`builds/pipeline/…`, `_claude/builds/orchestrator.json`):
  7 writes in 4 files. Left alone on purpose; build `pipeline-fixes-drop-7-mb-status-file` removes them.
- **Two ways back to files are still in the code**: `builds-data.mjs local --apply` and `data-mode.mjs rollback`
  (with `rollback` in data-store-mode@1), plus the builds store's local-file engine in `builds-store.mjs`. They run
  only by hand or in scratch stores, not on the VPS path, but "no way back" is not literally true until they go.
  s2 left them because they are tied to `framework/core/data-store-mode.mjs` and the builds store's test seam.
- **Headless session spool** (`AXF_HEADLESS_DIR`: `events.jsonl`, `login-events.jsonl`, meters, token chains) has no
  table or path rule. Six readers outside `deploy/` (reaper, shipped, hand-build, the pipeline, pipeline2 and the
  watchdog) read `events.jsonl` straight from disk; it needs a table, a rule and those readers switched together.
- **Credentials stay files, by rule**: Claude login files, provider API keys (ai-keys, ai-assistant, chat-viewer
  `tts-keys.json`), the alerts ntfy token and VAPID key. Secrets never go in the data DB.
- **`claude-handoff` `loadChanges`** still walks the changes folder directly (the layer's list call returns direct
  children only).
- **Baked copies** under `apps/*/src/axf/core` still hold the old `data-files` code until the next bake.
- **Repo copies** of the plan, catalog, sessions and changes files stay tracked as exports and seeds. Nothing writes
  data into them at run time; whether to delete them from git is a separate call (fresh clones seed from them).
- **SQLite and media** (`chats.db`, `ledger.sqlite`, tts audio, screenshots) are not JSON and were not in scope; they
  move with `data-migrate.mjs`.
- 91 writes carry `axf-data: not data (<reason>)` on the line (53 in `framework/cli`, 18 in `deploy`, 20 in plugins):
  build-time generators of committed repo files, exports a caller names, caches, locks, temp inputs and test seams.
  They are grouped in DATA-INVENTORY.md → "JSON files that stay, and why".
