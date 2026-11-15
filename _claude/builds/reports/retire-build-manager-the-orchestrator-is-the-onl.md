# Retire the Build manager: the orchestrator is the only place that browses and manages builds

Build `retire-build-manager-the-orchestrator-is-the-onl`, Phase 1 (Opus), branch `claude/retire-build-manager-the-orchestrator-is-the-onl`.

## Brett said (verbatim, 2026-11-10 15:29)
> Get rid of build manager. Remove it. Uninstall it. If it has responsibilities, decide who to hand them to. The only thing that browses or manages builds is the orchestrator. Tabs: pending, active, incomplete, complete, errors, queue. He has to split it right away so the queue can show the steps. He'll plan what model, what account. When the time comes up in the queue he makes his final decision and updates which subscription took it. Subscriptions first, then any API. Every five minutes a background headless session that doesn't affect any builds or sign anything out checks all the accounts: can get in, have credits, can accept the Fable model.

## What changed
- **Build manager uninstalled** with its own uninstaller (`uninstall.mjs --all`): the plugin folder, its README / STATUS lines. `_claude/memory/docs/build-manager.md` is now a short stub that names who took over each job.
- **Who does what now:**

| Build manager did | Now |
|---|---|
| Remaining list, needs split, time left | Orchestrator tabs **Pending** and **Queue** |
| Start build now | `build-orchestrator.start:<id>`: puts the build in the Queue. The dispatcher is the only launcher. |
| Live (building now) | Orchestrator **Active** tab (shows the account that took each build); **Crew live** for every agent session |
| Built (time + cost) | Orchestrator **Complete** tab; headless run costs per build in **All builds**; Shipped features / What's shipped |
| Banner while building | Builds page banner (profile progress, animated while a build runs) |
| Search, context menu, app menu, `build-manager.*` actions | Orchestrator search provider, "Open in Build orchestrator", Builds menu entries, `build-orchestrator.open / tab / start` |

  Callers that used to point at the Build manager now point at the orchestrator: Activity holds, Build Breaker menu, Plugin Update, Systems check and the help pack.
- **Tabs:** Pending, Queue, Active, Incomplete, Complete, Errors (`tabOf()` in `framework/core/build-pipeline.mjs`), then Accounts, All builds, Approvals and Rules. Queue and Pending cards list every step with its model, plus the planned model and account.
- **Split right away:** a filed build is split on the dispatcher's next tick (every minute, as before). Right after the split the orchestrator records a **plan** (`pipeline.planned`: model, account, kind, why).
- **Final pick:** when a build's turn comes, the dispatcher tries the planned account first, then every other account that can take it: subscriptions first in Brett's order, then any API account. It moves on when a launch is refused and records `pipeline.account`, `pickedAt` and `tried` (the accounts that refused). The **Then any API** rule (`apiOverflow`) is now **on by default**. A build set to Subscriptions never goes to API.
- **Account order:** candidates sort by `order` (the Claude Accounts Manager drag-and-drop order from PR #448, read from the worker row or the pipeline's own account record). Until #448 lands, the old rules apply.
- **Account health every 5 minutes** (`pipeline.mjs health`; the tick starts it in the background, detached, with a lock):
  - One tiny `claude -p` call on Fable per account, on a private copy of its login in a temp folder.
  - Records sign-in / credits / Fable per account (`accounts.json` → `health`, the sweep in `health.json`).
  - Never touches the builds store, a slot, a worker claim or a running build.
  - A renewed token is saved back to the login's stores, so nothing is signed out.
  - A subscription login whose access token renews within 15 minutes is not called, so no running build is left on a spent refresh token.
  - `accountView()` uses fresh answers: can't sign in or no credits = not usable; Fable from health beats the older probe. Nothing is tested at dispatch time.

## How to reach it (API)
- Deep link / console: `nav:build-orchestrator`, `build-orchestrator.tab:<pending|queue|active|incomplete|complete|errors|accounts|builds|approvals|rules>`, `build-orchestrator.open:<build>`, `build-orchestrator.start:<build>`.
- REST: `GET /api/plugins/build-orchestrator/pipeline` (now with `tabs` and `health`), `GET pipeline/tab/{name}`, `GET pipeline/health`, `POST pipeline/health`.
- MCP / voice: plugin commands `pipeline-tab`, `pipeline-health`, `pipeline-health-now` (plus the existing pipeline commands).
- CLI: `pipeline.mjs tab <name>`, `pipeline.mjs health [--request]`, `pipeline.mjs set healthEveryMin=5 apiOverflow=true`.

## Tests
- `pipeline.test.mjs` 42 (new: tabs, routeOptions order, planFor, health classify / freshness / due), orchestrator `test.mjs` 33, `test.py` 31, `test_upgrade.py` 12, activity `test.py` 142, feature-matrix 13.
- `tsc --noEmit` clean. check-theme, check-controls, check-toolbars, check-chrome-assets pass.
- check-help 262, check-demo 243, check-refs 35, check-banner-hide 58, check-watch-live 67, lazy-loader-check 12.
- Fixed two failures I found on the way: the claude-accounts help entry had an invalid kind (`panel` → `card`), and `shipped-features` was missing from `KNOWN_BANNERS`.
- Still failing, not from this change: `check-builds-live` "healed branch has every step" (a git-merge fixture). `plugin-lifecycle check build-orchestrator` flags old references in `framework/cli/dispatch-gate.mjs`.

## Gaps
- **No screenshots.** In a fresh scratch browser the lazy plugin loader does not show the orchestrator view (no menu entry, and search lands on Settings), so `rebuild-shots` could not capture the new tabs. The UI is waiting for screenshots before UI Review.
- The Builds page plugin also browses builds. Brett named only the Build manager, so it stays; whether it should fold into the orchestrator is his call.
- Kotlin / Android twin: none (console-only plugin).
