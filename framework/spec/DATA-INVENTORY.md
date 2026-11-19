# DATA-INVENTORY — every JSON/JSONL data file and file-backed namespace, and its Postgres table

Status: inventory, Phase 1 step s1 of build `urgent-all-data-to-postgres-builds-store` (Opus, Nov 18 2026).
Rule it serves (Brett, Nov 18 2026): "I don't want any data stored in JSON period. Everything needs to be a Postgres
table." Steps s2–s4 move the rows below; s5 writes the rule into CLAUDE.md and DATA-STORE.md and adds the CI check.

Taken live on the VPS on Nov 18 2026 from: the live checkout `/opt/axf` (`_claude/`, `framework/plan`, `.axf-console/`),
axHub's volume `/projects/*/_data` and `/projects/_shared`, and the `axfdata` database in `axf-data-db` (postgres:16).

## Where things stand

- `axf-data` runs on Postgres (`axf-data-db`). Its engine is in **shadow** mode since Nov 17 (`engine.json`:
  `mode: shadow`, 1 760 drift entries, last Nov 18 18:07). Every client still writes its files first; axf-data gets a
  copy. Nothing is cut over.
- Almost everything axf-data holds sits in the generic `records` table (`ns, path, data jsonb, body bytea`) or `blobs`.
  That is a JSON blob in a database, not a table. Only six documents are shredded into real tables
  (`services/axf-data/tables.py` → `TABLES`): `builds` + `build_steps` (from `builds/store.json`), `ui_review_items`,
  `control_targets` + `control_tabs`, `settings`, `planner_items`, `notes`. Journals go to `journal`; SQLite ledgers are
  mirrored into `ledger_*` (shipped-features) and `chats` (chat-viewer).
- The builds store is still the file `/opt/axf/_claude/builds/store.json` (14.6 MB) with `store.json.lock`, a
  `live-outbox.jsonl.lock`, and **106 orphan `store.json.tmp-*` files** (Nov 9 – Nov 17) left by killed writers. That
  lock is what makes console writes fail with "builds store is locked".
- `builds` (985 rows) and `build_steps` (5 951) already exist, but as a mirror of the file. s2 makes them the source.
- **s2 done (Nov 18 2026, Fable)**: `builds` rows are keyed by the build id, `build_steps` and the new `build_notes` hang
  under it, `journal` holds every journal line (view `build_journal`); `builds-store.mjs` writes a row-level `patch`
  (data-patch@1, `SELECT … FOR UPDATE` on the touched builds only) and the two keys `builds/store.json` and
  `builds/journal/` run in `cutover` (key-level modes, data-store-mode@1 `keys`). The cut, with its counts, is
  `node framework/cli/builds-data.mjs cutover --apply`; `builds-data.mjs status` shows both sides. The file-lock path
  (`store.json.lock`, the `tmp-*` files) is no longer in use for the store; s3 removes the leftovers.

Row counts below are live `keys` rows in axf-data (not deleted); sizes are the stored bodies.

## Legend

- **Owner**: the plugin or module that defines the data's shape.
- **Writer**: what writes it today (file first, axf-data shadow copy second).
- **Target**: the Postgres table it lands in. `(new)` = table to create. `(exists)` = already shredded by `tables.py`.
- **Step**: s2/s3 = builds (Fable / Opus), s4.x = one namespace per sub-step in the order listed in "Order for s4".
- **Stays a file**: source in the repo (asset@1 assets, schemas, plugin.json, docs), binary media, git worktrees,
  secrets. These are not data and keep their place; binary media goes to `blobs` (bytea) with a metadata row.

## 1. Builds (s2, s3) — repo `_claude/builds/`, hub `amberx-axf/_data/{builds,pipeline,build-orchestrator,build-rules}`

