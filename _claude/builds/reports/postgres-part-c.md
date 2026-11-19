# Postgres part C: console state, settings, alerts and plugin data dirs to tables

Build `postgres-part-c-console-state-settings` · branch `claude/postgres-part-c-console-state-settings` · Phase 1 (Opus),
Nov 19 2026. Part of Brett's Nov 18 order ("I don't want any data stored in JSON period. Everything needs to be a Postgres
table."), split three ways the same day: part A (builds store, pending, queue, slots), part B (plan, catalog, sessions),
part C (this: inventory §3–§6 and §4 of `framework/spec/DATA-INVENTORY.md`).

This branch carries part A's branch (`claude/urgent-all-data-to-postgres-builds-store`, not merged yet): part C builds on
its key-level modes and its tables version 2. Whichever lands first, the other merges cleanly on top (part C only adds).

## Result

- **35 new tables and 7 new views** on axf-data's Postgres (tables version 5): every console and plugin document the
  inventory names has rows, not a JSONB blob (`services/axf-data/tables.py`; the views sit over the journal and keys
  rows).
- **One tool for every move**: `framework/cli/data-cut.mjs` with the groups in `framework/schemas/data-cut.json`:
  backfill (`copy`), verify, key-level cut-over of the entries whose writers all go through the data layer, `sync` for the
  rest, `local` to go back. Same verbs over REST, MCP, CLI and voice.
- **Writers moved onto the data layer** (so their keys can flip): the console server (state.json, alerts, home cards, app
  catalog), plugin-lifecycle, agent-swarm, the lander (push-banner land / merge-queue / server), gate-store's JSON
  documents, UI Review shots, and 8 Python plugins that used `axf_server.storage` (agent-manager, ai-assistant, activity,
  systems-check, todo-manager, whats-shipped, container-access, snapshot-manager).
- **Backfilled live** on the VPS (Nov 19, 00:50–01:45 UTC): 2 844 keys in the three groups; at the final read 2 814 were
  equal on axf-data, the other 30 were files written in the minutes between copy and read (the lander, the swarm, the
  alert hub, the shipped-features import that was running).
