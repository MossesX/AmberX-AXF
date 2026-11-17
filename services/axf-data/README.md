# axf-data — the container that holds all console data

Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
builds keep running. That's what I need."

One small FastAPI service that owns the data volume and nothing else: notes, the builds store and its journal,
settings documents, planner items, UI reviews, the changes log, session archives and every plugin's data folder. The
console, axHub, headless build sessions (and axf-molly), the CLI and the plugins are clients of one API, data-store@1
(contract: `framework/spec/DATA-STORE.md`, reference client `framework/core/data-store.mjs`). When the console is down
only its screens go: the data is read and written here.

| File | What |
|---|---|
| `main.py` | the HTTP API (`/v1/…`), auth, the backup routes |
| `store.py` | the engine: SQLite (`keys`, `changes`, `idem`) + content-addressed blobs; rev / etag checks, manifests, snapshots |
| `journal.py` | append-only journal lines (SQLite triggers refuse UPDATE / DELETE), per-key history + restore, SSE watch |
| `auth.py` | data-token@1 (EdDSA JWS from axHub's key set) and hashed service tokens; grants per namespace |
| `backup.py` | daily backup (SQLite online backup + blobs), verify against the live store, retention, restore |
| `mcp.py` | MCP tools at `POST /mcp`: what axHub proxies (below) |
| `Dockerfile`, `compose.yaml` | the image; a Coolify compose resource (private: no port, no domain) |
| `test_store.py` | `python3 services/axf-data/test_store.py` (also replays the Node contract live) |

## Run it

- **VPS**: `sudo bash deploy/install-data.sh` builds `axf-data:latest`, makes the internal network `axf-data` and the
  volume `axf-data`, writes service tokens once (`/root/hub/data/axf-data/conf/env/<service>.env`; only their SHA-256 goes
  into the container), starts the container (`restart unless-stopped`, no published port), connects the console and
  axHub, installs the daily backup cron and logs the deploy (deploy-log@1 target `axf-data`). Re-run the console
  installer afterwards: it passes `conf/env/console.env` (AXF_DATA_URL, AXF_DATA_TOKEN) into the console.
- **Locally**: `AXF_DATA_DIR=/tmp/axfd AXF_DATA_TOKENS_FILE=tokens.json python3 -m uvicorn main:app --port 7700`.

## Move data onto it (staged)

1. `node framework/cli/data-migrate.mjs` — dry run: what each namespace holds (keys, bytes, kinds, anything that can't move).
2. `node framework/cli/data-migrate.mjs apply <ns>` — backup of the source first, copy, verify count + hash manifests (M0 = M1); refuses on any mismatch.
3. `node framework/cli/data-mode.mjs shadow <ns>` — writes go to both, reads compare, differences go to the drift log.
4. `node framework/cli/data-mode.mjs cutover <ns>` — only after shadow has been quiet (no drift) for the window (30 min).
5. `node framework/cli/data-mode.mjs rollback <ns>` — any time after: replays axf-data's changes onto the local files, back to local.

Everything above is also in the console (Settings → Plugins → Data store), `axf data …`, the Data store plugin's MCP
commands and voice.

## Backups

Daily at 03:17 UTC (`deploy/axf-data-backup.cron`) into `/root/hub/data/axf-data/backups`: `axf-data-<date>.tar.gz` =
the SQLite online backup + every blob it names + `backup.json`. Each one is verified (integrity check, blob hashes, key
counts against the live store); 14 days are kept plus the newest of each week for 12 weeks. `last.json` is what the
Systems check item **Data container backups (axf-data)** reads; its Auto fix runs a backup (or restarts the container
when it doesn't answer) as a veto call.

- Back up now: `docker exec axf-data python backup.py run` (or Backup now in the console, `axf data backup`)
- Restore: `docker stop axf-data && docker run --rm -v axf-data:/data -v /root/hub/data/axf-data/backups:/backups axf-data:latest python backup.py restore /backups/<file> --force && docker start axf-data`

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

Internal network only; never a host port or a Traefik route. Every `/v1` route but `/v1/health` needs a token; grants
are per namespace or plugin folder. Tokens: data-token@1 from axHub's key set (verified offline from the last good
copy), or service tokens whose SHA-256 sits in `tokens.json`. Revoke: `DELETE /v1/_meta/tokens/<id>`. The container
runs as uid 10001.
