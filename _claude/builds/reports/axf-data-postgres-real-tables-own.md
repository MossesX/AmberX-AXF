# axf-data on Postgres: real tables in its own container

Build `axf-data-postgres-real-tables-own` · branch `claude/axf-data-postgres-real-tables-own` · Phase 1 (Fable), Phase 2 (Opus) · follows
`data-container-axf-data-holds-all` (PR #704, SQLite + blobs; this branch contains it and lands after it).

Brett, Nov 15 2026: "Yeah, I want to migrate everything to a database in its own container. Land it, and then follow it
up with Postgres."

## Result

axf-data's store is Postgres 16 in its own private container (`axf-data-db`, volume `axf-data-pg`, never published), with
real tables: one row per build and per step, per journal line (JSONB), per UI Review item, per planner item, per
settings document, per note (Markdown text), per control target; the Shipped features ledger and the Chat viewer db are
mirrored table for table. The data-store@1 API on top is unchanged: the whole contract suite replays on Postgres, the
Node client replays its scenario against a Postgres-backed server, and no caller changed. The real builds store (931
builds, 9 MB) goes to rows and comes back equal.

The VPS has no axf-data yet (PR #704 has not landed), so there is no SQLite store to migrate there: `install-data.sh`
starts the database and the service on Postgres directly. An install that does hold a SQLite store is moved in stages
inside the service: `migrate_pg.py` (backup first, copy, counts + manifests must match) → `shadow` (SQLite reads,
Postgres mirrored, drift logged) → `postgres` (cut over) → roll back any time.

## What was built

| Piece | Where | Reached by |
|---|---|---|
| Postgres engine: keys, records (JSONB), content-addressed blobs, append-only journal (trigger + `entry JSONB`, view `build_journal`), history + restore, feed, snapshots, idempotent appends | `services/axf-data/pg.py` | `/v1/…` as before |
| Domain tables: `builds` + `build_steps`, `ui_review_items`, `planner_items`, `settings`, `notes`, `control_targets` + `control_tabs`, `store_heads`; typed lifted columns, `extra` for what does not fit; only changed rows rewritten | `services/axf-data/tables.py` | the same keys |
| SQLite mirrors: `ledger_*` on every ledger upload, `chats_*` from the mounted file (too big for a blob); `mirror_runs` with counts | `tables.py`, `mirror_sync.py`, cron 03:40 | `GET /v1/_meta/tables`, `POST /v1/_meta/tables/sync`, `axf data tables [--sync]`, plugin `tables` / `sync-tables`, voice |
| Engine move sqlite → shadow → postgres with a drift log, guards, `engine.json` | `services/axf-data/engine.py` | `GET/POST /v1/_meta/engine`, `axf data engine`, plugin `engine` / `engine-move`, voice, `health.engine` |
| SQLite axf-data → Postgres copy: backup first, every key with its rev / etag / at / by, journal lines verbatim, history, feed, idem; refuses unless counts, journal lines and every manifest are equal | `services/axf-data/migrate_pg.py` | installer, `docker run … migrate_pg.py` |
| Backups: `pg_dump` custom archive in the same tar.gz shape, verify (`pg_restore --list`, hash, counts vs live), restore, retention | `services/axf-data/backup.py` | cron 03:17, `axf data backup`, console, MCP, voice |
| Deploy: `axf-data-db` (postgres:16-alpine, `--data-checksums`), DSN and password made once, migration step, mirror mount, `postgresql-client-16` in the image | `compose.yaml`, `Dockerfile`, `deploy/install-data.sh`, `deploy/axf-data-backup.cron` | VPS |
| Control registry as a table: `inventory.json` is generated, untracked (.gitignore) and published by the console server as `console/control/inventory.json` → `control_targets`; `--check` writes instead of failing | `apps/console-web/scripts/control-inventory.mjs`, `server/console_control.py`, `framework/schemas/data-store-paths.json` | the same console-control API |
| Data store plugin surfaces | `apps/console-web/plugins/data-store/` | REST `tables`, `tables/sync`, `engine` (GET/POST); commands `tables`, `sync-tables`, `engine`, `engine-move`; voice phrases; help |

API parity: every new thing is reachable four ways and the same way: REST `/api/plugins/data-store/{tables,tables/sync,engine}`,
plugin commands (MCP) `tables` / `sync-tables` / `engine` / `engine-move`, CLI `axf data tables [--sync chats|ledger]` and
`axf data engine [sqlite|shadow|postgres] [--accept-drift]`, voice ("what tables are there", "which engine", "cut over to
postgres", "sync the chats"; moves and mirror runs ask first). No UI changed (the Data store tab's state already shows
what the plugin reads; its three layout options are still in UI Review from #704), so nothing new is in the review queue.

## Design notes

- **Rows, not copies.** A document whose arrays become rows is decomposed on PUT and assembled on GET; its etag is the
  canonical assembled body, so the SQLite and Postgres engines answer the same etag for the same document (the shadow
  compare relies on that). Lifted columns are typed; a value that does not fit (`pr: ""` vs `pr: 705`) stays in `extra`
  with the column NULL: nothing coerced, nothing lost.
- **The two SQLite ledgers** stay the writers' truth for now: their plugins open the file locally (node:sqlite / sqlite3).
  Postgres holds their rows as the queryable copy (full refresh, counts checked); the ledger blob is kept once (no history
  copies) so `sqliteHydrate` keeps working. Moving those two plugins onto rows directly is the next step, not this one.
- **chats.db is 683 MB**, over the 256 MiB blob limit, so it never travels as a blob: `mirror_sync.py` reads the mounted
  file (`/opt/axf/.axf-console/plugins`, read-only) nightly and on demand.
- **Journals are rows** with `entry JSONB` and the stored line (the etag hashes the lines, same as SQLite); the trigger
  refuses UPDATE / DELETE at the database.
- The assembled body of a table-backed document is cached by etag in the process, so the orchestrator's read-every-minute
  of the builds store costs a key lookup, not 931 rows.

## Tests

| Check | Result |
|---|---|
| `python3 services/axf-data/test_pg.py` (postgres:16 container; the contract suite on Postgres, builds rows, live store round trip, other domain tables, control registry rows, SQLite upload → rows, mounted-file mirror, migration + CLI, engine shadow / cut-over / roll-back / guards, pg_dump backup + verify + restore, Node contract `--http`) | 20 ok |
| `python3 services/axf-data/test_store.py` (SQLite, unchanged) | 14 ok |
| live builds store: 931 builds → rows | put 6.6 s, get 0.1 s (cached), second put 1.4 s, document equal |
| `node framework/spec/check-data-store.mjs` | 68 ok |
| `python3 apps/console-web/server/test_data_store.py` · `apps/console-web/plugins/data-store/test.py` | all ok |
| `node apps/console-web/scripts/control-inventory.mjs --check` · `node framework/cli/check-console-control.mjs` | ok |
| Phase 2 (Nov 17), after merging data-container again (claude-settings device views through data-files): all of the above re-run | test_pg 20 ok, test_store 14 ok, check-data-store 68 ok, data_store / plugin / control inventory / console-control / claude-settings 93 ok |
| CI: `.github/workflows/android.yml` engine job starts a postgres:16-alpine container and runs `test_pg.py` | added |

## Open

- Running `test_pg.py` by hand with `AXF_DATA_PG_TOOLS="docker exec -i <c>"`: `AXF_DATA_PG_TOOLS_DSN` is the
  container's own port (127.0.0.1:5432), not the mapped host port (noted in the test header).

- **VPS install** after the merge: `sudo bash deploy/install-data.sh` (fresh: Postgres from the start), re-run the console
  installer, then migrate and shadow one namespace at a time (settings first, builds last) with `axf data mode`.
- **Shipped features ledger and Chat viewer** still write SQLite locally; Postgres holds their rows as a mirror. Moving
  those plugins onto rows through data-store@1 (or a row API) is a follow-up.
- **UI Review**: nothing new; #704's Data store tab layouts still wait for Brett.
