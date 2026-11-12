# amberx-import: AmberX web app data into console storage (amberx-import@1)

Build `move-amberx-web-app-into-the-console-amberx-andr`, step s2 (Fable, Nov 12 2026). Brett: "Now what we're gonna end
up doing is just moving everything over the console and making AmberX app read the console instead of AmberX." This folder
is the data side of that move: where each AmberX data set lives today, where it lives on the console, and the script that
takes it there and back. The routes that read it are in `docs/contracts/amberx-console-api.md` (amberx-console-api@1).

Files: `migrate.py` (apply, rollback, status), `schema.json` (the manifest, the stored AI document, the alert-history
record), `test_migrate.py` (CI).

## 1. Where the data is, and where it goes

The AmberX web app (`apps/amberx-droid`, served at `amberx.amberxai.com` by `server/main.py`) kept almost nothing of its
own. Notes, lists, to-dos, recordings and settings were always hub-table@1 / hub-settings@1 documents on axHub's data
server, which the console already reads and writes on the mounted `/projects` volume. Only the AI profile store and the
walkthrough media sat in the AmberX container's data folder (`/opt/amberx-web/.app/data`, `AMBERX_DATA_DIR`).

| Section | Today | On the console | What apply does | Format |
|---|---|---|---|---|
| `ai` | `$AMBERX_DATA_DIR/ai.json` (amberx-ai@1: profiles with `key` / `refresh` inline, 0600) and `.app/ai.env` (per-kind fallbacks `AMBERX_<KIND>_API_KEY`, `AMBERX_CLAUDE_OAUTH_TOKEN`, `AMBERX_CLAUDE_REFRESH_TOKEN`) | profiles in the `amberx-ai` plugin's data folder (`lifecycle.dataDir` from its plugin.json once s3 adds it; `.axf-console/plugins/amberx-ai/ai.json` until then); every secret in the console credential store `.axf-console/secrets.env` | writes the document with `key` / `refresh` replaced by `keyRef` / `refreshRef` (`AMBERX_AI_KEY_<ID>`, `AMBERX_AI_REFRESH_<ID>`); adds each secret to secrets.env; fallbacks keep their AmberX names | amberx-ai@1 (schema.json `aiProfilesOnConsole`) |
| `walkthrough` | `$AMBERX_DATA_DIR/walkthrough/**` (the AmberX tour at the top: mp4, vtt, chapters.json, poster, `chapters/*.mp4`; other walkthroughs in `<id>/`; about 330 MB) | the Molly guide plugin's data folder, `.axf-console/plugins/molly-guide/amberx-walkthrough/**` (contract C22) <!-- axf-plugin:molly-guide --> | hard-links when both folders share a filesystem, else copies with times kept; skips dotfiles and `*.tmp` | files as they are |
| `notes` | `/projects/amberx-axf/_data/amberx-notes/{lists,items}/head.json` (+ `rows-N.json`), hub-table@1 rows in amberx-notes@1 (`kind`: note, todo, task) | the same files: `token-control`'s `amberx.items` / `amberx.lists` targets read them there | nothing copied; checks both tables, counts rows and items by kind, records `updatedAt` and the head's SHA-256 | hub-table@1, amberx-notes@1 |
| `recordings` | `/projects/amberx-recordings/_data/output-recorder/recordings/<id>.json` + `parts/<id>/NNNN.json` | the same files: the output recorder's transcript worker reads them there | nothing copied; counts recordings and parts, lists recordings with parts missing | audio-recording@1, audio-part@1 |
| `settings` | `/projects/_shared/_data/settings/apps/amberx-droid.json`, `.../appearance.json` | the same files: the s10 `amberx.settings` control target reads them there | nothing copied; checks the format, counts keys | hub-settings@1, appearance@1 |
| `approvals` | axHub's approvals ledger | stays on axHub (contract 4.4: the console relays, the hub decides) | nothing read, nothing written; recorded as `stays-on-axhub` | hub |
| `notifications` | none on the AmberX server: the phone polled the console's `/api/alerts` (T17) and kept what it had shown on the device | `.axf-console/alerts-history.jsonl`, the per-device delivery history behind contract C35b (`GET /api/alerts/history`) | creates the store and back-fills one `legacy` alert-history@1 record (device `amberx-web`, channel `legacy-poll`) per alert in `.axf-console/alerts.json`, `readAt` set when the alert was acknowledged | alert-history@1 (schema.json `alertHistoryRecord`) |

What is deliberately not here:

