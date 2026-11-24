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

---

# s3–s5 (Opus, Nov 19 2026)

## s3 — the cut code

- **No file lock, no file write on the store in cutover**: `withStore` uses the per-row rev check, `exportNow` and
  `mergeRetiredNow` stand down from the file. `builds-data.mjs clean [--apply]` removes dead writers' `store.json.tmp-*`
  and an unheld lock; a successful flip runs it (the 106 leftovers were already gone on Nov 19).
- **Writers from before the cut lose nothing**: in cutover `adoptStore` → `adoptRemote` takes the builds main holds newer
  (per build and step) into the tables as one row-level patch. Every new-code write flushes to main and pulls it back,
  so an older session's ticks (it still publishes to main) reach the tables within a write or two.
- **store.json becomes a read-only projection**: console screens still read the file directly (activity, crew-live,
  Builds page watch, ref-links, projects), so after every write the console checkout's `store.json` and orchestrator
  exports are rewritten from the tables (`projectConsole`; never to an older rev).
- **Exports stay** (`orchestrator.json`, `pending.json`, `build-queue.json`): about 20 readers, all generated from the record.
- **Console focus** reads build ids through `data_store` (the tables in cutover).
- Checks: `check-builds-store-data` 10 ok (new: adopt + projection), `check-builds-store` 52, lock 5, `check-builds-live` 69,
  build-orchestrator `test.py` 58.

**Not flipped yet.** `/opt/axf` was reset to main on Nov 19 00:5x (local diff saved as
`.axf-console/predeploy-20261119T005034.patch`, its one unpublished build synced to main first). Main has the key-level
modes but not the projection, so flipping before this PR lands would freeze the file-reading screens. The image rebuild
waited behind the shared heavy slots (~35 waiters). The flip, once this branch is on main and `/opt/axf` runs it:

```
set -a; . /root/hub/data/axf-data/conf/env/cli.env; set +a
AXF_DATA_URL=http://172.16.7.250:7700 node framework/cli/builds-data.mjs cutover --apply --store /opt/axf/_claude/builds/store.json --by svc:cli
```

## s4 — split, and s4.1

The inventory's s4 (six namespace groups) already exists as two builds: `postgres-part-b-plan-plan-studio-catalog`
(s4.2, s4.3, s4.6) and `postgres-part-c-console-state-settings` (s4.4, s4.5). This build's s4 is s4.1:

- pending list and build queue: exports of the builds record, so they live in the builds tables with the store.
- **agent-slots → `agent_slots` table** (one row per entry, section = list); `agent-slots.mjs` follows the key mode of
  `console/agent-slots/state.json`; in cutover a rev check (etag, if-match put, re-read on conflict) replaces the mkdir
  lock. `agent-slots.mjs data status | cutover [--apply] | local [--apply]`. Live `data status`: local; axf-data holds a
  stale Nov 17 copy that the cut re-puts. `check-agent-slots-data` 6 ok, `test_pg.py` table cases 5 passed.
  Not flipped: every worktree runs its own `agent-slots.mjs`, so the flip waits until they carry this code.
- **auto-lander**: not a data-store@1 path yet (no rule in `data-store-paths.json`); needs the contract change first.
- `check-agent-slots.mjs` shows 51–52/56 on this host for main and this branch alike (headless/tmux launch checks).

## s5 — the rule

- CLAUDE.md and DATA-STORE.md: no runtime data in JSON files, Postgres tables only (no-json-data@1).
- `framework/spec/check-json-data-writes.mjs` in CI: a new direct JSON/JSONL write in runtime code fails. Today's 228
  writes in 123 files are the baseline (`json-data-writes.baseline.json`); counts only go down (`--update` refuses a raise).
  Verified: a probe file with one new write fails with its line named.

## API reach

No UI added. The cut and status are CLI (`builds-data.mjs`, `agent-slots.mjs data …`); the store itself stays reachable
as before through the console API, MCP and the orchestrator CLI.
