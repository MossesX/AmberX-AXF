# Split builds pages: Build Manager = Pending + Complete; Orchestrator = Queued + Active

Build `split-builds-pages-build-manager-pending-complet` · Phase 1 · Opus · branch `claude/split-builds-pages-build-manager-pending-complet`.
Replaces `one-builds-page-pending-queued-built-tabs-remove` (marked superseded).

## Brett said (verbatim)

> Build manager will have pending and complete. Orchestrator will have active and queued. They need to be sent to the orchestrator, so they gotta be sent from somewhere.

## What changed

**Who owns what** (`framework/core/build-pipeline.mjs`, build-pipeline@1):
`homeOf(build)` → `manager:pending` | `orchestrator:queued` | `orchestrator:active` (running, waiting, blocked, failed) | `manager:complete` (built, complete).
The pipeline record gains `held` / `heldBy` (Hold / Resume) and `pin` (assigned account). `canReturn()` = queued or active but not running.

**Dispatcher** (`build-orchestrator/pipeline-core.mjs`, `pipeline.mjs`):
- A held build is never launched ("on hold (who): Resume to let it start"). A running build that is held stops after its current run.
- A pinned build only starts on its assigned account (`pinnedRoute()`), with the reason when it can't.
- New commands: `hold`, `resume`, `assign <id> <account|auto>`, `return <id> [--reason]`.
- When a run finishes, the build's note says "Sent back to Build Manager → Complete". When it is returned, the note says "→ Pending" and the hold and pin are cleared.
- `status` adds `table.active` and `table.complete`. Each row also carries `cost`, `builtBy` (the account of the last "Started run" note), `accounts`, `models`, `builtAt`, `mergedAt` and `held`.

**Build orchestrator page:** tabs are now Queued · Active · Accounts · Approvals · Rules.
- Queued and Active are DataGrids: one row per build, grouped by status. Columns: priority, status + Held chip, steps, model, assigned or actual account, route, queued/started, next.
- Opening a row shows its step subgrid, the build card and these actions: Hold/Resume, Back to Pending (with a confirm step and an optional reason), Runs on (route), Split now, and an Account picker.
- The old Builds tab (every build in one table), the Pipeline tab's Pending column and the Add/Import forms are gone.

**Build manager page:** tabs are now Pending · Complete (`build-manager/web/flow.tsx`).
- Pending: Add a build (title, Brett's words, details, priority), then edit, prioritise (priority tag) and **Send to orchestrator** from each row.
- Complete: grouped Awaiting merge / Landed. Columns: built-by account, model(s), recorded run cost, PR, steps, built date.
- The old Remaining / Live / Built / Sessions views were removed from the page. The banner stays.
- The server reads and writes only through `axf.build-dispatch@1`, which gained `tables()`, `update()`, `hold()` and `give_back()`. It never names the orchestrator's folder.

**Retired screens (they redirect):**
- The core `build` view (Build queue) → `builds.queued`.
- The core `pending` view (Pending builds) → `builds.pending`.
- The Builds page plugin's view → `builds.pending`. Its nav item is gone, its menu now lists Pending / Queued / Active / Complete, and its banner percentage links to Active.

## How each feature is reached (UI, REST, MCP/CLI, voice)

| Feature | Deep link (console_open / action) | REST | MCP + CLI + voice (plugin commands) | Shell |
|---|---|---|---|---|
| Pending / Complete | `build-manager.pending`, `build-manager.complete`, `builds.pending`, `builds.complete` | `GET /api/plugins/build-manager/flow` | `builds-flow` | `pipeline.mjs status` |
| Add / edit a pending build | `build-manager.pending` | `POST …/build-manager/flow/create`, `…/flow/edit` | `builds-create`, `builds-edit` | `pipeline.mjs request --title …` |
| Send to orchestrator | `build-manager.pending` | `POST …/build-manager/flow/send` | `builds-send` (also `pipeline-queue`) | `pipeline.mjs queue <id>` |
| Queued / Active | `build-orchestrator.open:queued` / `:active`, `builds.queued`, `builds.active` | `GET /api/plugins/build-orchestrator/pipeline` | `pipeline-status` | `pipeline.mjs status` |
| Hold / Resume | Orchestrator row | `POST …/build-orchestrator/pipeline/hold {id, on}` | `pipeline-hold` | `pipeline.mjs hold|resume <id>` |
| Assign account | Orchestrator row | `POST …/pipeline/assign {id, account}` | `pipeline-assign` | `pipeline.mjs assign <id> <acct|auto>` |
| Cancel / back to Pending | Orchestrator row | `POST …/pipeline/return {id, reason}` | `pipeline-return` | `pipeline.mjs return <id>` |
| Route | Orchestrator row | `POST …/pipeline/route` | `pipeline-route` | `pipeline.mjs route` |

Voice (AmberX) reaches the plugin commands, which are registered as plugin-commands@1 with `auto: true`.

## Checks

- `npx tsc --noEmit` (console-web): clean.
- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 37 checks, including new `homeOf`, held, pinned and CLI hold/assign/return checks.
- `node …/build-orchestrator/test.mjs` 33 · `python3 …/build-orchestrator/test.py` 31 · `python3 …/build-manager/test.py` 45 (new flow-route checks against a fake capability) · `node …/build-manager/test.mjs` 127 · `python3 …/builds-page/test.py` 14.
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`: pass. `plugin-lifecycle check`: build-manager and builds-page are clean. build-orchestrator has stale-reference warnings in `framework/cli/dispatch-gate.mjs` and local brief files; those were there before this build.

## Gaps / follow-ups

- **A running build can't be cancelled outright.** Hold it and it comes back after its current run; the dispatcher does not kill sessions.
- **Android/Kotlin twin:** none. No Kotlin build-pipeline twin exists, so nothing was added to PORTING.md for this build.
- **Other old builds screens are still in the code:** `views/BuildManager.tsx` and `views/Pending.tsx` are no longer routed but the files remain, and so do the Builds page's Steps view code and the Fable rebuilds list. Delete them once Brett has seen the split pages.
- **Styling is shared across plugins.** The Build manager grid reuses the orchestrator's `oc-*` / `pd-*` classes. With the orchestrator off, those cells lose their styling but still work.
- **UI Review:** shots were not taken in this headless phase (no browser on this run). Desktop and phone shots for both pages are still to be submitted.