- **Not flipped yet, on purpose** (same reason as part A's s2): a writer on today's code reads the namespace mode, keeps
  writing the file, and the two sides would split. The flips run after this merges and the console + axf-data are
  redeployed (commands below).

## Tables

| Group | Table / view | From |
|---|---|---|
| console (s1) | `console_state` (one row per top-level key) | `state.json`, `host-check.json`, `nightly.json`, `update-status.json`, `project-wizard.json`, `alerts-run.json`, `alerts-config.json` |
| | `alerts`, `alerts_seen` | `alerts.json` (one row per alert, severity / ack / resolved lifted), `alerts-seen.json` |
| | `notifications`, `home_cards` | hub `_shared/_data/notifications/**`, `amberx-axf/_data/home-cards/*` |
| | `amberx_notes`, `amberx_note_lists` | hub-table@1 chunks `amberx-notes/{items,lists}/rows-*.json` (one row per item) |
| | `app_catalog` + `app_catalog_versions` | `_shared/_data/app-catalog/catalog.json` (apks stay files) |
| | views `console_deploys`, `token_log` | journals `console/deploys/log`, `console/token-log/**` |
| | `settings`, `notes`, `control_targets` / `control_tabs` (existing) | hub-settings, notes, control inventory |
| plugins-large (s2) | `swarm_runs`, `swarm_messages`, `swarm_notices`, `swarm_sections_said`, `swarm_jobs` (Markdown text) | agent-swarm |
| | `land_items`, `landing_line`, `merge_queue`, view `land_log` | push-banner lander |
| | `ui_review_screenshots`, `ui_review_predictions`, view `ui_review_shots` (images stay blobs) | UI Review |
| | `ledger_*` (existing mirror, refreshed on every upload), `chats_*` (mirror, hourly), view `chat_audio` | shipped-features, chat-viewer |
| plugins-rest (s3) | `agent_runs`, `agent_hub_runs`, `todo_items` + `todo_lists`, `health_checks`, `worker_accounts`, `terminal_feeds`, `assistant_usage`, `glossary_terms`, `shipped_feed`, `command_catalog` | the inventory's named plugin files |
| | `phone_devices`, `phone_pairings`, `phone_commands`, view `phone_log` | Phone Connect |
| | `plugin_settings` (catch-all: a plugin's top-level JSON documents, one row per key), `plugin_docs` (every nested plugin document, plugin + folder lifted), view `plugin_audit` (every plugin journal line) | everything else |

How the rows work: a body is claimed by the first table whose path rule and shape fit; anything that does not fit stays a
JSONB record (nothing coerced). Every body reads back byte-equal from its rows, so etags do not change. A database made
before a table existed moves the records that table now claims on the first connect (`tables.retable`, only when the rows
read back equal). A body that changes shape leaves its old table.

## Cut-over state per entry

`node framework/cli/data-cut.mjs groups` lists all 70 entries. `flip` = every writer goes through the data layer;
`sync` = a writer outside it remains and is named in `why`.

| Group | flip (cut over after deploy) | sync (kept equal hourly until its writer moves) |
|---|---|---|
| console | state.json, alerts.json, alerts-seen.json, alerts-run.json, alerts-config.json, home-cards/ | deploys log (installers), host-check (doctor.sh), nightly (host cron), update-status (installers), project-wizard, control inventory and app catalog (read from the hub files by axHub), settings / notifications / token log / AmberX notes (written through axHub's files API), notes (claude-sync) |
| plugins-large | shipped-features ledger.sqlite, agent-swarm runs / state / sections-said / job briefs / job reports, push-banner land / merge-queue / land-control / merge-queue-control / config / done / failed / auto-merge / protection, UI Review items.json | chats.db (683 MB, over the blob limit: rows by mirror_sync), chat audio (axHub), landing-line and lander-control (writer outside the console plugins), the lander journals, UI Review screenshots index and images |
| plugins-rest | todo-manager, whats-shipped feed + pr-files, systems-check health-state / settings / routine, claude-settings, Phone Connect devices / pairings / commands / aliases / log | systems-check whatsnew, agent-manager, ai-assistant, activity, claude-accounts, claude-handoff, console-terminal, glossary-index, maintenance, console-commands, plugin-commands, token-control, container-access, approvals-banner, gate, snapshot-manager, every other plugin |

The `sync` entries are the next steps, one writer at a time: each needs its plain file writes (Node `writeFileSync`, shell
scripts, axHub's files API) moved onto `data-files.mjs` / `data_store.py` and its directory listings onto
`list_files`; then its entry gets `flip: true`.

## After the merge (the session or automation that deploys it, not Brett)

```
sudo bash deploy/install-data.sh        # axf-data on this code: tables v5 are created, retable moves the records
                                        # into rows; the new cron lines (hourly sync, hourly chats mirror) installed
# console redeploy (its writers then read key-level modes)
set -a; . /root/hub/data/axf-data/conf/env/cli.env; set +a
export AXF_DATA_URL=http://172.16.7.250:7700
cd /opt/axf
node framework/cli/data-cut.mjs cutover console --apply
node framework/cli/data-cut.mjs cutover plugins-large --apply
node framework/cli/data-cut.mjs cutover plugins-rest --apply
node framework/cli/data-cut.mjs status --all                # every flip entry `cutover`, rows per table shown
```

A cutover refuses to flip anything in a group while any key differs (a busy writer: run it again), waits for writers
to see the mode, and pushes any write that landed on the file in between. `data-cut local <group> --apply` goes back.
Part A's flip (`builds-data.mjs cutover --apply`) is independent of these.

## API parity

| Surface | How |
|---|---|
| REST | `GET /api/plugins/data-store/cuts?group=`, `POST /api/plugins/data-store/cut {group, action, apply?, noFlip?}`; `GET …/tables` shows every new table |
| MCP | data-store plugin commands `cuts` (read-only) and `cut` (destructive, asks to confirm); `tables` |
| CLI | `axf data cut [groups\|status\|copy\|verify\|cutover\|sync\|local] [<group>…] [--apply] [--no-flip]` (= `node framework/cli/data-cut.mjs`) |
| Voice (AmberX) | "what's left to cut over", "backfill the console group", "verify the console keys", "cut the console state over" (moves ask first) |

No UI changed, so nothing went to UI Review. The Data store tab's state already lists namespaces and modes; the cut
groups are read through the routes above.

## Tests

| Check | Result |
|---|---|
| `python3 services/axf-data/test_pg.py` (postgres:16): new `test_console_state_tables`, `test_plugin_tables_s2`, `test_plugin_tables_s3` (every table, every view, read-back equality, shape changes, retable for records and text blobs) plus the existing suite | 26 of 28 ok on this host; the 2 others are load-sensitive: the 1 064-build live round trip missed its 30 s budget at load 67, and the Node contract replay hit the file backend's watch-timing step, which also flaked once standalone and passed on rerun |
| `python3 services/axf-data/test_store.py` | 14 ok |
| `node framework/spec/check-data-cut.mjs` (new, in CI): schema, ownership, dry run, backfill, verify, flip only flip entries, write after flip lands on axf-data, sync, back to local | 8 ok |
| `check-data-store` 68 · `check-data-migrate` 16 · `check-builds-store-data` 9 · `check-data-store-mode` · `check-auto-lander` 27 · `check-landing-line` 32 | ok |
| console server: `test_alerts`, `test_app_catalog`, `test_data_store` | ok |
| plugins: data-store 37, push-banner 194, lander 122, merge queue 18, agent-swarm 109, gate 21 + 55, ui-review 229 + toolbar, phone-connect 244, activity 142, systems-check 231, todo-manager 61, whats-shipped 47, snapshot-manager 49, notify-control 133 | ok |
| agent-manager, ai-assistant, container-access tests | fail identically with and without this change (environment: repo auto-training, chat folder removal, a temp framework copy); not caused here |
| console-terminal | its swap was reverted (tmux scrollback test failed under load; the plugin stays `sync` anyway) |
| per-namespace counts, live | console 73 keys / 68 equal, plugins-large 2 352 / 2 347, plugins-rest 419 / 399 at the final read (30 written since the copy) |

## Findings

- Plugin data folders hold hundreds of orphan `*.tmp-<pid>` files (push-banner 340+, agent-swarm dozens, activity
  reports) from killed writers; the map now keeps them local and the scan skips them. Deleting them is a cleanup for the
  maintenance plugin.
- `chat-viewer/tts/` is a Python venv and voice models (the inventory counted it as 3 434 audio blobs): it stays local.
- `push-banner/gh-cache.json` (48 MB) is a GitHub response cache, not data: it stays local and rebuilds itself.
- `phone/log` was never reaching axf-data: neither client treated it as a journal and the phone namespace refuses blobs.
  Fixed in both clients.
- `gate/history.jsonl` is rewritten whole by `writeHistory`; a journal on axf-data is append-only, so it cannot move until
  the gate appends instead.
