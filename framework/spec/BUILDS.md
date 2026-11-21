# BUILDS — the one builds store (builds@1)

Status: contract since Oct 31 2026 (Urgent `urgent-builds`, Opus); reviewed on Fable Nov 1 2026 (`_claude/builds/reports/fable-review.md`).
Reference implementation: `framework/plan/builds-store-core.mjs` (pure, IO-free) + `framework/cli/builds-store.mjs` (files, lock,
journal, exports). Checks: `node framework/spec/check-builds-store.mjs`, `node framework/cli/builds-store.mjs verify`.
Python has no second implementation: the console's builds-page server shells to the CLI (`builds.mjs --json`), so there is one
writer. No Kotlin twin: the store is build tooling, not an app contract (nothing an Android app renders).

## Why

The same builds used to live in five places per profile (orchestrator.json, pending.json repo + hub, build-queue.json, plan
epics) and drifted. Now every build of every profile is **one record** in `_claude/builds/store.json`, owned by the Build
orchestrator, and every older list is a **projection** of it. Nothing is ever dropped: deletes are soft and every write is
journalled.

## Store

```
{ $axf: 'builds@1', rev, updatedAt, migratedAt,
  rules:  { <profile>: orchestrator rules },
  meta:   { queue: { <profile>: { dirty, updatedAt, history } }, pending: { <profile>: { artifact, updatedAt } } },
  drafts: { <profile>: { ops: [Op…], updatedAt, by } },
  builds: [BuildRecord…] }
```

**BuildRecord** = the orchestrator@1 build fields (`id`, `title`, `category`, `detail`, `status`, `hidden`, `source`,
`pendingId`, `branch`, `pr`, `createdAt`, `updatedAt`, `builtAt`, `notes`, `approvals`, `steps`) plus:

| Field | Meaning |
|---|---|
| `profiles: [id…]` | the build profiles it belongs to: a field, never a copy (one record shown in each) |
| `order: { <profile>: n }` | its place in each profile's list; the build queue is this order for plan epics |
| `kind: build \| epic` | epic = a plan epic (`planRef` = the plan feature id) |
| `rev` | bumped on every change (the journal keeps every revision) |
| `deleted`, `deletedAt` | soft delete |
| `pending` | what only the Pending list knew (model, own status, estimate, source, planId, step dates, `[Model]` prefix flag) or null |
| `queue` | the build-queue record of an epic (completedAt, deps, rework, estimate…) or null |
| `defaultSteps`, `defaultAt`, `rearranged` | the default breakdown (Restore default); follows orchestrator edits until the Steps view rearranges the build |
| `removedSteps` | steps taken out (removed, divided, harvested away) with why, when, by |
| `legacy`, `copies` | where the record came from in the migration; other copies kept verbatim |
| `alias` | optional: the short name of a build whose `id` is not a valid build name (made before build-id@1); `findBuild` and every orchestrator / pipeline command accept it |

**StepRecord** = orchestrator@1 step fields (`id`, `text`, `model`, `why`, `phase`, `group`, `estimate`, `files`, `checks`,
`session`, `agent`, `skip`, `done`, `doneAt`, `note`) plus `uid` (never changes, also across a harvest), `title` (rename),
`rev`, `createdAt`, `updatedAt`, `origin { build, step, how: divided | harvested }`.

Statuses: `pending running waiting blocked failed complete archived`. Step models: **`Fable` or `Opus` only** (model
policy `framework/core/model-policy.mjs`; a legacy `[Sonnet]` prefix reads as Opus).

## Invariants (`validateStore`)

- `$axf` is `builds@1`; `rev` a whole number; builds a list.
- Build ids unique; a build has an `order` in every profile in `profiles`; `kind` build | epic; `rev` ≥ 1; ISO timestamps.
- Live step `uid`s unique across the whole store (a harvested step keeps its uid and leaves its source build); step ids
  unique within a build; every step `Fable` or `Opus` with text.
- Ids never change: renaming changes `title` only.

## Build ids (build-id@1, `framework/core/build-id.mjs`)

