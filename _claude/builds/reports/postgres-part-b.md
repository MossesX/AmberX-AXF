# postgres-part-b — plan, Plan Studio, catalog, sessions and changes to tables

Opus, Nov 19 2026. Brett (Nov 18): "I don't want any data stored in JSON period. Everything needs to be a Postgres
table." Steps s4.2, s4.3 and s4.6 of `framework/spec/DATA-INVENTORY.md`.

## Result

Every plan, Plan Studio, catalog, session and change document is now rows in real Postgres tables on axf-data, checked
against the hub files count for count. **Plan Studio (`planner`) runs on Postgres only.** The plan/catalog files in the
`console` namespace and the session / change archives are copied and verified but still written as files first, for
the reasons under "Not cut over yet".

## Tables (services/axf-data/tables.py, version 3)

| Table | Holds | Live rows (Nov 19 02:35 UTC) |
|---|---|---|
| `plan_items` | plan@1 features of `framework/plan/plan.json` and every profile copy, one row per feature (+ the statuses list) | 1 023 |
| `plan_profiles` | build profiles (`profiles.json`) | 2 |
| `plan_projects` | `framework/plan/projects.json` | 1 |
| `projects` | every `project.manifest.json` (this repo + each `/projects/<name>`) | 22 |
| `plan_media` (+ `blobs`) | plan media metadata; bytes stay content-addressed in `blobs` | 9 |
| `planner_items` | Plan Studio plans (existed) | 10 |
| `planner_history` | one row per saved plan version | 893 |
| `planner_categories` | category paths | 92 |
| `planner_lists` | deleted ids, catalog-seen keys, blueprints | 388 |
| `planner_tree` | Plan Studio 2 tree nodes (new mapping `plan-studio-2/* → planner/v2/*`) | 5 |
| view `planner_shipped` | the shipped log (journal rows) | 10 |
| `catalog_features` | feature catalog `status.json` (a map document: one row per feature id) and profile copies | 466 |
| `catalog_libraries` | libraries index | 23 |
| `project_rules` | project manifest rules + known keys | 39 |
| view `tracker` | the tracker status board over `catalog_features`; `tracker.json` is generated, mapped `to: null`, its old copy dropped | — |
| `sessions` + `session_messages` | archived sessions (one row each) and their prompts (one row each) | 7 124 / 8 057 |
| `codebase_changes` | change-log@1 entries | 2 252 |

Shapes: `ItemsTable` (a document's lists → rows keyed `(ns, path, list, pos)`, `rid` = item key, lifted typed columns,
the rest in `extra`, only changed rows rewritten), `HeadItemsTable` (same, the head is a row of its own table:
`sessions`), `MediaTable` (bytes in `blobs` + one metadata row). Every document reads back byte-equal (canonical).

## Backfill and verify

- **On axf-data**: keys stored before their table existed move in by themselves (`PgStore.backfill`, a background
  thread, one key per transaction under the store lock, byte-equal check per key; report in `GET /v1/_meta/tables` →
  `backfill`). Live: 301 keys (plan + catalog), then 7 641 (sessions + changes, 5.5 min, API answering), **0 failed**.
- **From the hub files**: `node framework/cli/data-tables.mjs backfill <plan|catalog|sessions> --apply` wrote 9 + 2 +
  1 726 files axf-data lacked or held stale (shadow had missed them: their writers bypass data-files).
- **Counts**: `node framework/cli/data-tables.mjs status all` compares every file with its key and every table's rows
  with what the files give. plan and catalog: all equal. sessions: equal at the copy; new sessions written since show
  as a small difference until the writers move (see below).

## Cut over

- `planner` → **cutover** (Nov 19 01:56 UTC, data-mode's own checks: manifests equal, no drift, snapshot
  `m-20261119015621-1ac946ec`). The console read Plan Studio categories back through `data_store.py` right after.
