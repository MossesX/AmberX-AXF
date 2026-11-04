# fable-packager: Package builds (build-package@1)

Build `fable-packager` (profile current, Opus, 5 steps). Branch `claude/fable-packager`.

## What Brett said (verbatim, Nov 4 2026, voice)

> From the orchestrator, package Fable, or make a build package. You select all the things that are waiting to be built with Fable: you open up a dialog or a window to list them all, then you select them and combine them into a build, and then you either send the build to a helper or add it to your own orchestrator as its own build. So you can easily create just-Fable builds alone, prioritize them, and send them to another helper to be done immediately.

Addendum 1: "It doesn't have to be all the Fables sent. You need to be able to select all the Fable steps, and pick ones or select all. And every time something is sent, the orchestrator needs to re-analyze everything to make sure it's all in the correct order."

## What landed

- **Package builds window** (`apps/console-web/plugins/build-orchestrator/web/packager.tsx`): header button on the Build orchestrator, Builds menu entry, right-click on an orchestrator build or pending item, and two actions Claude / voice can run (`build-orchestrator.package`, `build-orchestrator.package-fable` = "package the Fable work").
  - Lists **every waiting step on its own**, grouped by source build (collapsible): unstarted steps of pending, running and waiting builds across all profiles, plus steps of Plan Studio plans marked ready (through `plans@1`). Not listed: done / skipped / already packaged / with a helper, and the step a running build is on right now (counted in a note). Builds without steps are named ("split them first").
  - Each row: tick, model chip (with the model-thinking audit's recommendation when present: `Opus → Fable`), thinking, estimate, areas, step id.
  - **Default filter model = Fable** (matches the step's model or the audit's recommendation); filters for model, thinking, area, profile, status, search.
  - Ticks per step, per group (tri-state), **Select all / Select none / Invert**; **All Fable work** only pre-ticks every Fable step and picks Send to helper + do it now.
  - **Package order** = priority: drag or arrows. Steps of one build always keep their own order (their slots stay where Brett put them, the steps refill them in source order), so dependencies hold.
  - **Dependency warning** for ticked steps whose earlier steps (same build, or `after`) aren't in the package, incl. "being built now", "in another package", "with a helper"; **Bring the prerequisites along** adds the selectable ones in front.
  - Name (suggested), model (keep each step's / Fable / Opus; raising Opus → Fable is flagged as an upgrade only Brett's click can approve), thinking (low / medium / high / max, model-advice@1's list).
  - Then **Send to helper** (helper picker, Do it now) or **Add to my orchestrator** (top, 2nd, 3rd, 5th, end).
  - **Nothing is made or sent before the ticked list is shown and confirmed** ("Package exactly these, in this order?"); the server refuses a package without `confirmed: true`.
- **Core** `web/packager-core.mjs` (pure, shared by window, CLI, server, tests): candidates, filters, facets, groups, selection ops, preset, move, keepDeps, dependencies, bringAlong, makePackage, confirmLines, packageEdges, **reanalyze**.
- **Store** (`framework/plan/builds-store-core.mjs`, builds@1, additive): step `packagedInto`, build `package` (`build-package@1`: thinking, model, sources, items, by, dest, sent), package steps carry `origin {build, step uid, how: 'package'}`. `addPackage` (one write: package build at a queue position + every source step marked; refuses gone / done / packaged / helper steps and an upgrade without Brett), `removePackage` (unpackage while nothing is done), `reorderProfile`, and **`syncPackaged`**, run on every store write by `withStore`: ticking a package step ticks its source step in the same write; a package that is removed or archived lets its open steps go back. So every store, export and screen updates in one transaction, and builds-live pushes it to main.
- **Orchestrator core**: a source build skips packaged steps (next step, brief), shows "packaged into X" on them and refuses ticking them there; when only packaged steps are left, its brief says to wait for the package. Package builds show a note (sources, thinking, where sent) with **Send to helper now** and **Unpackage**.
- **CLI** `packager.mjs`: `candidates`, `preset`, `package`, `reanalyze [--apply]`, `unpackage`, `mark-sent`.
- **Server** (`/api/plugins/build-orchestrator/package/...`, also MCP / CLI / REST commands through plugin-commands@1): `GET package/candidates`, `POST package`, `POST package/{id}/send`, `POST package/{id}/unpackage`, `POST package/reanalyze`.
  - **Owner-only on the primary**: a secondary session (Session sync's `role_of`) is refused with 403 server-side and gets an empty listing (the window hides itself); Brett's click is always the owner.
  - **Send to helper** = one whole-build offer through capability `axf.session-sync@1` `offer({build, mode: 'whole', to, reason, priority: 'now'|'normal'})`; the package records where it went (`package.sent`, note).
  - **Re-analyze after every package and every send**: this orchestrator's order (`reanalyze --apply`: a package goes after the builds whose earlier steps it needs and before those whose later steps need it; running and pinned builds never move; both-ways pairs are reported as side by side), then Session sync's `replan()` when it offers one.
  - **Breakroom Sessions channel**: one line per package (where it went + its numbered steps) through `axf.crew@1` `post` with `channel: 'sessions'`.

## Depends on handoff-2 (not merged yet)

handoff-2 (`claude/handoff-2`, running) is building Session sync. This build uses only its contracts, through capabilities, never its folder:

| Needed from `axf.session-sync@1` / `axf.crew@1` | Status on handoff-2's branch | Without it |
| --- | --- | --- |
| `link()`, `role_of(session, account)` | there | everyone is the primary |
| `offer(req, who)` (the one handover transaction, spec/HANDOFF.md § 4-5) | **not yet a capability method** (REST/CLI `offer` exists) | Send to helper says why and the package stays in this orchestrator |
| `replan(req, who)` | **not yet a capability method** (REST/CLI `replan` exists) | only this orchestrator's re-analysis runs |
| `axf.crew@1.post` with `channel` | there (handoff-2 s5) | nothing is posted (the answer says so) |

A note on handoff-2 asks for `offer()` and `replan()` on the capability (thin wrappers over its `_run('offer'|'replan', args, who)`). The shared multi-select list of handoff-2 s8 doesn't exist yet: the window uses the framework `Checkbox` (tri-state for groups) and can switch to the shared list when it lands.

## Tests

- `node apps/console-web/plugins/build-orchestrator/test.mjs`: 30 → **40** checks (candidates and exclusions, default Fable filter + audit recommendation, select all / none / invert / group, preset, keepDeps + move, dependencies + bring along, makePackage + upgrade listing, addPackage refuses an upgrade without Brett / marks sources / top position, source build skips packaged steps and refuses ticking them, syncPackaged both ways + unpackage, re-analyze moves, side-by-side conflicts, running build never moves).
- `python3 apps/console-web/plugins/build-orchestrator/test.py`: 5 → **17** checks (role gate incl. Brett's click, 403 for a secondary, helpers list, send = one offer with priority now, mark-sent, refused offer says why, no Session sync = stays here, Sessions channel line).
- `node framework/spec/check-builds-store.mjs` 37 passed, `check-builds-live.mjs` 47 passed, `check-theme`, `check-controls`, `check-toolbars`, `menu-reach`, `help-coverage --check` (18 new help entries), `plugin-commands check`, console `tsc --noEmit` clean, server part loads (`main.PLUGINS`).

## Screenshots

`_claude/builds/reports/fable-packager/shots/` (desktop 1440 and phone 412, real store data, Session sync mocked as present): the orchestrator header with **Package builds…**, the window with **All Fable work** ticked, the order + destination, and the confirm list. Sent to UI Review (non-blocking).

## Known gaps

- Send to helper waits on handoff-2's capability methods (above).
- Plan steps are marked on their plan (`packagedInto` + a link) but don't mirror done back into Plan Studio.
- The grid view of the orchestrator shows package builds as rows; the package note (sources, Send, Unpackage) is on the build's card.