- **Phone-side state** (`localStorage` keys `amberx.notes.queue`, `amberx.monitor.seen`, `amberx.voice.*`, the native
  listener registry) is on the device. The offline notes queue reaches the console through C10 (`amberx.items/queue/act/flush`)
  the first time the phone talks to it; voice and monitor settings are mirrored through hub-settings@1 already.
- **The AmberX server's request log** does not exist yet: s11 creates it when the old addresses start forwarding.
- **Voice notes** (`/projects/amberx-axf/_data/voice-notes/`) belong to the console's voice-notes plugin and never left it.

## 2. How the AI document is read after the move

The console loads `secrets.env` into its environment at start (`server/credentials.py`), so a profile's key is
`os.environ[profile["keyRef"]]` and its refresh token `os.environ[profile["refreshRef"]]`; a profile without `keyRef`
falls back to the per-kind names the AmberX router already checks (`AMBERX_<KIND>_API_KEY`, then the provider
registry's own variable). The s3 `amberx-ai` plugin ports `router.py` with `key_for` changed to that one lookup; nothing
else in the document changed shape, so `Router._load` reads it as is (unknown fields such as `keyRef` ride along).

Secrets never appear in a document, a manifest, a log line or the script's output: the manifest and the JSON output
name credential entries, never values. The credential file is the one the Systems check writes, so every imported
key is visible (as "set") and clearable there.

## 3. Idempotency and rollback

`migrate.py apply` keeps a manifest at `.axf-console/migrations/amberx-import.json` (schema.json `manifest`):

- `created.files`: every file apply made that did not exist before (path, size, SHA-256 unless over 64 MB).
- `created.secrets`: every credential entry apply added (names only).
- `created.history`: every alert id it back-filled.
- `backups`: every file apply replaced, moved (not copied) to `.axf-console/migrations/amberx-import.bak/` the first time
  it was replaced, so repeated runs never lose the pre-migration original.
- `runs`: the last 20 runs with each section's state.

Rules that make a second run a no-op:

- A profile document is written only when it differs from what is on disk. A credential is written only when the
  store has no value or a different value **that the import wrote itself** (so a token AmberX rotated follows). A
  different value that someone typed into the console is a `conflict`: it stays, the run says so and exits 2.
- A media file is "the same" when it is the same inode (hard link) or has the same size and modification time.
- A history record is skipped when the store already has one for that alert and device.
- `--check` runs every section read-only and does not even write the manifest.

`migrate.py rollback` undoes exactly what the manifest says: deletes `created.files` (and the empty folders they leave
under `.axf-console`), clears `created.secrets`, drops the back-filled history lines (the file itself only when the import
made it and nothing else is left in it, so history the console wrote since survives), moves every backup back, then
records the rollback. Credential entries the import did not add, hub data under `/projects` and the AmberX source
folder are never touched by either direction. The AmberX server keeps running on its own copy throughout; the source is
removed by hand only after s13's `amberx.backend` switch has been on `console` for long enough.

Section states (schema.json `sectionState`): `moved`, `unchanged`, `in-place`, `empty`, `stays-on-axhub`, `skipped`,
`conflict`, `error`. One failing section never stops the others.

## 4. Running it

On the VPS, as root, from the console checkout (`/opt/axf`):

```
python3 apps/console-web/migrations/amberx-import/migrate.py --check            # what would move; writes nothing
python3 apps/console-web/migrations/amberx-import/migrate.py                    # apply (defaults below)
python3 apps/console-web/migrations/amberx-import/migrate.py --only ai,walkthrough
python3 apps/console-web/migrations/amberx-import/migrate.py status --json
python3 apps/console-web/migrations/amberx-import/migrate.py rollback --check
python3 apps/console-web/migrations/amberx-import/migrate.py rollback
```

Defaults: `--from /opt/amberx-web/.app/data` (`AMBERX_DATA_DIR` if set), `--ai-env <from>/../ai.env`,
`--console <repo>/.axf-console` (`AXF_ROOT` if set), `--projects /projects` (`AXHUB_PROJECTS_DIR` if set). Exit 0 done or
nothing to do, 2 credential conflicts left in place, 1 error. The console picks up new credentials at its next start;
until then an imported key is on disk but not in the running process's environment.

Where it runs in the build: s3 (notes + `amberx-ai`) runs `apply --only ai` from the plugin's `install.mjs`; the Molly
guide's C22 routes expect `apply --only walkthrough` to have run; s9 (notifications) reads and appends
`alerts-history.jsonl`; s14 runs `test_migrate.py` and a `--check` against the live folders as the migration dry run.
CI runs `test_migrate.py` with the other console server tests.