- `planner/v2/` (Plan Studio 2's tree) held on the files by a key-level override: the live `tree.mjs` writes the file
  directly; this branch routes it through data-files. Both old and new code keep using the file until `--keys`.

## Not cut over yet (and why)

1. **`console` keys** (plan.json, profiles, projects.json, media, manifests, status.json, libraries.json,
   project-rules.json) and `planner/v2/`: they need the host token's grant (this PR, see "What broke") and, for the
   tree, main's `tree.mjs` going through data-files. The console itself already runs main with key-level modes. Then:
   `node framework/cli/data-tables.mjs cutover plan --apply --keys && node framework/cli/data-tables.mjs cutover catalog --apply --keys`
   (host env: `set -a; . /root/hub/data/axf-data/conf/env/cli.env; set +a; AXF_DATA_URL=http://172.16.7.250:7700`).
2. **`sessions`, `changes`**: `apps/console-web/plugins/codebase-changes/changes-core.mjs` (`ChangeStore.put`) and
   the session archiver write the hub files themselves. In cutover they would write files nobody reads. The tool
   refuses this flip (`flipBlocked`) until they go through `framework/core/data-files.mjs`; until then
   `data-tables.mjs backfill sessions --apply` brings axf-data current.

## What broke on the way

- **axf-data stalled for ~10 min (01:39–01:49 UTC)**: a backup I started (`POST /v1/_meta/backup`, pg_dump) held a
  share lock on `blobs`/ledger tables; a SQLite ledger mirror then waited for `TRUNCATE`/`ALTER` while holding the
  store's write lock, so every API call queued. Fixed by terminating the dump; root cause fixed in code: mirror DDL now
  runs with `lock_timeout = 5s` (fails fast, retried on the next upload). Deployed. The last full backup stays the
  verified Nov 18 05:34 one; before the deploy the affected `records` / `keys` rows (planner, console) were exported to
  `/root/hub/data/axf-data/backups/partb/`.

- **Console down ~03:18–03:57 UTC (not this build's change, fixed here)**: the console's self-update
  (`/usr/local/bin/axf-console-update` → `deploy/install-console.sh`) runs `chown -R` / `find -exec chmod` under
  `set -e`; a file removed mid-scan (`agent-slots/state.lock`, gone since part A) failed the update after the old
  container was stopped. The next cron run brought it back. Fix in this PR: vanishing files no longer fail the pass.
- **Host CLIs got 403 for ~3 min (04:06 UTC)**: with the console up on main I flipped the plan/catalog `console` keys,
  but the host token (`conf/env/host.env`, the orchestrator grants) had no grant on `console/framework/*`. Reverted
  at once (files and axf-data still equal, nothing lost). Fix in this PR: `deploy/install-data.sh` grants the host token
  read/write on `console/framework`, `console/projects`, `console/project.manifest.json` (the tokens file is already
  rewritten; axf-data reads it at start).
- **Live writes queued ~5 min (04:10 UTC)**: redeploying for the grant, my installer was killed by a timeout and left
  its schema pre-check container running; its migration waited on locks behind the nightly `pg_dump` (cron 03:17,
  still running) and every `keys` write queued behind it. Removed the container, service healthy at once. Fix in this
  PR: the start-up schema check runs with `lock_timeout = 15s` (fails fast; the installer then changes nothing).

## Next (after this PR is on main and axf-data is redeployed from main)

1. `bash deploy/install-data.sh` once no backup is running (check: no `COPY public.` in `pg_stat_activity`), so the
   host token's new grants and the lock timeouts are live.
2. `node framework/cli/data-tables.mjs cutover plan --apply --keys && node framework/cli/data-tables.mjs cutover catalog --apply --keys`
   (the console already runs main, so every reader honours key-level modes; `planner/v2/` flips with them because
   main's `tree.mjs` then goes through data-files).
3. Move `changes-core.mjs` and the session archiver onto data-files, then `data-tables.mjs cutover sessions --apply`.

## Also found

- `/usr/local/bin/axf-console-update` holds a GitHub token in plain text in its command line (the rule is
  environment variables only). Not changed here: it is generated by the console installer; worth moving to the env file.

## How it is reached (API)

No UI in this build. Everything is the data layer: the axf-data REST API (`/v1/<ns>/<path>` reads and writes the
documents exactly as before; `GET /v1/_meta/tables` lists every table, its rows and the backfill report; the axHub and
MCP data tools call the same API), and the CLI `node framework/cli/data-tables.mjs sets | status | backfill | cutover`
(`--json` on each). Modes: `node framework/cli/data-mode.mjs status`.

## Tests

- `services/axf-data/test_pg.py`: `test_plan_tables_and_backfill`, `test_catalog_tables`,
  `test_session_and_change_tables` (round trip, rows, one-row rewrite on edit, backfill idempotent, etag kept) plus the
  existing suite. Host run: all pass except `test_backup_routes` (no pg_dump on the host; CI has it) and the
  load-sensitive live-store timing check (passes alone).
- `framework/spec/check-data-tables.mjs` (new, in CI): per-set mapping, counts, backfill writes only what differs,
  refused cut, held tree.
- `check-data-store.mjs`, `test_data_store.py`, `check-builds-store-data.mjs`, plan-studio-2 `test.mjs`,
  `check-done-means-merged.mjs`, `check-ci-scope.mjs`: pass.

## Porting

Server-side storage only; no reference engine in `framework/core/engines` changed, so no Kotlin twin is owed.
