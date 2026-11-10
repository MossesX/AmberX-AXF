# Split builds pages, pass 3 (split-builds-pages-build-manager-pending-complet-3)

Brett said (2026-11-09 17:50):
> It doesn't have to be a single clean line... it can be a double wide row... make it look good, like a professional website. Pending isn't gonna have a timer. They should have dates, when they were started, how many steps, how many completed. The active ones need an animated thing in the row. Build manager: pending and complete. Orchestrator: active and queued.

## What changed
- **Pages:** Build Manager has two tabs, Pending and Complete (`build-manager/web/flow.tsx`). Build orchestrator has two tabs, Queued and Active, plus Accounts, Approvals and Rules (`build-orchestrator/web/pipeline.tsx`). The old Build queue and Pending builds screens now redirect (`src/App.tsx`, `RedirectTo`).
- **Rows:** each row is two lines tall, built from the shared lib-datagrid cells (`framework/libs/datagrid/cells.tsx`, mirrored into `apps/console-web/src/axf/libs/datagrid`): `CellTitle`, `CellDates`, `CellSteps`, `LivePulse`, `Elapsed`, `DetailSections`, `DetailFacts`, `DetailChecklist` and `DetailTimeline`.
- **Pending:** no timer. Each row shows the created and updated dates, steps done/total with a meter, priority, and a Send to orchestrator button.
- **Queued:** each row shows its queue position (#n), why it's waiting, the planned account and model, and its dates (created, queued, last run).
- **Active:** each row shows an animated pulse, a live elapsed timer, steps done/total with a moving meter, the current step and the account running it. The pulse stays still when the build is held or not running, or when the user has reduced motion turned on.
- **Complete:** each row shows the started, finished and merged dates, how long it took, cost, the account that built it, and the PR and land status.
- **Expanded rows:** a row opens into collapsible sections: steps, run/PR/cost, Brett's words and recent log lines.

## API (each feature is reachable the same way through REST, MCP, CLI and voice)
- **Build Manager plugin commands:** `GET /flow` (pending and complete lists), `POST /flow/create`, `POST /flow/edit`, `POST /flow/send`.
- **Build Manager deep links (actions):** `build-manager.pending`, `build-manager.complete`, `builds.pending`, `builds.complete`.
- **Orchestrator plugin commands:** `GET /pipeline`, `POST /pipeline/queue`, `/unqueue`, `/hold` (`on:false` resumes), `/assign`, `/return`.
- **Orchestrator deep link:** `build-orchestrator.open:<tab>`.
- **CLI:** `pipeline.mjs status | queue | unqueue | hold | resume | assign | return`.
- **Voice:** the commands carry voice phrases ("what's pending", "hold the … build").

## Checks
- `check-theme`, `check-controls`, `check-toolbars` and `check-chrome-assets` pass.
- `tsc --noEmit` (console-web) is clean.
- `pipeline.test.mjs` passes.
- `plugin-lifecycle check`: build-manager and builds-page are clean. build-orchestrator reports a stale-reference finding at `framework/cli/dispatch-gate.mjs:79`. That line is unchanged from main; the line this branch edited (78) already named the plugin folder before this change and still does.

## Not done
- **Screenshots (desktop and phone) for UI Review:** none taken. The headless console waits for axHub (the appearance source), and a local dev origin gets no hub session, so every capture shows the "Waiting for axHub" screen. Capturing needs a local hub on 127.0.0.1:18080 (as `rebuild-shots.mjs --env AXF_APPEARANCE_HUB=…` expects) or a hub sign-in.
- **Android/Kotlin twin:** none, per the no-new-Kotlin rule.
