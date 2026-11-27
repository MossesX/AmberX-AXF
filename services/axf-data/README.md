# axf-data — the container that holds all console data

Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
builds keep running. That's what I need." … "Yeah, I want to migrate everything to a database in its own container.
Land it, and then follow it up with Postgres."

One small FastAPI service that owns the console's data and nothing else: notes, the builds store and its journal,
settings documents, planner items, UI reviews, the changes log, session archives, the API / control registry and every
plugin's data folder. The store is **Postgres in its own container** (`axf-data-db`, Brett's Nov 6 choice) with real
tables; the service speaks data-store@1 (contract: `framework/spec/DATA-STORE.md`, reference client
`framework/core/data-store.mjs`), so the console, axHub, headless build sessions (and axf-molly), the CLI and the plugins
are clients of one API and never see the engine. When the console is down only its screens go: the data is read and
written here.

| File | What |
|---|---|
| `main.py` | the HTTP API (`/v1/…`), auth, the backup / tables / engine routes |
| `pg.py` | the Postgres engine: keys, records (JSONB), blobs, append-only journal (trigger), history, feed, snapshots; domain tables through `tables.py` |
| `tables.py` | the real tables: `builds` + `build_steps`, `ui_review_items`, `planner_items`, `settings`, `notes`, `control_targets` + `control_tabs`, `store_heads`; SQLite mirrors (`ledger_*`, `chats_*`, `mirror_runs`) |
| `engine.py` | which engine runs (`AXF_DATA_DSN`), and the staged move sqlite → shadow → postgres with a drift log |
| `migrate_pg.py` | SQLite axf-data → Postgres: backup first, copy key for key, counts + manifests must match |
| `mirror_sync.py` | mirror a SQLite file the console still writes (Chat viewer db, Shipped features ledger) into rows |
| `store.py`, `journal.py` | the SQLite engine (an install that has not moved yet; the reference the Postgres engine mirrors) |
| `auth.py` | data-token@1 (EdDSA JWS from axHub's key set) and hashed service tokens; grants per namespace |
| `backup.py` | daily backup: `pg_dump` (or the SQLite online copy), verify against the live store, retention, restore |
| `mcp.py` | MCP tools at `POST /mcp`: what axHub proxies (below) |
| `Dockerfile`, `compose.yaml` | the image (with `postgresql-client-16`); a Coolify compose resource: `axf-data-db` + `axf-data`, private |
| `test_store.py`, `test_pg.py` | the contract suite on SQLite; the same suite on Postgres plus tables, mirrors, migration, engine moves, backups |

## Run it

- **VPS**: `sudo bash deploy/install-data.sh` builds `axf-data:latest`, makes the internal network `axf-data` and the
  volumes `axf-data` (snapshots, engine state) and `axf-data-pg` (the database), writes service tokens and the database
  password once (`/root/hub/data/axf-data/conf/env/<service>.env`, `postgres.env`; only token hashes go into the
  container), starts `axf-data-db` (postgres:16-alpine, no port) and `axf-data` (no port, no domain, `restart
  unless-stopped`), connects the console and axHub, installs the backup + mirror cron and logs the deploy (deploy-log@1
  target `axf-data`). A volume that already holds a SQLite store is migrated first (backup, copy, counts + manifests) and
  the service starts in `shadow`; `axf data engine postgres` cuts over. Re-run the console installer afterwards: it passes
  `conf/env/console.env` (AXF_DATA_URL, AXF_DATA_TOKEN) into the console. The container sits at a fixed address on the
  internal network (`<subnet>.250`) and the installer writes `conf/env/host.env` (that address, the orchestrator's token)
  for processes on the VPS host itself (build sessions in worktrees, the gate runner, cron): `framework/core/data-files.mjs`
  reads it when `AXF_DATA_URL` is unset.
- **Locally**: `AXF_DATA_DSN=postgresql://user:pw@localhost:5432/axfdata AXF_DATA_DIR=/tmp/axfd AXF_DATA_TOKENS_FILE=tokens.json python3 -m uvicorn main:app --port 7700`
  (without `AXF_DATA_DSN` the SQLite engine runs).

## Tables

`GET /v1/_meta/tables` (`axf data tables`, the Data store plugin's `tables` command, "what tables are there") lists every
table with rows, bytes and what it holds. The documents the console keeps are rows, not JSON copies: one row per build
(`builds`, keyed by the build id), per step (`build_steps`) and per note (`build_notes`) under that id, per UI Review item,
per plan, per settings document, per note (Markdown text), per control target; the fields of a document that are not rows
(`rev`, `rules`, `groups`, `counts`…) sit in `store_heads`. Journal lines are rows with `entry JSONB` (view
`build_journal` lifts action / note / builds). Lifted columns are typed; a value that does not fit stays in the row's
`extra` JSONB with the column NULL, so every document comes back exactly as it went in (same canonical etag as the SQLite
engine).

`POST /v1/<key>:patch` (data-patch@1) writes some rows of such a record without the rest: the builds a session changed,
each checked against the rev it was read at, the head fields given and one journal line, in one transaction that locks
only those rows (`SELECT … FOR UPDATE`). It is how `framework/cli/builds-store.mjs` writes the builds store after the cut
(`node framework/cli/builds-data.mjs cutover --apply`). The SQLite engine answers the same patch on the document.

The two SQLite files the console still writes are mirrored table for table: the Shipped features ledger on every upload
(`ledger_features`, `ledger_edits`, `ledger_manifests`…), the Chat viewer db nightly from the mounted file
(`chats_sessions`, `chats_messages`; it is bigger than a blob may be). `mirror_runs` records each run and its counts;
`POST /v1/_meta/tables/sync { source }` / `axf data tables --sync chats|ledger` runs one now.

## Move data onto it (staged)

1. `node framework/cli/data-migrate.mjs` — dry run: what each namespace holds (keys, bytes, kinds, anything that can't move).
2. `node framework/cli/data-migrate.mjs apply <ns>` — backup of the source first, copy, verify count + hash manifests (M0 = M1); refuses on any mismatch.
3. `node framework/cli/data-mode.mjs shadow <ns>` — writes go to both, reads compare, differences go to the drift log.
4. `node framework/cli/data-mode.mjs cutover <ns>` — only after shadow has been quiet (no drift) for the window (30 min).
5. `node framework/cli/data-mode.mjs rollback <ns>` — any time after: replays axf-data's changes onto the local files, back to local.

Everything above is also in the console (Settings → Plugins → Data store), `axf data …`, the Data store plugin's MCP
commands and voice.

## Engine move (SQLite axf-data → Postgres)

An axf-data that ran on SQLite moves inside the service: `python migrate_pg.py` (backup first; every key with its rev /
etag / at / by, journal lines verbatim, history, feed; refuses unless counts per namespace, journal lines and every
namespace's manifest are equal), then the service runs in `shadow` (SQLite reads, every write mirrored to Postgres,
differences in `<data>/engine-drift.jsonl`), then `POST /v1/_meta/engine { "mode": "postgres" }` (`axf data engine
postgres`, the plugin's `engine-move`, "cut over to postgres") once the drift is zero or read and accepted. `GET
/v1/_meta/engine` shows the mode, drift, counts on both sides and the next move; `shadow → sqlite` and `postgres →
shadow` are always allowed. A fresh install runs on Postgres from the start.

## Backups

Daily at 03:17 UTC (`deploy/axf-data-backup.cron`) into `/root/hub/data/axf-data/backups`: `axf-data-<date>.tar.gz` =
`axf-data.pgdump` (pg_dump custom format) + `backup.json` (counts per namespace, journal lines, rows per table, sha256).
Each one is verified (hash, `pg_restore --list`, counts against the live database allowing for later writes); 14 days are
kept plus the newest of each week for 12 weeks. `last.json` is what the Systems check item **Data container backups
(axf-data)** reads; its Auto fix runs a backup (or restarts the container when it doesn't answer) as a veto call. At 03:40
`mirror_sync.py --all` refreshes the SQLite mirrors.

- Back up now: `docker exec axf-data python backup.py run` (or Backup now in the console, `axf data backup`)
- Restore: `docker stop axf-data && docker run --rm --network axf-data -v axf-data:/data -v /root/hub/data/axf-data/backups:/backups -e AXF_DATA_DSN=… axf-data:latest python backup.py restore /backups/<file> --force && docker start axf-data`
  (the DSN is in `conf/env/postgres.env`; `pg_restore --clean` replaces every table)

## axHub route (tools that work with the console down)

axHub keeps a route to axf-data and the `axhub` service token, and nothing else: no data is stored in axHub. The
downstream is described in `deploy/axhub/axf-data.downstream.json` (url `http://axf-data:7700/mcp`, bearer from
`conf/env/axhub.env`, prefix `data`); axHub's container joins the `axf-data` network (install-data.sh,
`AXF_DATA_CLIENTS`). Writes go through axHub's veto confirm like other changes.

| Tool (through axHub: `data.<tool>`) | What it does |
|---|---|
| `data_status` | axf-data reachable, change cursor, keys per namespace, last backup and verify |
| `notes_list {folder?}` | Brett's notes (path, size, rev, when) |
| `note_read {path}` | one note's text and etag |
| `note_write {path, text, etag?}` | write a note; with the etag it only lands if nobody changed it since; without one it must be new |
| `builds_list {status?, limit?}` | builds: id, title, status, steps done / total, PR |
| `build_get {id}` | one build as stored |
| `build_note {id, text}` | add a note to a build (rev-checked store write + one journal line) |
| `settings_get {path}` | a settings document (`settings/<path>`) |
| `settings_set {path, value, etag?}` | write a settings document; Claude settings (`claude/…`) are refused: owner-only keys change only with Brett's click in the console |
| `data_get {key}` · `data_list {ns, prefix?}` · `data_append {key, entries}` | the raw data-store@1 operations, within the token's grants |

Headless build sessions don't need axHub for the builds store: with `AXF_DATA_URL` and the orchestrator token
(`conf/env/orchestrator.env`) `framework/cli/builds-store.mjs` reads and writes it directly (in cutover, lock = rev check).

## Security

Internal network only; never a host port or a Traefik route; the database container is on the same internal network and
reachable only by axf-data (password in `conf/env/postgres.env`, 0600). Every `/v1` route but `/v1/health` needs a token;
grants are per namespace or plugin folder; `_meta/engine` and `_meta/tables/sync` need write on `_meta`, snapshots and
token revocation need admin. Tokens: data-token@1 from axHub's key set (verified offline from the last good copy), or
service tokens whose SHA-256 sits in `tokens.json`. Revoke: `DELETE /v1/_meta/tokens/<id>`. The container runs as uid 10001.
