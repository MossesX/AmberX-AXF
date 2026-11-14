# Orchestrator: Hold status, Archive tab, Deleted tab (deleted builds kept forever)

Build `orchestrator-hold-status-archive-tab`, Phase 1 (Opus), branch `claude/orchestrator-hold-status-archive-tab`. Amends `retire-build-manager-the-orchestrator-is-the-onl` (its tabs).

## Brett said (verbatim, 2026-11-10 17:07)
> Make a hold status. Anything in the queue you can send back to pending, leave in queue on hold, move to the archive, or delete. All completed builds go to the archive, add an archive tab. A deleted tab where all deleted builds stay saved forever.

## What changed
- **On hold** (`pipeline.heldAt / heldBy / heldWhy` on build-pipeline@1):
  - A held build stays in the Queue, in its place, with an **On hold** chip and the reason.
  - The dispatcher skips it until it is released. A Queue that holds only held builds does not raise the "stuck" idle alert.
  - Back to Pending drops the hold.
- **Actions on a build**, worked out by `actionsFor()` in `framework/core/build-pipeline.mjs`:
  - **Back to Pending**, **Hold**, **Release**, **Archive**, **Unarchive**, **Delete**, **Restore**.
  - A build with a live session (running, or waiting on an approval) is never archived or deleted.
  - Each card shows the buttons its state allows.
- **Archive tab:** every **complete** (merged) and **archived** build.
  - The **Complete** tab now holds only built builds whose PR has not merged yet. Once a PR merges, its build moves to the Archive.
  - Archiving a queued build takes it out of the Queue.
  - Unarchive sends a build back to Pending, or to built / complete when every step is done.
- **Deleted tab:** soft delete only. The record stays in the builds store for good, with `deletedAt` and a note. **Restore** brings it back.
  - A build deleted from the Queue comes back in Pending.
  - Nothing ever hard-deletes. The store already turned a dropped record back into a soft-deleted one. The new e2e test checks that an orchestrator write after a delete neither drops nor revives the build.
- **Bulk select:** each card has a Select box. Every build tab has a bulk toolbar (`role="toolbar"`) with Select all and one button per action, showing how many selected builds can take it.
  - Builds that can't take an action are refused one by one. The rest still go.
- **Fixed on the way:** the console's baked copy `apps/console-web/src/axf/core/build-pipeline.mjs` was older than the framework copy and had no `TABS` / `TAB_LABEL`, which the orchestrator's tab view imports. It is re-synced (`.mjs` + `.d.mts`). It is not in `axf.lock.json`, so rebake does not touch it.

## How to reach it (API), all four the same call
- **Deep link / console actions:**
  - `build-orchestrator.tab:archive` and `build-orchestrator.tab:deleted`.
  - `build-orchestrator.<unqueue|hold|release|archive|unarchive|delete|restore>:<id>[,<id>…]`.
  - The context menu on a build row offers the same actions.
  - App menu: Builds → Build archive, Deleted builds.
- **REST:**
  - `POST /api/plugins/build-orchestrator/pipeline/action` `{action, ids | id, why?}` → `{done: [{id, status, tab}], refused: [{id, error}]}`.
  - `GET pipeline/tab/archive` and `GET pipeline/tab/deleted`.
  - Every row carries `held`, `actions`, `deleted` and `deletedAt`.
- **MCP / voice:** the plugin command `pipeline-build-action` (new), and `pipeline-tab` with `archive` / `deleted`. Example phrases: "hold the icon browser build", "archive these builds", "restore the deleted toast build".
- **CLI:**
  - `pipeline.mjs hold|release|archive|unarchive|delete|restore|unqueue <id…> [--why w] [--by who]`.
  - `pipeline.mjs tab archive|deleted`.
  - `pipeline.mjs status` prints the Archive and Deleted counts.
- **State:** `GET pipeline` → `tabs.archive`, `tabs.deleted`, `plan.held` (held ids); the waits line says "on hold (who): skipped until released".

## Tests
- `pipeline.test.mjs`: 45 passed. New tests:
  - hold in `plan()`: skipped, not stuck;
  - `actionsFor` / `unarchivedStatus`;
  - an e2e run of hold → release → unqueue → bulk archive with a live build refused → unarchive → bulk delete → Deleted tab → an orchestrator write keeps it deleted → restore.
- Orchestrator `test.mjs`: 33 passed. `test.py`: 37 passed (new: `/pipeline/action` args, bulk ids, bad action / id / empty refused). `test_upgrade.py`: 12 passed.
- `tsc --noEmit` (console-web) is clean.
- check-theme, check-controls, check-toolbars and check-chrome-assets pass. `check-help.mts`: 262 checks pass.
- `plugin-lifecycle check build-orchestrator` still flags only the old references: `framework/cli/dispatch-gate.mjs`, plus this worktree's untracked brief files.

## Status (Nov 13 2026, s3)
- PR #463 merged on Nov 11 (merge commit `7c211d233`). The feature is live on main.
- Re-run on current main: `pipeline.test.mjs` 46 passed, orchestrator `test.mjs` 35 passed, `test.py` 41 passed, `test_upgrade.py` 12 passed.
- check-theme, check-controls, check-toolbars and check-chrome-assets pass.

## Gaps
- **No screenshots, so no UI Review submission yet.**
  - Tried: a scratch console via `rebuild-shots.mjs` on a copy of the builds store, with one queued build put on hold there.
  - Result: the headless browser stops at "Waiting for axHub". `https://axhub.amberxai.com` can't be fetched from the scratch origin.
  - The local `axhub-web` container needs a signed-in session the build does not have.
  - Shots needed: the Queue with the On hold chip and the bulk toolbar, the Archive tab and the Deleted tab, on desktop and phone. Shot file: `/tmp/axf-hold-shots/shots.json` on the VPS.
- Kotlin / Android twin: none (console only). Recorded in `framework/spec/PORTING.md`.
- Hiding builds is unchanged: hidden builds stay out of every tab, as before.
