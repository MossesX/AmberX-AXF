# urgent-all-data-to-postgres-builds-store — s2: the builds store on Postgres tables

Fable, Nov 18 2026. Brett: "I don't want any data stored in JSON period. Everything needs to be a Postgres table."
Spec: `framework/spec/DATA-STORE.md` (Row-level writes, Key-level modes, The builds store on the tables), inventory
`framework/spec/DATA-INVENTORY.md`.

## What landed

- **Tables** (`services/axf-data/tables.py`, version 2): `builds` keyed by the build id (`rid`, `pos` keeps the order),
  `build_steps` and the new `build_notes` under that id, the rest of the document in `store_heads`; `journal` rows with
  the view `build_journal`. A version-1 database (rows keyed by position) is re-keyed on the first connect.
- **Row-level writes** (`POST /v1/<key>:patch`, data-patch@1): the builds a write changed, each with the rev it was read
  at, the head fields and the journal line in one transaction; Postgres locks only those rows (`SELECT … FOR UPDATE`).
  A stale rev is a `conflict` naming the build; `builds-store.mjs` re-reads and re-applies (5 tries). The SQLite engine
  answers the same patch on the document.
- **Key-level modes** (data-store-mode@1 `keys`): `builds/store.json` and `builds/journal/` can run in cutover while the
  rest of the `builds` namespace (pipeline, reconcile, shipped, reports, progress) stays on files for its own steps.
  Honoured by `data-files.mjs`, the console's `data_store.py` and `builds-store.mjs`.
- **The cut tool** `node framework/cli/builds-data.mjs status | cutover [--apply] [--no-flip] | local [--apply]`
  (`--store <file>` names the live file). The journal is copied before the lock; under the lock only tails are re-synced,
  the store is put once, counts are checked, the keys flip.
- **Host reach**: axf-data at a fixed address on its internal network; `conf/env/host.env` for processes on the VPS host
  (build sessions in worktrees, the gate runner, cron), read by `data-files.mjs` when `AXF_DATA_URL` is unset. A linked
  worktree reads the main checkout's mode document.

## Done live on the VPS (Nov 18 2026, 21:55–22:40 UTC)

| What | Result |
|---|---|
| axf-data redeployed (`deploy/install-data.sh` from this branch) | up, fixed address, `host.env` written; `builds`/`build_steps` re-keyed on connect (985 builds at that moment, 0 unkeyed rows) |
| Engine moved `shadow → postgres` (`axf data engine postgres --accept-drift`) | the SQLite side held 119 keys, Postgres 16 105: every namespace's real data was already on Postgres (migrated Nov 17), reads had been answering `not_found` from the near-empty SQLite primary. Drift accepted: 1 765 lines, all mirror conflicts on `ledger.sqlite` / `_meta/drift/*`, none on `builds/*` |
| Store copied: `/opt/axf/_claude/builds/store.json` → `builds/store.json` | record rev 3, reads back equal (canonical); **1 060 builds, 6 718 steps, 7 594 notes** on both sides and as rows in `builds`, `build_steps`, `build_notes` |
| Journal copied: hub `/projects/amberx-axf/_data/builds/journal/*.jsonl` → `builds/journal/<part>` | 22 parts, **15 731 entries** on axf-data = 15 733 hub lines − 2 torn fragments (see below); 917 oversized entries as `builds/journal-large/*` records with pointer lines; every remaining hub line present (set comparison per part) |
| Keys flipped | **no** (`--no-flip`): see "Why the flip waits" |

Report of the run: `builds-data-cutover@1`, `ok: true`, no problems; the 2 torn lines in part `2026-11-p7` (lines 463
and 1439, 2.1 MB and 1.3 MB, cut mid-JSON by an earlier writer; the Nov 17 copy had skipped them too; no other copy
exists) are recorded in the report's `truncated` list and are not data: nothing could be copied from them.

## Why the flip waits for s3

Every writer on the machine must read key-level modes before `builds/store.json` turns `cutover`: a writer on older
code reads the namespace mode (local), keeps writing the file, and the two sides diverge. Until this branch is on main and
the console and `/opt/axf` run it, only this worktree understands `keys`. s3 ("Cut builds over; drop the store.json lock
path") runs, once main carries this code:

```
set -a; . /root/hub/data/axf-data/conf/env/cli.env; set +a
AXF_DATA_URL=http://172.16.7.250:7700 node framework/cli/builds-data.mjs cutover --apply --store /opt/axf/_claude/builds/store.json --by svc:cli
```

(the cli token: the cut reads `_meta/tables` for the row counts and publishes the mode document). It re-syncs only the
journal tails written since today, checks the counts again and flips the two keys under the store lock in seconds.
Then: delete the 106 `store.json.tmp-*` leftovers and the lock path, generate the exports from the record.

## Left for s3 / later

- `ConsoleFocus` (`apps/console-web/plugins/build-orchestrator/server/__init__.py`) still reads build ids from the file for
  `build:<id>` focus; after the flip it should ask the store through the CLI.
- A patch assembles the whole record once for its etag (3–4 s at 1 000 builds); an incremental etag is a later step.
- `test_backup_routes` in `test_pg.py` needs `pg_dump` on the test host (CI has it; the VPS host does not).
- Baked framework copies (`apps/*/src/axf/core/data-files.mjs` …) are refreshed by `rebake.mjs` / CI's bake step, not here.
- The hub part `2026-11-p7` keeps its two torn lines; the journal on axf-data is the complete set of parseable entries.
