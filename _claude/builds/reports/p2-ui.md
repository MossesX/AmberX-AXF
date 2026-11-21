# Pipeline 2.0, part 4 of 4: p2-ui (status-driven table + drop store.json)

Branch `claude/p2-ui`. Pushed, not merged; it joins p2-status-core, p2-lander and p2-watchdog in one PR.
There was no build record for p2-ui in the store, so there were no steps to tick or link.

## What landed on the branch

1. **One table, no tabs.** The Build orchestrator page is `web/StatusTable.tsx`: builds as rows that expand to
   their steps. Columns: Build, Status, Steps (done/total), Model, Account, Slot, Timer, PR. Toolbar filters:
   status, account, model, date changed, words, show landed (`role="toolbar"`, labelled). The `TabGroup` is gone.
   Old tab ids still work as deep links, voice and console actions: `pending`, `queue`, `active`, `errors` and the
   rest map onto status filters (`ui.tsx` `TABS`/`openTab`).
2. **Badges.** One colour per contract status, mixed only from theme tokens (`status-table.css`). `failed` shows
   "failed, attempt N".
3. **Live timers.** Time in the current status plus total time. They tick on one shared 1 s clock, starting from the
   row's status `at`. Landed builds freeze. Steps show time in status, or the time they finished.
4. **Live updates.** `GET /table` (`status-table.mjs`) polls every 5 s while the page is visible.
   `since=<rev>` answers `unchanged`. Results are cached on the server for 4 s, so every open console shares one
   store read. Landed rows are only sent when a filter asks for them (219 rows / ~570 KB today instead of 631).
   The route is also registered as the read-only plugin command `status-table` (MCP / CLI / voice).
5. **Merge queue.** It is the same table and the same rows, read-only, filtered to `merging-pr` through
   `merging-main`. It shows up in three places:
   - its own view (`merge-queue`, Builds menu)
   - the `builds.merge-queue` slot, which the push banner's Merge queue settings panel now renders in place of its
     own queue state
   - the action `build-orchestrator.merge-queue`
6. **Settings.** Accounts, Watchdog status, Groups, Approvals and Rules were tabs. They are now panels under
   Settings → Plugins → Build orchestrator.
7. **store.json projection dropped.** `builds-store.mjs` no longer rewrites the console checkout's store.json after
   a cutover write (`projectConsole`, `consoleStoreFile` and `fileRev` are removed). New
   `apps/console-web/server/builds_store.py` is the one Python reader:
   - once cut over, it reads the axf-data tables. If they can't be reached it returns an error, never the stale file.
   - before the cut, it reads the file.
   - `AXF_BUILDS_STORE` points it at a test store.
   - results are cached for a short time.

   These readers moved onto the store:
   - activity holds
   - crew-live
   - ref-links (server and `refs.mjs`)
   - projects (build → project)
   - the orchestrator's focus ids
   - What's shipped (its feed fingerprint now follows the store, not a file mtime)
   - the Builds page (file watch and hooks)
   - the gate's `buildContext`
   - headless-context `noteRuns`
   - the launcher's `jobFor`
   - the console's `DATA_WATCH`

   Backup of the last file: `/root/axf-backups/store.json.final-20261119T024709Z`.
8. **Phone first.** On a phone the grid is a single Build column. Each cell carries the badge, steps, timer and PR;
   steps carry status, model, account, slot and their clock. Model, account and slot also show in the expanded row.

## Checks

- `status-table.test.mjs` 8/8; orchestrator `test.py` 64 (6 new for `/table`); orchestrator `test.mjs` 35;
  `toolbar.test.mjs` ok.
- push-banner 194; activity 142; crew-live 57; ref-links 19/19; whats-shipped 47; builds-page 14; gate 21 + 7;
  maintenance 96; agent-voice 41.
- Console server: projects 12; readcache 14; data_store ok.
- Specs: check-builds-store-data 10 (the cutover case now asserts that no projection is written); builds-live 69;
  data-store 68; headless-context 38; plugin-catalog 55; plugin-settings 10; ui-predict 12.
- check-theme, check-controls, check-toolbars and check-chrome-assets are all green.
- `npm run build` (which runs `tsc --noEmit`) is green.
- **Failing on main too, not caused by this branch:**
  - `check-builds-store.mjs`: "history reads the journal home" hits `spawnSync ENOBUFS` reading the live axf-data
    journal.
  - `check-build-hook.mjs`: the JavaScript heap runs out of memory.

  Both reproduce on `fede1fd89` in a scratch worktree.

## UI Review: waiting, but not visible to Brett yet