A build's `id` names its worktree folder (`<worktrees>/<id>`), its branch (`claude/<id>`), its tmux session and log, and
is what axHub's `vps.build_start` / `build_land` / `build_stop` / `build_clean` take. Those accept only
`^[a-z0-9][a-z0-9-]{0,39}$`, so every new id is at most **40 characters**. The `title` is the display name and has no
length limit; it is shown everywhere a build is named.

- `shortBuildId(title)`: lowercase slug; when it is over 40 characters, filler words (a, the, and, of, in, …) are
  dropped, then it is cut at the last dash that fits. `uniqueBuildId(title, taken)` adds `-2`, `-3`, … inside the same
  40 characters on a collision.
- Every id maker uses it: `pipeline.mjs request`, the orchestrator's `add` / `import`, a harvest, the Pending list and
  Plan Studio. Adding the same title (or id) again is still refused by the orchestrator; two titles that only meet once
  shortened get a suffix.
- Builds made before this rule keep their ids (their branches and PRs are not renamed) and get an `alias` that is a
  valid build name: the tick sets it for builds that may still run or land; `pipeline.mjs aliases [--apply] [--all]`
  lists or sets it for any. `pipeline.mjs land-alias <id|alias|folder>` is the landing path: it links
  `<worktrees>/<alias>` to the build's folder and points the local branch `claude/<alias>` at the build's branch, so
  `vps.build_land` (and stop / clean) can be called with the alias. Run it again right before landing to move the
  branch to the latest commit.

## Landing: generated and additive files never stop a land

Most Nov 13 2026 land failures were clashes only in generated or additive files. One manifest, `generated-files@1`
(`framework/spec/generated-files.json`), now says which files a merge resolves by itself and how; every lander reads
it: the auto-land runner and the merge queue (the push banner plugin's `land/land-core.mjs`
`classifyPath` / `regenPlan` / `mergeJson3`, `land.mjs resolveConflicts`) and the `vps.build_land` resolver
(`framework/cli/land-resolve.py`, which `/opt/axf-batch/resolve.py` hands over to).

| Merge rule | Files | What happens on a clash |
| --- | --- | --- |
| `regen` | `apps/console-web/src/control/inventory.json`, `apps/*/src/assets/help/*.json`, `apps/*/src/axf/**`, `apps/*/axf.lock.json`, `framework/spec/fixtures/*.json`, `tracker.json` | main's copy is taken, then the generator runs once on the merged tree (control inventory, `help-coverage.mjs --sync`, `rebake.mjs apply apps/<app>`, `gen-fixtures.mts`, `tracker.mjs`) and its outputs join the merge commit. `rebake` is optional: an app with edited baked files keeps main's copy. |
| `union-json` | `framework/assets/help/*.json`, `framework/catalog/{status,libraries}.json` | both sides' keys kept (3-way by key; main wins a scalar clash) |
| `union-lines` | `framework/spec/PORTING.md` (THREADS, STATUS, decisions and logs were already unioned) | both sides' lines |
| `main` | `framework/plan/*.json`, `changes/`, `sessions/` copies | main's copy |

