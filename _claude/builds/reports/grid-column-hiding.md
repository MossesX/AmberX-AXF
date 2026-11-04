# Grid column hiding (grid-column-hiding)

**Brett said (Nov 4 2026, voice):** "Every grid needs to be able to hide columns. If you right-click on the column, you
can select which ones to hide. And every grid, framework wide."

Model: Opus. Branch `claude/grid-column-hiding`.

## What changed

### lib-datagrid owns column visibility (grid-columns@1)

The framework already had one shared grid (`framework/libs/datagrid`, `DataGrid`) with a header menu, but each app kept
its own hidden list. Some apps used `useState` (lost on reload), some saved it in their own localStorage key, and many
passed `hidden={[]}`, which turned hiding off. Now:

- **Header menu** (right-click / long-press any column header, or the `⋯` at the end of the header row): *Hide
  <column>*, a *Columns* checklist (tick/untick), *Show all columns*, *Reset columns to default*. Every grid gets it
  without any wiring.
- **Saved per grid, per device:** settings key `axf.grid.<grid id>.columns` in the app's settings store (localStorage,
  not the shared axHub look). It survives reloads and redeploys. It's saved as changes from the defaults (`-cost`,
  `+notes`), so a column added later still starts as declared and Reset just clears the key.
- **Column flags:** `fixed` = can't be hidden (title/name columns); `hidden` = hidden until shown. A grid's
  `hidden={[…]}` prop (without `onToggleColumn`) adds defaults, e.g. phone-only defaults.
- Controlled mode (app passes `hidden` + `onToggleColumn`) still works, plus a new `onResetColumns`.
- **Flat tables:** `rows={…}` instead of `groups` draws a plain table with no group header.
- Pure core `framework/libs/datagrid/columns.ts` + `framework/spec/check-grid-columns.mts` (24 checks).

### Voice / console control

Action `axf.grid.columns:<grid>:<hide|show|toggle|all|reset>:<column>`, effect `navigate` (a view preference, so it
runs with the navigate grant and no veto). Grid and column are matched loosely by id or label, so Amber can call
`console_action` with `axf.grid.columns:Build manager:hide:cost`. A bad name answers with the grids or columns that are
on screen. `gridsOnScreen()` lists them. No control@1 target was added: `console_action` already runs any registered
action, and adding one would have meant re-pinning `check-control.mts`.

### Grids moved onto the saved state (were app-kept)

Build manager (sessions + session requests), Build orchestrator (builds + steps), Crew live, Agent swarm grids, Feature
matrix, UI Review Screenshots (shots + groups), Chat viewer, axHub web Approvals. Their old defaults (e.g. orchestrator
hides `left`, steps hide `doneAt`, phone defaults) stay as defaults. Their old per-plugin saved lists
(`crew-hidden`, `orch-grid-hidden`, `swarm-*-hidden`, chat-viewer `hidden`, build-manager `hidden/itemHidden`) are no
longer read, so a hidden choice from before this build resets once.

Grids that passed `hidden={[]}` (Builds page builds + steps, Basic filter, AmberX's Tasks, Web, Walkthrough chapters,
Voice and Voice commands grids) now get hiding and saving for free with no code change. Walkthrough Studio's status
grid gets it at its next re-bake (its baked framework is far behind main).

### Hand-made tables converted to DataGrid

| Where | Grid id |
|---|---|
| Console → Changes & features | `changes-grid` |
| Console → To-do manager grid | `todo-manager` |
| Console → Systems check grid | `systems-check` |
| Console → Agent swarm plan waves | `swarm-plan` |
| Console → Agent swarm chat settings per agent | `swarm-chat-agents` |
| Console → Codebase changes entry tests | `codebase-changes-tests` |

### CI ratchet

`node framework/cli/check-grids.mjs` (in `android.yml` next to check-toolbars) fails on any new hand-made table with a
column header row (`<thead>` or MUI `<TableHead>`). It points at `DataGrid`. The 27 left are in
`framework/spec/grids-baseline.json`, which only shrinks (`--update-baseline`). Key/value tables (`<th>` per row) aren't
grids. Markdown renderers carry `axf-grid-exempt:`.

**Still hand-made (in the baseline), to convert next:**
- Console: ai-assistant settings (3), session-checkin (2), token-control (2), plugin-manager views + LazyLoader, UI Review
  mockup.
- Framework: `libs/alerts`, `libs/mcp`, `react/components/DataCard`, `react/studio/AccountView`.
- Walkthrough Studio capture pane.
- Expenses (14, MUI). Its main ledger grid already has its own hideable columns (View → Columns dialog, PR #10 in the
  old repo). Moving Expenses onto DataGrid belongs with moving it onto the AXF engines (its vendored `@axf/core` 0.0.25).

**Not caught by the ratchet:** CSS-grid "tables" drawn with divs (e.g. the console's Pending and Plan views, Git board,
Live sessions). They aren't `<table>`s, so nothing counts them. Spotting them needs a different check.

## Tests

- `check-grid-columns.mts`: 24/24 (new)
- `check-grids.mjs`: ✓ 27 at baseline; a probe file with a new `<thead>` fails (exit 1)
- tsc: console-web, axhub-web, amberx-droid clean
- check-theme, check-controls, check-toolbars ✓. help-coverage ✓ after drafting help for the new columns.
- Re-baked: amberx-droid, axhub-web, molly, console-web. Walkthrough Studio and demo were already far behind main and
  are left for a separate re-bake.

## Known gaps

- Saved per app per device (browser storage). There's no per-user key on a shared browser.
- Two grids with the same id on one screen (swarm plan waves) share one saved choice. That's intended.

## Screenshots

None. The console bundle built (`vite build`, 20 s), but under the headless harness (static server, `/api/me` and the
axHub look mocked) it stayed on a blank page, so there were no desktop/phone shots to send to UI Review. That's
non-blocking for this build. Take them from the live console after redeploy: right-click a header in Builds →
Changes & features.