There is no `AXF_CONSOLE_URL` or `AXF_TOKEN` in this headless run. The two items (r-20261119-k2thv01 Builds table,
r-20261119-gvtsd01 Merge queue; group "p2-ui - Nov 19 12:45 PM") were written into the worktree, so Brett can't see
them. Shots are kept at `/root/axf-builds/_shots/p2-ui/` (desktop + phone, each view). To file them, run from a
session that has the token:

    node apps/console-web/plugins/ui-review/review.mjs submit --kind screen --name "Pipeline 2.0: one status-driven builds table" --app console-web --screen build-orchestrator --group "p2-ui - Nov 19 12:45 PM" --shots /root/axf-builds/_shots/p2-ui/status-table-builds-desktop.png,/root/axf-builds/_shots/p2-ui/status-table-builds-phone.png --branch claude/p2-ui --single-option "Brett's spec fixes the layout" --console
    node apps/console-web/plugins/ui-review/review.mjs submit --kind screen --name "Pipeline 2.0: merge queue, read-only view of the builds table" --app console-web --screen merge-queue --group "p2-ui - Nov 19 12:45 PM" --shots /root/axf-builds/_shots/p2-ui/status-table-merge-queue-desktop.png,/root/axf-builds/_shots/p2-ui/status-table-merge-queue-phone.png --branch claude/p2-ui --single-option "Same table, filtered to the merging statuses" --console

Regenerate the shots: `npm run build` then `node scripts/status-table-shots.mjs <dir>` in apps/console-web.

## For Fable review: contract changes and assumptions

1. **Contract duplicated on the UI side.** `web/status-table-core.mjs` has its own copy of the build and step
   status lists from the shared contract, plus `MERGE_QUEUE` and `TERMINAL`. Once p2-status-core's canonical module
   lands, this file should import it instead of keeping a copy.
2. **Field names the UI reads.** All of them are assumptions; p2-status-core decides.
   - The status `at`/`by` is read from `statusAt`/`statusBy`, else the last `statusLog[]`/`history[]` entry for the
     current status, else `at`/`by`, else `updatedAt`.
   - The attempt is read from `attempt`, else the length of `attempts`, else 1.
   - Steps: `status`, `model`, `account`, `slot`, `prNumber`, `at`, `by`.
   - Builds: `prNumber` or a PR number parsed from `pr`.
3. **The store strips the new fields today.** `framework/plan/builds-store-core.mjs` `normBuild` turns any status
   outside its old list into `pending`, and `normStep` drops step `status`/`account`/`slot`/`at`/`by`. Until
   p2-status-core widens both, the table shows older records through the legacy mapping (below), and a contract
   status written today would read back as `pending`.
4. **Legacy mapping** (older record → contract status):

   | Older status | Shows as |
   |---|---|
   | running, waiting | building |
   | queued | ready |
   | built | build-complete |
   | landing | merging-pr |
   | fixing, blocked, escalated | failed |
   | complete | landed |
   | archived, deleted | not on the table |

   Older steps: done → completed, or in-pr once the build is merging; the first open step of a building build shows
   as building.
5. **`GET /table` row shape** is new: `{ rev, updatedAt, profile, rows: [{ id, title, status, attempt, done, total,
   model, account, slot, prNumber, pr, branch, at, by, createdAt, updatedAt, steps: [...] }] }`, plus
   `{ unchanged, rev }` for `since`. It is also exposed as the MCP command `status-table`.
6. **Push banner merge queue.** The settings panel no longer shows the lander runner's own queue state (reorder,
   jump to front). That state belongs to p2-lander; `queue.tsx` and the banner chip are untouched.

## Left for the other parts (not my files)

- **store.json readers that remain:**
  - `push-banner/land/land.mjs`, `merge-queue.mjs` and `deploy/auto-lander/merge-main.mjs` (p2-lander) read main's
    `_claude/builds/store.json` with `git show`.
  - `build-orchestrator/watchdog/tables/builds.mjs` (p2-watchdog) still describes the store as projections.
- **builds-live** still publishes store.json to main as `[skip ci]` commits. That is the last copy of the file. To
  remove it fully: stop that publish, untrack the 14 MB file, and drop the `builds-store` tracking path. All three are
  cross-part, so they need one decision in the joint PR.
- The maintenance plugin's "proof" links still name `_claude/builds/store.json` as a path label.
- The orchestrator context menu drops the per-build actions that came from `/pipeline` tab rows. It offers Open,
  Retry (failed builds), Hold, Archive and Delete.
- The "Add a build" and "Import from Pending" forms are gone with the All builds tab: Plan Studio is the way in.
  The Queue button on the Builds toolbar is disabled, because a ready build starts by itself.