After regenerating, each generator's check and the manifest's `tests` (control inventory `--check`, project fixtures)
run on the merged tree; a red one stops the land with the reason. Only a clash in a real source file (anything the
manifest doesn't name) stops a land and goes to an agent. `land.mjs merge-main <build>` merges main into one build's
branch with these rules on demand (a re-land after a lander fix).

## Projections and absorbs

| Older list | Project | Absorb (after a change) |
|---|---|---|
| orchestrator@1 | `projectOrchestrator(store, profile)` | `absorbOrchestrator(store, profile, orch, { newerOnly })` |
| pending@1 | `projectPending(store, profile)` (Pending = a status) | `absorbPending(store, profile, pending, change, { newerOnly })` |
| build-queue@1 | `projectQueue(store, profile)` (the order of epics) | `absorbQueue(store, profile, queue, features)` |

Every writer (`orchestrator.mjs`, `pending.mjs`, `build-queue.mjs`, the console API, MCP tools, plugins) edits a projection
and absorbs it back under one lock (`withStore`). The old files are **read-only exports** regenerated after every write
(`$export` note inside); a file written by something else since the last export is a *foreign write*, absorbed
**newer-only** (adds and updates builds whose `updatedAt` is newer, never reverts or removes) before the next export.

The orchestrator export is a **repo file only for a profile the repo's `framework/plan/profiles.json` lists** (`all` →
`_claude/builds/orchestrator.json`, others → `_claude/builds/profiles/<id>/orchestrator.json`; `persist.mjs hasRepoExport`).
A profile registered only on the hub (a project's profile, e.g. `test-sandbox` from project-seed) exports into its
shared-data folder (`framework/plan/profiles/<id>/_claude/builds/orchestrator.json` under the data root) and never onto
main: `check-profiles.mjs` fails CI for any unregistered folder, and builds-live takes such a folder off main on the next
publish (Nov 13 2026, main-ci-red-test-sandbox-profile-export).

## Demo builds (demo-build@1, the test-build sandbox, Nov 17 2026)

The guided live demo (`framework/spec/LIVE-DEMO.md`) plays on throwaway builds. A demo build carries the tag `demo: true`
and an id that starts with `demo-`; the two always agree (`framework/core/demo-build.mjs`):

- **The tag comes from the id.** `normBuild` sets `demo: true` on every `demo-` id and leaves the field absent on every
  other build; a record can never be made a demo build by writing the tag, nor a demo build made real by renaming (ids
  never change). `validateStore` refuses a tag that disagrees with the id.
- **Every surface marks them demo-only** from the id alone: the orchestrator and Pending projections carry `demo`
  (read-only: an absorb never copies it), the queue projection's record carries `demo`, the dispatcher's plan marks
  demo launches and waits and lists `demo` ids, the auto-lander's build record carries `demo`, every alert about a demo
  build carries `meta.demo` and starts its title with `[demo]`, builds-live commit lines carry `[demo]`, and the console
  rows (`pipeline.mjs row`, the board rows) carry `demo`.
- **The guard.** A demo action is a store write made with `demo: true` in its meta (`withStore(fn, { demo: true })`,
  `builds-store.mjs set-status … --demo`, every act of a demo run). It may touch demo builds only: if any added,
  changed or removed build is not a demo build, the whole write is refused (`DemoGuardError`, code `not-demo-build`,
  nothing saved). `builds-store.mjs demo <build>` answers the guard for one build (exit 1 when refused), and `verify`
  counts the demo builds.
- **The other way is open.** A demo build is an ordinary build to everything else (queue, dispatch, crash, watchdog,
  lander, escalation), so the demo shows the real pipeline.

**Migration:** none. Older records load unchanged: a `demo-` id gets its tag on read, anything else never does, and no
build in the store carried the `demo-` prefix before this rule (new ids are made by the orchestrator from titles; a
title starting with "demo" would have to be given on purpose). The store file is rewritten with the tag on the next
write, as any other normalization.

## Versioning

Every write: store `rev` + 1, changed records `rev` + 1, one line in the journal (`<YYYY-MM>.jsonl`) with each
changed build before and after (`diffStores`). At 80 MB a month rolls into `<YYYY-MM>-p2.jsonl`, `-p3`… (GitHub refused a file
over 100 MiB while the journal was a repo file, which would have stopped every live status commit; the parts stay so a
read never opens a multi-GB file); a full part is never rewritten and history reads them all. `builds-store.mjs history <id>` lists revisions, `restore <id> <rev>` puts
a build back (itself a journalled write). Removals are soft; a record missing from a written state is put back deleted.
Where the journal files live: *Journal home* below.

Journal lines (Nov 21 2026, `framework/plan/builds-journal-core.mjs`): an add, delete or restore holds the build whole
(`before`, `after`). A change to an existing build holds a diff (`{ id, op, rev, base, hash, diff: { set, unset, append,
steps } }`: changed fields, list items added at the end, changed steps), with a full copy every 20 revisions of the
build. A build's `journalHash` is the hash of the record as its last journal line left it; when the record no longer
matches (a whole-record put, a writer from before the diffs), the next line is whole, so a diff always has its base in
the journal. `history`, `restore` and the build-hook replay rebuild every revision; a diff whose base line is missing
is reported as not restorable, never guessed. `builds-store.mjs journal rotate [--days 30] [--apply]` gzips local parts
older than 30 days (`<part>.jsonl.gz`, read like the plain ones); it also runs when a write opens a new part.

Old writers (Nov 21 2026): `normBuild` is a whitelist, so a session on an older checkout used to write builds back
without the fields it did not know (a Pipeline 2.0 build's `planning`). The IO layer now carries every field it does not
know through each read and write (store, build, step; `keepStore`), and stamps `storeVersion` on the store: a checkout
whose `STORE_VERSION` is lower is refused (`stale_checkout`) until it pulls main. Raise `STORE_VERSION` when a release
changes what a stored field means.

Text transport: every helper that reads a request from stdin or a socket decodes it once (`framework/core/clip.mjs`
`readText`), never chunk by chunk; `clip(text, n)` cuts without splitting an emoji. `builds-store.mjs repair-mojibake
[--apply]` puts characters lost to U+FFFD back from the journal.

## Journal home (builds-journal@1)

Status: designed Nov 17 2026 (build `stop-auto-lander-committing-tracking` s1, Fable); implemented by its steps s8–s10.
Until they land the journal is the repo folder `_claude/builds/journal/` (911 MiB, 13 parts, committed, rewritten by every
live status commit and dragged into build branches by the auto-lander). After them it is **shared data on the hub**, and
the repo carries a pointer with checksums. Operator notes and the migration order: `_claude/builds/README.md` → *The
journal leaves git*. No Python or Kotlin twin: one writer (the CLI), build tooling only.

### Home

| Setting | Journal folder | Mode |
|---|---|---|
| `AXF_BUILDS_STORE=<file>` | `<file minus .json>.journal/` | test (unchanged) |
| `AXF_BUILDS_JOURNAL=<dir>` | that folder (`off` = spool) | explicit |
| `persistRoot()` non-null (`/projects` mounted or `AXF_DATA_DIR`) | `<root>/builds/journal/` → `/projects/amberx-axf/_data/builds/journal/` | **hub** |
| otherwise | `<repo>/_claude/builds/journal/` (git-ignored) | **spool** |

`journalDir()` in `framework/cli/builds-store.mjs` is the one resolver; every reader and writer (`journal()`, `journalOf`,
`restoreBuild`, `verify`, `build-hooks.mjs journalEvents`, `builds-live.mjs`) goes through it. File names, the 80 MiB
`journalPart` roll-over and the line format do not change. Appends take `<journal dir>/.lock` (mkdir-style `lock()`, 30 s
stale), shared by every checkout on the machine, and a new file takes the folder's owner and mode (`writeKeepingOwner`).

### Pointer: `_claude/builds/journal.json`

```
{ $axf: 'builds-journal@1', home: 'hub' | 'repo', dir: 'builds/journal', updatedAt, storeRev,
  parts: { '<YYYY-MM>[-pN]': { bytes, lines, sha256, sealed, firstAt, lastAt } } }
```

- `home: 'repo'` (or no pointer) = pre-migration: parts are repo files. `home: 'hub'` = the contract above.
- **Sealed part**: `journalPart` has moved past it, or its month is over. Never appended again; `bytes`, `lines`,
  `sha256` are exact and final.
- **Open part**: the entry is a floor as of `updatedAt`: the file is at least `bytes` long, has at least `lines` lines,
  and the first `bytes` bytes hash to `sha256` (sound because the file is append-only under the lock).
- Written by the live publisher (`builds-live.mjs publish`) in the same status-only commit as the store, from the hub
  files it can see; it re-hashes only a part whose size changed since the last publish (cached in `store.json.live.json`).
  A checkout in spool mode never writes it.
- Merge: `axf-builds` driver, per part key: union of keys, the entry with the higher `lastAt` wins (a sealed entry beats
  an open one for the same key). In `BUILDS_PATHS`, the lander's `BUILDS` class and the tracking-paths list.

### Reads

- `history <id>` / `restore <id> <rev>` / `journalOf`: every part in the home, newest first, plus spool lines not yet drained.
  Spool mode says so in the output (`journal home not reachable: N local line(s) only`); `restore` refuses a revision it
  cannot see rather than guessing.
- `verify`: besides the store checks, with `home: 'hub'`: every pointer part exists; sealed parts hash exactly; the open
  part meets its floor; every spool line is present on the hub. Hub not mounted → `journal: not checked (hub not mounted)`
  as a warning (exit 0). A sealed part that fails its hash is a failure (exit 1) and a systems check item.
- `check-builds-store.mjs` and `check-builds-live.mjs` run on a test store (`AXF_BUILDS_STORE`), so CI needs no hub and no
  70 MiB files; `check-builds-live` asserts the status commit carries `journal.json` and **no** `journal/*.jsonl`.

### Writes

- Hub mode: `journal()` appends to the hub part directly. The live publish no longer puts journal lines on main (the
  `journalExtra` / `journalSizes` / per-part `files[rel]` path in `publish`, and the journal half of `pullFrom`,
  `toConsole` and `syncAll`, go away); it refreshes the pointer instead.
- Spool mode: `journal()` appends to the spool. The live flush drains the spool through the console API
  (`POST /journal/append` on the build-orchestrator plugin, plugin-commands@1 → REST, MCP `journal-append`, CLI
  `axf build-orchestrator journal-append`, voice), which appends on the hub under the lock and returns the part key;
  lines leave the spool only after the hub took them (direct or API). Unreachable = they wait like the live outbox;
  `builds-live.mjs status` reports `journal spool: N line(s)`, and *Builds reach main live* turns amber after 15 min.
- The same plugin exposes `GET /journal/history/{id}`, `GET /journal/verify`, `POST /journal/restore` so every journal
  action works from the console, MCP, CLI and voice without a checkout (API parity rule, Nov 8 2026).
- A build worktree never stages the spool or the pointer on its branch: the spool is git-ignored and the pointer is
  written only by the publisher's private index onto main.

### Migration (once, VPS, `builds-store.mjs journal migrate --dry | --apply`)

1. Per repo part: `mergeJournalText` union of the repo copy, any hub `_data` copy and the stale claude-sync copy at
   `/projects/amberx-axf/_claude/builds/journal/` → written to the hub home.
2. Seal full and past-month parts, hash all, write the pointer, run `verify` (every repo line must be on the hub).
3. `git rm --cached` the parts; `_claude/builds/journal/` into `.gitignore`; `.gitattributes` swaps the `journal/*.jsonl`
   line for `journal.json`; one commit on the build branch. `md-studio` keeps skipping the folder.
4. Prune the stale hub `_claude/builds/journal` copy (hub delete = axHub veto call with a reason) and keep claude-sync from
   carrying the spool there.
5. `--apply` refuses to run when the pointer already says `home: 'hub'`; `--dry` writes nothing.

### Deferred

- Git history still carries the 911 MiB; a rewrite needs a force push and a re-clone of every checkout and worktree, so
  it is Brett's call (Pending item `shrink-git-history-drop-old-builds`).
- `history <id>` scans every part; a per-build index (`<journal dir>/index/<id>.jsonl`, rebuildable from the parts) is
  the next step when reads get slow.
- A `builds-journal@1` JSON Schema under `schemas/json/` (the pointer validator in builds-store is the contract today).

## Steps view ops (draft until Apply)

`reorder-steps`, `reorder-builds`, `rename-build`, `rename-step`, `rename-profile`, `divide-step`, `harvest` (selected steps
→ 1..N new builds, `origin` kept), `restore-default`. `addDraftOp` tries the whole draft on a copy first, so an op that
cannot apply is refused when added; `applyDraft` / `applyNow` refactor the builds and set status from the steps
(`complete` when every non-skipped step is done, `running` when some are).

## Migration

`migrate(sources)` builds the store once from every older data set (orchestrator wins for steps and status; pending items
merge into their build or become records; repo and hub copies unioned, newer `updatedAt` wins, the other kept in `copies`;
queue epics become `kind: epic`; items only in git history come in **archived** and tagged recovered).
`verifyNothingLost(sources, store)` is the proof, run by the dry run, the real migration and `verify`.

## Deferred

- A `builds-store@1` JSON Schema under `schemas/json/` for editors (the validator above is the contract today).
- Writes do not go through `axhub.memory_write`; the hub sees them through claude-sync (the journal is the history).
