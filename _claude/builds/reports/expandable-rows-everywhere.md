# Expandable rows, related links and row commands on every grid and log

Build `expandable-rows-everywhere` · branch `claude/expandable-rows-everywhere` · Opus · Nov 12 2026
Brett (Nov 11, voice): "They have expandable rows with all the information, with hooks to other stuff that's related. Commands, stuff I can do with it. All the grids and logs need that information."

## What shipped

**Framework (once, declarative): grid-row@1 in lib-datagrid.**
- `framework/libs/datagrid/rowkinds.ts` (pure store, no React): `registerRowKind({ kind, label, owner, aliases?, fields?, related?, commands?, title?, open?, load? })`, `extendRowKind(kind, { commands, related })` for a second module to add to a kind it doesn't own, `recordFields` + `fieldText` (every field, secrets redacted by name), `autoRelated` (links read from the fields every record shares: build, branch, PR number or GitHub PR URL, session, plan, account, employee, review, chat message, report, log, approval, change, expense), `relatedFor` (the kind's own first, deduplicated, never the record itself), `commandsFor` (`when`, `button`, `multi`), `runRowCommand` (multi ids, records the grids drew, skips rows a command doesn't apply to, asks before destructive ones, then `rowsChanged(kind)` so screens reload), selection (`setGridSelection` / `targetIds`), and the action wire `row.<kind>.<command>:<id>[,<id>…]`.
- `framework/libs/datagrid/rowdetail.tsx`: `RowDetail` (the screen's own detail, then Commands as a toolbar, Related links as chips that open **in place** as a card of the referenced record — fetched with the kind's `load` when it isn't on screen, one more level of links inside, an Open button to its own screen — then All fields), `RowCommandButtons`, `RowExpander` (cards and logs), `RowToggle` + `DetailTableRow` + `useExpandedRows` (hand-built tables).
- `DataGrid` now: `rowKind="…"` (instead of a `rowRef` function), `rows` for a flat table or log with no group header, `record`, `allFields`; a grid the screen gives no state keeps its own hidden columns, sort, expanded rows and selection, so **every row of every DataGrid expands** (chevron, tap, double-tap). Ctrl / Cmd / Shift-click (or "Select / unselect row" in the row menu) builds a multi-selection; a selection bar (`role="toolbar"`) above the grid offers the commands marked `multi`; right-click on a selected row runs a multi command on the whole selection.
- Every command is a console action `row.<kind>.<command>`, registered by lib-datagrid for every kind as it appears, so control@1 reaches it from the API, MCP, the CLI and voice with no extra code: `control_act console.actions row.build.hold {args:["<id>"]}` (or `{args:["a,b,c"]}`). A command's `control` field documents its server-side form where there is one (the orchestrator's `pipeline.mjs <action> <id>`, `orchestrator.mjs act step …`, `POST /api/status`). The `axf.row.ui` / `axf.row.select` menu actions are `personOnly` (a remote caller can't run them).
- Approve / Deny are deliberately **not** row commands anywhere (a row command is a remote-callable action); approval rows get Review / open-page / copy-id only.
- Theme tokens only, phone layout through `[data-fx-narrow|small|tiny]` (one column of fields, full-width command buttons). Checks: check-theme, check-controls, check-toolbars, check-chrome-assets all green.

**Merge log (branch `claude/auto-rebuild-failed-merges-r6`, running).** Nothing of it is pushed yet, so nothing to adopt today. To adopt: `<DataGrid rowKind="merge" …>` with `registerRowKind({ kind: 'merge', commands: [retry, open PR …] })` in its plugin; until it registers its own, `merge` is an alias of `build`, so a Merge log keyed by build id already gets the build's fields, Related (branch, PR, report, account, session) and commands. Its own registration wins over the alias.

## Every grid, table and log (inventory: `node framework/cli/check-grids.mjs --list`)

On the framework (kind → commands):

| Screen | Rows | Kind | Commands |
|---|---|---|---|
| Build orchestrator → All builds | DataGrid | `build` (alias `orchestrator`, `merge`) | Open, Queue it, Back to Pending, Hold, Release, Archive, Unarchive, Delete, Restore (all multi), Add a note, Copy build id |
| Build orchestrator → a build's steps | DataGrid (sub-grid) | `build-step` (`<build>/<step>`) | Tick done, Untick |
| Build orchestrator → Pending / Queue / Active / Incomplete / Complete / Errors / Archive / Deleted (pipeline) | cards + `RowExpander` | `build` | as above |
| Build orchestrator → Accounts | cards + `RowExpander` | `account` | Open Accounts tab, Run a health check; + Switch console, Sign in again, Settings (claude-accounts extends the kind) |
| Builds page (Builds, Steps) | DataGrid ×2 | `build`, `build-step` | as above |
| Build queue (Build manager view) | step rows + `RowDetail` | `queue` | Start, Mark built, Reworked, Reopen (multi) |
| Pending builds | cards + `RowExpander` | `pending` | Add a note, Copy id, Remove (multi) |
| Plan (feature tracker) | editor + `RowDetail` | `plan` | Open the tracker, Open the build queue, Copy id |
| Tracker | table + `RowToggle`/`DetailTableRow` | `tracker-item` | Mark planned / building / built / … (multi) |
| Changes & features | table | `change`, `plan` | (kinds' commands) |
| Codebase changes log | rows + `RowDetail` | `change` | Open, Close, Show again (multi), Copy id |
| Activity banner | rows + `RowDetail` | `activity` | Run its first action, Open its link, Close, Remove stuck (multi), Check now |
| Approvals banner (held + waiting) | `ApprovalRow` + `RowDetail` | `approval` | Review it, All approvals |
| Alerts (lib-alerts page) | rows + `RowDetail` | `alert` (alias `notification`) | Open its link, Mark seen, Resolve, Dismiss (multi) |
| Claude accounts (accounts, recent headless runs) | rows + `RowExpander` | `account`, `session` | as above |
| Chats (Chat viewer sessions) | DataGrid | `session` (alias `session-log`, `chat`) | Open the transcript, Copy session id |
| Crew (agents at work) | DataGrid | `agent-run` | Show in the Crew, Attach the terminal, Session history, Agent history, Stop it |
| Agent swarm → Agents, Build plan waves (was a raw table), Cost by agent / build / model / job | DataGrid ×3 kinds | `employee`, `swarm-job`, `build`, `swarm-model` | Employee card, Group chat, Build plan; Open Jobs, Cost tab, Copy run command |
| Console terminal → a chat's live feed | log lines + `RowDetail` | `feed-line` | Copy the line |
| Systems check | table + `RowDetail` | `system-check` | Check again (multi), Open the systems check |
| Plugin Manager (table view, lazy loader) | tables + `RowToggle` | `plugin` | Open in Plugin Manager, Open its UI, Open its settings |
| Session check-in | rows + `RowDetail` | `checkin` | Copy session id |
| Todos | table + `RowToggle` | `todo` | Edit, Done / not done (multi), Add a subtask, Delete (multi) |
| UI Review → Screenshots, groups | DataGrid ×2 | `screenshot`, `review-group` (alias `review`) | Open, Copy link, All screenshots |
| Shipped features | DataGrid | `feature` | Show, Sync |
| Feature matrix | DataGrid | `feature-matrix` | Open the matrix |
| Glossary | DataGrid | `glossary-entry` | Generate a demo, Add to a book |
| Toolbar actions designer (Basic filter) | DataGrid | `toolbar-action`, `toolbar-preset` | Show / hide, Remove, Add to the toolbar |
| Molly → Expenses ledger, Recent paydays | DataGrid ×2 | `expense` | Open the ledger, Read it (API), Export CSV, Copy id |
| axHub → Approvals | DataGrid | `approval` | Open its page, Approvals log, Copy id |

Frozen (`framework/cli/check-grids.baseline.json`, 36 files, each with its reason; counts may only go down): key/value summaries and settings forms laid out as tables (alerts routing matrix, token editor and API reference, veto pass scopes, AI usage totals, chat sliders, project-wizard docs, ports editor, build-queue progress), markdown renderers, the predicted-look mockup, the expenses HTML report export, the demo app, and the other apps' screens: axHub's tables (7), AmberX phone app grids and logs (7, Android on hold) and Walkthrough Studio (3). Those are the next adopters; the framework applies the moment a grid says `rowKind`.

There is no separate "file watchdog" grid in the console: the watchdog is a section owner (agent-swarm sections) and its events land in the Activity banner and the group chat, both covered.

## CI

- `node framework/cli/check-grids.mjs` (android.yml step + ci-scope): fails on a `<DataGrid` without `rowKind` / `rowRef`, a `<table` or `role="log"` in a file that never draws the expanded row, or a row kind used but registered by nobody with commands. Ratchet baseline with reasons; `--list` prints the inventory; `--update-baseline` keeps the reasons.
- `npx -y tsx framework/spec/check-rowkinds.mts`: 11 groups (aliases, fields + redaction, related + PR URLs + dedupe, records, command filters, run multi / skip / confirm / errors / rows changed, selection, the id wire with commas and colons, extend + orphan kinds, actionCommand, unregister). It caught a real bug on the way: a bare `token` field was treated as a count and shown; fixed.
- plugin-lifecycle: the grids baseline is a ratchet baseline like chrome-baseline (a removed plugin's line is not a stale reference).

## Verified

- `tsc --noEmit` clean: console-web, molly, axhub-web, amberx-droid, walkthrough-studio (the baked lib-datagrid / lib-alerts copies updated in all five).
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-grids, check-rowkinds, `axf validate --framework`, tracker --check, plugin-lifecycle on all 20 touched plugins (two pre-existing stale references on build-orchestrator and session-checkin, not from this build).
- In the browser (rebuild-shots, local API): 653 pending cards each with Details; expanding one renders Commands / Related / All fields; no render loop (about 3 DOM mutations a second, the page's own polling).

## Deferred / gaps

- Compose twin of grid-row@1 (placeholder `axf.datagrid.rowkinds.android`, PORTING.md). Android on hold.
- axHub tables, AmberX web plugins and Walkthrough Studio: frozen in the baseline, to adopt in their own builds.
- The orchestrator build steps are only on the API through the console action today; a server-side `planner.builds act step` exists in control@1 and is named in the command's `control` hint.
- The build was not in the orchestrator store (`orchestrator.mjs brief expandable-rows-everywhere` → no build), so steps could not be ticked.
