# Orchestrator: On hold status and tab

Build `orchestrator-on-hold-status-and-tab` · Opus · branch `claude/orchestrator-on-hold-status-and-tab` · Nov 16 2026

## Brett said (verbatim)

> I need another group in orchestrator and state. I need to be able to set status of selected items in pending or any other table to on hold and move to new grid that can be moved back to pending, archive, queue, or delete

## What shipped

Hold already existed for queued builds (PR #463: hold/release, bulk select, Archive and Deleted tabs). This build reuses it and fills the gap:

- **Hold from any tab.** Pending, Queue, Active, Incomplete, Complete, Errors and Archive builds can all be put on hold (deleted builds can't). A running build has its tmux session stopped and its build lock released first, and waits On hold with status `pending`. If the host has no tmux (the console container), the dispatcher's next tick stops it (`pipeline.stopSession`).
- **Its own On hold tab.** Held builds leave their old tab and show in the new On hold tab (`hold`, between Queue and Active). The old tab is saved in `pipeline.heldFrom`. The bulk bar there has Release to Pending, Release to Queue, Archive and Delete (Delete asks to confirm). The build card shows when it was held, by whom, which tab it came from and why.
- **Nothing touches a held build.** The dispatcher skips it (this was already true for queued builds). The lander (`land-core.isCandidate`), the reconciler (`builds-reconcile.mjs`: no changes, but its PRs and branches still count as its own) and the sign-in-failure requeue all skip it too. Pressing Queue on a held build is refused; release it to the Queue instead.
- **Put on hold everywhere.** It's in every tab's multi-select bar and in the right-click / long-press menu on every orchestrator build row (row hook `build-orchestrator.hold`).
- **Group and state (s2).** The Groups board has a new **On hold** state (`held`). A group can be pinned as a tab next to On hold. Each group gets **Hold all** and **Release all** (release sends to Pending).

## How each one is reached (API parity)

| What | Console | REST | MCP | CLI / voice |
|---|---|---|---|---|
| Open the On hold tab | Builds → Build orchestrator → On hold; menu Builds → Builds on hold | `GET pipeline/tab/hold` | console_show `build-orchestrator.tab:hold` | `pipeline.mjs tab hold`; "open builds on hold" |
| Put on hold (one or many) | bulk bar / row menu | `POST pipeline/action {action:hold, ids}` | `pipeline-build-action` | `pipeline.mjs hold <id…> [--why]`; action `build-orchestrator.hold:<ids>` |
| Release back where it was | — | `{action:release}` | `pipeline-build-action` | `pipeline.mjs release <id…>` |
| Release to Pending / Queue | On hold bulk bar / card | `{action:release, to:pending\|queue}` | `pipeline-build-action` `to` | `pipeline.mjs release <id…> --to pending\|queue`; actions `build-orchestrator.release-pending` / `release-queue` |
| Archive / Delete from On hold | bulk bar (Delete asks to confirm) | `{action:archive\|delete}` | same | `pipeline.mjs archive\|delete <id…>` |
| Group Hold all / Release all | Groups board | `POST groups/{group}/action {action:hold\|release}` | `groups-action` | `groups.mjs act <group> hold\|release`; `build-orchestrator.group-action:<group>\|hold` |

## Files

- `framework/core/build-pipeline.mjs` (+ `.d.mts`, plus the console's baked copy and its `axf.lock.json` hashes): `hold` tab, `isHeld` for any status, `canHold`, `tabOfStatus`, `releaseStatus`, `RELEASE_TO`, the `heldFrom` and `stopSession` fields, and `canQueue` refuses held builds.
- `apps/console-web/plugins/build-orchestrator/pipeline.mjs`: `buildAction` hold/release/archive/delete, `stopHeldSessions` (runs right after a hold and on every tick), `release --to`.
- `server/__init__.py` (`to`, `hold` tab, group actions), `plugin.json` (MCP `to`, group `hold`/`release`, stage `hold`), `groups-core.mjs` / `groups.mjs` (the `held` state, `hold` stage, group actions).
- Web: `pipeline.tsx` (On hold grid, release buttons, delete confirm), `ui.tsx` (the tab), `index.tsx` (row hook, release actions), `menu.ts`, `groups.tsx`.
- `push-banner/land/land-core.mjs`, `framework/cli/builds-reconcile.mjs`: skip held builds.

## Checks

- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 54 passed (new: hold from every tab, `heldFrom`, `releaseStatus`, the lander skip, end-to-end hold/release `--to`, holding a running build).
- `groups.test.mjs` 8 · `test.mjs` 35 · `test.py` 47 · `push-banner/land/land.test.mjs` 110 passed.
- `tsc --noEmit` (console) clean. check-theme, check-controls, check-console-control, check-toolbars and check-chrome-assets all pass.

## Notes / left

- The console's baked framework copy is marked "edited" by `rebake.mjs status` because of older drift unrelated to this build. A full re-bake was out of scope, so only `build-pipeline.mjs` / `.d.mts` were copied over (they matched framework HEAD exactly before this build), and their lock hashes were updated.
- axhub-web, molly and amberx-droid still have older baked copies of `build-pipeline.mjs`. None of them uses the orchestrator UI, so they pick this up at their next re-bake.
- No screenshots: no built console was running in this session. The live preview was pointed at the tab (`axf focus`).
- Kotlin twin: none needed (console-only plugin).