| Source | Size / count | Owner | Writer | Target |
|---|---|---|---|---|
| `_claude/builds/store.json` (builds@1: every build, its steps, notes, approvals, upgradeRequests, pipeline) | 14.6 MB file; 985 builds / 5 951 steps | build-orchestrator | `framework/cli/builds-store.mjs` (CLI, orchestrator.mjs, builds-live.mjs), console `apps/console-web/plugins/build-orchestrator/server` | `builds`, `build_steps` (exists, become source); `build_notes`, `build_approvals`, `build_upgrades`, `build_pipeline` (new, lifted out of `builds.extra`) |
| `_claude/builds/store.json.lock`, `.live-outbox.jsonl.lock`, `store.json.tmp-*` (106) | 0 B – 3.9 MB each | builds-store.mjs | builds-store.mjs (file lock + atomic rename) | none: row-level locks (`SELECT … FOR UPDATE`) replace them; tmp files deleted in s3 |
| `_claude/builds/store.json.live.json`, `.live-outbox.jsonl` | 230 B; journal 185 kB | builds-live.mjs | builds-live.mjs | `build_live_outbox` (new) |
| `_claude/builds/store.json.exports.json` | 1.5 kB | builds-store.mjs | builds-store.mjs | none: exports are generated from the tables (s3) |
| `_claude/builds/journal/<yyyy-mm>.jsonl` | 59 MB repo; hub `_data/builds/journal` 1.6 GB; axf-data 13 journals 338 MB + `journal-large` 524 records 1.2 GB | builds-store.mjs | builds-store.mjs (append per write) | `build_journal` (new; one row per event: build id, at, by, op, diff jsonb) |
| `_claude/builds/orchestrator.json` | 7.6 MB | build-orchestrator | builds-store.mjs export, builds-live.mjs | none: read-only export from `builds` (s3), or dropped if no reader |
| `_claude/builds/origins.json` | 3.2 MB | builds-store.mjs | builds-store.mjs, builds-live.mjs | `build_origins` (new) |
| `_claude/builds/shipped/<id>.json` | 398 | build-orchestrator | builds-store.mjs on landing | `build_shipped` (new) — also the index for the duplicate / break check (Brett's Nov 18 note: search by feature, files, plugin, title words) |
| `_claude/builds/advice.json`, `bugs.json`, `matrices.json` | 595 kB, 7 kB, 76 kB | build-orchestrator | orchestrator.mjs | `build_advice`, `build_bugs`, `build_matrices` (new) |
| `_claude/builds/profiles/all/*.json` | 76 kB | profiles.mjs | profiles.mjs | `build_profiles` (new) |
| `_claude/builds/build-rules/*.json`; hub `_data/build-rules/store.json`, `history.jsonl`, `runs.jsonl` | 11 MB | build-rules (console) | build-orchestrator server | `build_rules`, `build_rule_runs`, `build_rule_history` (new) |
| `_claude/builds/reports/**/*.json` (+ md, png) | 18 records, 689 blobs | each build | build sessions | md/png stay files (docs/media); the json in them → `build_report_items` (new) |
| hub `_data/builds/reconcile.json` + `reconcile/*` journals | 20 MB + 326 MB | builds-reconcile.mjs | builds-reconcile.mjs | `build_reconcile` (new) |
| hub `_data/builds/worktrees/` | 2.9 GB | git | worktree-setup.mjs | stays: git worktrees, not data |
| hub `_data/pipeline/{dispatch,state,watchdog,build-watchdog}.json`, `log.jsonl`, `molly/` | 14 MB | build-orchestrator pipeline | `apps/console-web/plugins/build-orchestrator/pipeline.mjs` | `pipeline_state` (new, one row per key), `pipeline_log` (new) |
| hub `_data/build-orchestrator/*` (dup-check) | 12 kB | build-orchestrator | orchestrator.mjs | `build_dup_checks` (new) |
| hub `_data/_claude/builds/` | 2 MB, 3 files | claude-sync | claude-sync | goes away once builds are tables (it is a synced copy) |
| `plugins/build-orchestrator/merge-review.json` | 714 kB | build-orchestrator | build-orchestrator server | `build_merge_reviews` (new) |

## 2. Shared plan data — root manifest `data.shared` (repo copy + hub `_data/<same path>`)

| Source | Size | Owner | Writer | Target | Step |
|---|---|---|---|---|---|
| `framework/plan/pending.json` | 1.4 MB | pending list | `framework/cli/pending.mjs` via `persist.mjs` | `pending_items` (new) | s4.1 |
| `framework/plan/build-queue.json` | 68 kB | build queue | `framework/cli/build-queue.mjs` via `persist.mjs` | `queue_items` (new) | s4.1 |
| `framework/plan/plan.json` | 520 kB | plan@1 | `framework/cli/plan.mjs`, build-priority.mjs | `plan_items` (new) | s4.2 |
| `framework/plan/profiles.json`, `projects.json` | 4 kB each | profiles.mjs | profiles.mjs | `plan_profiles`, `projects` (new) | s4.2 |
| `framework/plan/media/` | 1.1 MB | plan media | plan.mjs | `blobs` + `plan_media` metadata rows | s4.2 |
| `framework/catalog/status.json` | 64 kB | feature catalog | tracker.mjs, `framework/core/catalog.ts` | `catalog_features` (new) | s4.3 |
| `framework/catalog/libraries.json` | 60 kB | libraries index | plugins.mjs | `catalog_libraries` (new) | s4.3 |
| `tracker.json` (repo + hub `_data/tracker.json`) | 160 kB | tracker.mjs | tracker.mjs, engine-rpc.mjs | none: generated view over `catalog_features` | s4.3 |
| `framework/schemas/project-rules.json` | 8 kB | project rules | console Build rules | `project_rules` (new) | s4.3 |
| `sessions/` (repo) + hub `_data/sessions/archive`, `archive-inbox` | 4.2 MB repo; 5 703 records | session@1 | claude-sync, chat archiver | `sessions` (new), `session_messages` (new) | s4.6 |
| `changes/` (repo) + hub `_data/changes/<yyyy>/<mm>/<id>.json` | 9.7 MB repo; 1 962 records; `changes` table already 16 803 rows | codebase-changes | `apps/console-web/plugins/codebase-changes/changes-core.mjs` | `changes` (exists as a change-feed; rename the codebase log to `codebase_changes`, new) | s4.6 |
| hub `_data/plan-studio/**` (history, plans, projects, categories, deleted, blueprints, catalog-seen) + `shipped-log.jsonl` | 275 files, 7.4 MB | plan-studio | plan-studio server | `planner_items` (exists, plans only); `planner_history`, `planner_categories`, `planner_shipped` (new) | s4.2 |
| hub `_data/plan-studio-2/tree.json` | 8 kB | plan-studio | plan-studio server | `planner_tree` (new) | s4.2 |
| hub `_data/framework/{catalog,plan,schemas}` | 14 MB | persist.mjs | persist.mjs (hub copies of the above) | goes away: same rows as above | s4.1–s4.3 |
| hub `_data/project.manifest.json`, `/projects/<p>/_data/project.manifest.json` (21 projects) | ~0.5–1.5 kB each | project wizard | console projects | `projects` (new; one row per project) | s4.2 |

## 3. Console state — `/opt/axf/.axf-console/` (dirname of `AXF_STATE`)

| Source | Size | Owner | Writer | Target | Step |
|---|---|---|---|---|---|
| `state.json` | 80 kB | console server | `apps/console-web/server/main.py` | `console_state` (new; key/value rows per setting) | s4.4 |
| `deploys/log.jsonl` | 100 kB | console deploy | console server | `console_deploys` (new) | s4.4 |
| `alerts.json`, `alerts-seen.json`, `alerts-run.json` | 400 kB | systems-check / alerts | console server | `alerts`, `alerts_seen` (new) | s4.4 |
| `host-check.json`, `nightly.json`, `update-status.json`, `project-wizard.json` | < 4 kB each | console server | console server | `console_state` | s4.4 |
| `build-live/`, `build-progress/`, `build-hooks/` (19 MB) | | builds-live / build hooks | builds-live.mjs, hooks | `build_live_outbox`, `build_progress`, `build_hook_runs` (new) | s3 |
| `main-gate/`, `console-control/`, `previews/`, `wall`, `github-app/`, `app-apks/` | < 100 kB each | console | console server | `console_state` (or one table each if they have rows) | s4.4 |
| `data-store/` (local file backend, mode.json) | 5 MB | data-store@1 | `framework/core/data-store.mjs` | goes away at cut-over (`to: null` already) | s3 |
| `migration/` | 1.5 GB | data-migrate.mjs | data-migrate.mjs | goes away after verify (migration staging) | s5 |
| `plugin-backups/` | 78 MB | plugin-manager | plugin-lifecycle | stays (tar archives) → `blobs` later | — |
| `secrets.env`, `env`, `alerts-vapid.pem`, `wall-secret`, `expenses-api-token`, `android-signing/` | | deploy | deploy | stays: secrets never go in the data DB | — |

## 4. Plugin data dirs — `.axf-console/plugins/<folder>/` (plugin-lifecycle@1 `dataDir`, 23 GB, 370 k files)

One table family per plugin, named `<folder>_<thing>` (dashes → underscores). Small single-object config files
(`settings.json`, `config.json`, `state.json` under 1 kB) go to one shared `plugin_settings` table
(`plugin, key, value jsonb, rev, at, by`) instead of a table each. Audit `*.jsonl` go to one `plugin_audit` table
(`plugin, at, by, action, detail jsonb`). Step s4.5 unless noted.

| Folder | Files (axf-data keys) | Target |
|---|---|---|
| agent-swarm | `runs.json` 820 kB, `state.json` 592 kB, `sections-said.json` 89 kB, `job-briefs/*` 52, `job-reports/*` 41; `job-worktrees/` (21.8 GB) | `swarm_runs`, `swarm_state`, `swarm_sections_said`, `swarm_jobs` (brief + report md as text); worktrees stay (git) |
| chat-viewer | `chats.db` SQLite (1.2 GB) + `tts/*` 3 434 blobs (310 MB) | `chats` mirror becomes the source (drop SQLite); tts audio → `blobs` + `chat_tts` rows |
| ui-review | `items.json` 553 kB, `option-assets/*` 130, `predictions/*` 7, `screenshots/`, `shots/` (1 984 blobs, 267 MB) | `ui_review_items` (exists); `ui_review_option_assets`, `ui_review_predictions` (new); images → `blobs` + rows |
| push-banner | `gh-cache.json` 29 MB, `land.json` 140 kB, `merge-queue.json`, `landing-line.json`, `land-control.json`, `auto-merge/done/failed/protection/config.json`, `land-runs/land-batches/gate-log.jsonl` | `gh_cache`, `land_runs`, `land_batches`, `merge_queue`, `landing_line`; controls → `plugin_settings`; gate log → `plugin_audit` |
| shipped-features | `ledger.sqlite` 207 MB | `ledger_*` mirror (exists, 12 tables) becomes the source; drop SQLite |
| agent-manager | `agents, personas, skills, tools, runs, hub-runs, lingo, training, workflows, addons(.json)`, `memory/*` 2 MB | `agent_defs`, `agent_personas`, `agent_skills`, `agent_tools`, `agent_runs`, `agent_memory`, `agent_workflows` |
| ai-assistant | `conversations/*` 32, `sessions/*` 31, `usage.json`, `config.json` | `assistant_conversations`, `assistant_messages`, `assistant_usage`; config → `plugin_settings` |
| activity | `reports/*` 72, `hooks/*`, `seen/dismissed/continued.json` | `activity_reports`, `activity_seen` |
| systems-check | `health-state.json` 111 kB, `whatsnew/*` 200, `routine.json`, `whatsnew-seen.json`, `settings.json` | `health_checks`, `whatsnew_items`, `whatsnew_seen`; settings → `plugin_settings` |
| glossary-index | `catalog.json` 2.2 MB, `changes.json`, `clip`, `demonstration` | `glossary_terms`, `glossary_changes` |
| whats-shipped | `feed.json` 234 kB, `pr-files.json` 186 kB | `shipped_feed`, `shipped_pr_files` |
| maintenance | `plans/*`, `snapshot.json`, `profile-cleanup`, `held.json`, `state.json` | `maintenance_plans`, `maintenance_held`; state → `plugin_settings` |
| claude-accounts | `workers.json`, `worker-state.json`, `orgs.json`, `seen.json` | `worker_accounts` (new; the worker accounts Brett named), `worker_orgs` |
| claude-handoff | `last-assembly.json`, `preview/*`, `session.json/.md`, `machines`, `state.json` | `handoff_runs`, `handoff_machines`; hub `_shared/_data/handoff/` (61 files) joins `handoff_runs` |
| console-terminal | `feeds.json`, `sessions.jsonl`, `settings.json`, `ssh/` | `terminal_feeds`, `terminal_sessions`; ssh keys stay (secrets) |
| console-commands, plugin-commands, token-control | `catalog-owner.json` 121 kB, `audit.jsonl` (404 kB, 520 kB), `passes.json`, `salt` | `command_catalog`, `token_passes`, `plugin_audit`; `salt` stays (secret) |
| container-access, claude-settings, approvals-banner, gate | `audit.jsonl`, `batches`, `relay.jsonl`, `history.jsonl` 1.1 MB, `behind.json` | `plugin_audit`, `container_batches`, `approval_relay`, `gate_history` |
| phone-connect | `devices/*`, `pairings/*`, `commands/*`, `log.jsonl`, `aliases.json`, `recorder` | `phone_devices`, `phone_pairings`, `phone_commands`, `phone_log`, `phone_aliases` |
| todo-manager | `store.json`, `projects/*` | `todo_items`, `todo_projects` |
| demonstration-designer, molly, molly-guide, plan-studio (local), snapshot-manager, brand-library, follow-amber, agent-voice, wake-listener, claude-badge, claude-session, output-recorder, plugin-manager, skin-editor, github-app, auto-browser, ai-keys | each < 15 kB | `plugin_settings` rows, except `snapshot_manager` snaps → `snapshots` and `ai-keys/keys.json` / `auto-browser/host-token` (secrets: stay out of the DB, move to env / axHub keys) |

## 5. Hub console data — `/projects/amberx-axf/_data/` (namespace `console/*`)

| Source | Size | Owner | Writer | Target | Step |
|---|---|---|---|---|---|
| `agent-slots/` (`state.json` 29 kB, `live.json`, `settings.json`, `build-limit*.json`, `build-limit.log.jsonl`, `reaper.jsonl`, `reaper-state.json`, `runs/`, `state.lock`) | 39 files, 284 kB | agent-slots | `framework/cli/agent-slots.mjs`, reaper.mjs, build-limit.mjs, dispatch-gate.mjs | `agent_slots`, `agent_slot_runs`, `reaper_log`, `build_limit`; lock → row locks | s4.1 (contended like builds) |
| `auto-lander/` (`state.json`, `control.json`, `service.json`, `attempts/`) | 13 files, 188 kB | auto-lander | build-engine.mjs, reaper.mjs | `lander_attempts`, `lander_state` | s4.1 |
| `agent-swarm/chats` | 712 kB | agent-swarm | agent-swarm server | `swarm_chats` | s4.5 |
| `agents/`, `companion/`, `walkthrough/`, `listeners/devices` | < 20 kB each | console | console server | `agents`, `companion_chats`, `walkthrough_voice`, `listener_devices` | s4.4 |
| `amberx-notes/items`, `lists` | 108 kB | amberx-notes | AmberX app via console | `amberx_notes`, `amberx_note_lists` | s4.4 |
| `home-cards/` | 8 kB | console home | `apps/console-web/server/main.py` | `home_cards` | s4.4 |
| `token-log/2026/*` | 24 kB | token-control | console server | `token_log` | s4.4 |
| `chat-viewer/audio` | 2.3 MB | chat-viewer | chat-viewer server | `blobs` + `chat_audio` | s4.5 |
| `control/inventory.json` | 348 kB | console-control@1 | console server | `control_targets`, `control_tabs` (exist, 0 rows: not yet written through) | s4.4 |
| `.axf-console/`, `.legacy-copied` | 104 kB | data-migrate | data-migrate | goes away | s5 |

## 6. Shared hub data — `/projects/_shared/`

| Source | Size | Owner | Writer | Target | Step |
|---|---|---|---|---|---|
| `_data/settings/**` (`appearance.json`, `apps/*`, `looks/*`) | 8 files | hub-settings@1 | console Settings, AmberX | `settings` (exists, 9 rows) — becomes the source | s4.4 |
| `_data/claude/settings.json`, `views.json` | 12 kB | claude-settings | console | `settings` | s4.4 |
| `_data/handoff/index.json`, `runs/*` | 61 files, 924 kB | claude-handoff | handoff.mjs | `handoff_runs` | s4.5 |
| `_data/notifications/inbox/*` | 4 | notifications | console, AmberX push | `notifications` | s4.4 |
| `_data/app-catalog/catalog.json` | small + 694 MB apks | app catalog | release scripts | `app_catalog` rows; apks stay files | s4.4 |
| `_data/dns/log.md`, `quick-docs.md` | | docs | sessions | stay: Markdown documents (→ `notes`) |
| `_claude/notes/**`, `memory/`, `rules/`, `instructions/`, `project-notes/` | 40 files | notes | Notes plugin, claude-sync | `notes` (exists, 40 rows) — becomes the source; repo `_claude/` copies are synced docs |

## 7. Repo `_claude/` outside builds

| Source | Owner | Target |
|---|---|---|
| `_claude/handoff/*.json`, `handoff/context/*.json`, `handoff/sources/*.json`, `handoff/user/console/*.json` | claude-handoff | `handoff_runs` (s4.5); the repo copies go away |
| `_claude/memory/docs/**/shots/*.json`, `ui-review/*/*.json` (≈ 25 shot manifests) | ui-review screenshots | `ui_review_items` / shot rows (s4.5); the png stay docs |
| `_claude/memory`, `rules`, `instructions`, `plans`, `persona.md`, `THREADS.md` (Markdown) | sessions | stay: documents, not data |

## 8. Other projects — `/projects/<name>/_data/`

Every other project (20) holds only `project.manifest.json` → `projects` table (s4.2). No other data today; the
catch-all rule `^<project>/_data/(.+)$ → console/projects/{1}/{2}` stays until a project adds data, which then gets a
table through the same rule.

## s3 and s4.1 (Nov 19 2026, Opus)

- **s3**: the cut code is in (`DATA-STORE.md` → "After the flip"): no file lock or file write on the store in cutover,
  builds main holds newer are adopted into the tables (writers from before the cut), the console checkout's `store.json`
  and orchestrator exports are a read-only projection of the tables, `builds-data.mjs clean` for the leftovers (the 106
  `tmp-*` files were already gone on Nov 19). `pending.json` / `build-queue.json` stay as exports of the builds record
  (still read by pending.mjs, build-queue.mjs, console views), so the pending list and the queue live in the builds tables
  with the store. The flip itself (`builds-data.mjs cutover --apply --store /opt/axf/_claude/builds/store.json`) runs
  once this code is on main and `/opt/axf` runs it: main's copy has no projection yet.
- **s4.1**: agent-slots → table `agent_slots` (one row per entry, section = `running` / `queue` / `heavy` / `done`;
  `seq`, guard trips, swap and hosts in `store_heads`). `agent-slots.mjs` follows the key mode of
  `console/agent-slots/state.json`: cutover replaces the mkdir lock with a rev check (read with etag, change, put
  if-match, re-read on conflict). The cut: `agent-slots.mjs data status | cutover [--apply] | local [--apply]`, under the
  mkdir lock. Check: `framework/spec/check-agent-slots-data.mjs`. The flip waits until every worktree that runs
  `agent-slots.mjs` has this code (each runs its own copy; an older one would keep the file and split the throttle).
  `settings.json`, `live.json`, `build-limit*.json`, `runs/`, the reaper logs: next, same pattern.
- **auto-lander** (`_data/auto-lander/*`) is not a data-store@1 path yet (`keyFor` → null): it needs a path rule in
  `framework/schemas/data-store.json` before it can move. Left for the contract step (Fable), with Part C's plugin dirs.

## Order for s4 (one namespace per sub-step, each: create table, backfill, verify counts + manifest hash, cut over)

1. **s4.1** pending, build queue, agent-slots, auto-lander (contended by every launch; same lock problem as builds).
2. **s4.2** plan, plan-studio, profiles, projects, plan media.
3. **s4.3** catalog status, libraries, project rules; tracker.json becomes a generated view.
4. **s4.4** console state, settings, alerts, notifications, home cards, token log, notes, control inventory, app catalog.
5. **s4.5** plugin data dirs (largest folders first: chat-viewer SQLite → `chats`, shipped-features SQLite → `ledger_*`,
   push-banner, agent-swarm, ui-review), then the small ones into `plugin_settings` / `plugin_audit`.
6. **s4.6** sessions, codebase changes (largest row counts, append-only, least contended).

s4 is ~2–3 h of work as listed; the orchestrator should split it into one step per line above (each ≤ 30 min).

## Not data (stays where it is)

Asset@1 assets, `framework/schemas/*.json` (contracts), `plugin.json` manifests, `project.manifest.json` in the repo,
`framework/spec/fixtures/*.json` (test fixtures), `package.json` / lockfiles, docs and reports (Markdown, png), git
worktrees, plugin backups (tar), APKs, and every secret (`secrets.env`, tokens, salts, ssh keys, VAPID and signing
keys). Secrets in particular never move into `axfdata`.

## Findings to act on

- 106 orphan `store.json.tmp-*` files next to the live builds store (s3 deletes them with the file lock path).
- axf-data has been in shadow mode for 36 h with 1 760 drift entries; s2/s3 must read the drift log for `builds/*`
  before the cut-over so no write is lost.
- `control_targets` / `control_tabs` exist with 0 rows: the console still only writes the JSON file.
- `.axf-console/migration/` (1.5 GB) and hub `_data/builds/journal` (1.6 GB) are copies of the builds journal; after
  `build_journal` is verified they are deleted (deleting hub files is a veto call).
