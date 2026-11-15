# Shipped features: organized, sortable table with more columns

Build `shipped-features-organized-sortable` · Phase 1 · Opus · branch `claude/shipped-features-organized-sortable`

Brett said (2026-11-15 12:09, verbatim):
> The shipped features table is straight up trash, you better organize that, make it sortable with more columns

## What changed

- **One table on the shared grid** (lib-datagrid). Rows come from `plugins/shipped-features/ledger/table.mjs`
  (shipped-table@1). The grid, REST, MCP, CLI and voice all read that one projection.
- **Organized.** Grouped by plugin / area by default. You can also group by date, build, PR, status or nothing.
  Group headers fold and show counts per status. Repeated rows (same area and name) are folded into one row, which
  keeps every PR and build. The header shows how many were folded.
- **Sortable.** Tap a header to sort, and tap again to reverse it. Shift-click a header, or use the header menu's
  "Then by" (long-press on a phone), to add more sort keys. Headers number the keys 1, 2, 3.
- **16 columns:** feature, plugin / area, description, status (Live, Behind a switch, Partial, In progress,
  Removed), build (link), PR (link), commit, shipped (date + time), on main, deployed, how to reach it (icons for
  deep link, REST, MCP, CLI and voice), settings key, help, version, who asked (Brett's words) and tests
  (pass / total from the shipped manifest). The column picker shows, hides and reorders them, and Reset brings back
  the defaults.
- **Find and export.** Search, filter chips (status, has API, not deployed), a plugin picker, a date range, a row
  count with the active sort, and Export CSV (exactly the rows and columns on screen).
- **Rows.** Each row expands to show status, reach, settings, tests and version. Below that it shows Brett's
  words, builds, PRs, the edits timeline and the shipped manifest. Right-click or long-press a row or a cell to
  open the feature, open the build, open the PR, copy the link, copy the value or mark it removed. The Build cell
  also shows the Build orchestrator's own menu items through the shared `axf-build-item` target.
- **Remembered per viewer (this browser):** group, sorts, columns, column order, filters, folded groups and open
  rows.
- **lib-datagrid changes in the framework, for every grid:**
  - `sorts` for multi-sort, with `onSort(col, { add })`
  - `order` for column order
  - `lines` and the new `two-line` part (on by default; each column's `sub` becomes a second line)
  - `GridColumn.cellCtx` for a per-cell context menu
  - the control target state now includes `sorts` and `lines`

  The Android twin is recorded as a deferred gap in `framework/spec/PORTING.md`.

## How each part is reached

| What | Deep link / UI | REST | MCP / voice | CLI |
| --- | --- | --- | --- | --- |
| Open the table, focus a feature / build / PR | `?shipped=<id>`, action `shipped-features.show:<id>` | — | console action `shipped-features.show` | — |
| Read the table (group, sort, filter, columns) | the grid; control target `grid:shipped-features` (state: rows, groups, columns, sorts, lines) | `GET /api/plugins/shipped-features/table?view=<json>` | plugin command `table` ("which features are not deployed, newest first") | `ledger.mjs table --view '<json>' [--json]` |
| Set the view in the open table | header taps, picker, chips | — | console action `shipped-features.view` (JSON or `by=area;sort=shipped:desc,pr:asc;statuses=live`) | `axf` console action |
| Export CSV | Export CSV | `GET /table?kind=csv&view=…` | `table` with `kind=csv` | `ledger.mjs table --csv` |
| Mark removed | row / cell menu | `POST /remove { feature, by }` | plugin command `remove` ("mark the old banner removed") | `ledger.mjs mark-removed <id>` |
| Row menu actions | right-click / long-press | — | console action `shipped-features.row:<open|build|pr|link|cell|remove>:<id>` | — |

## Tests

- `node apps/console-web/plugins/shipped-features/test.mjs` (Node 22): 13 checks pass. New ones cover row folding,
  ship status, reach, tests from manifests, multi-sort, every filter, groups, view normalising, CSV, and the CLI
  `table` / `mark-removed` path.
- `python3 apps/console-web/plugins/shipped-features/test.py`: 32 checks pass. New ones cover `GET /table` (JSON
  and CSV, bad view refused) and `POST /remove` (works, unknown feature refused).
- `tsc --noEmit` is clean. These checks are green: check-theme, check-controls, check-toolbars, check-chrome-assets,
  check-console-control, and `control-inventory --check`.

## Screenshots

`_claude/builds/reports/shipped-features-organized-sortable/shots/`, desktop (1440) and phone (412):
- default grouped by area
- grouped by status with a two-key sort
- column picker open
- one row expanded

Made by `shoot.mjs` next to them: vite preview of this worktree, with the plugin's `/ledger` answered from a
sample ledger. The full console can't be shot headless here because the browser can't reach axHub.

## UI Review

Not submitted: this headless session has no console URL or token (`AXF_CONSOLE_URL` / `AXF_TOKEN`). Submit with:
`node apps/console-web/plugins/ui-review/review.mjs submit --kind screen --name "Shipped features table" --app console-web --screen shipped-features --group "shipped-features-organized-sortable - Nov 15 12:35 PM" --shots <the 8 shots> --branch claude/shipped-features-organized-sortable --pr <n> --console`

## Notes and open items

- **The 1-or-2-row setting is the datagrid's `two-line` part** (on by default, so the console shows 2 rows). An app
  that lists its datagrid parts without it gets one line. A true per-skin token for row lines would be a
  component-tokens engine change, so that would be a Fable follow-up.
- **The "shared status badges" are the framework Chip tones** the Pending tab build uses. Its PendingRow is plugin
  code, so it can't be imported across plugins.
- **"How to reach it" is a guess** from the feature's tags (`api`, `rest`, `mcp`, `cli`, `voice`, `deeplink`) and
  then the files it touched. "Behind a switch" comes from a `behind-switch` / `flag` / `switch` tag.
- **Version** is the feature record's revision.
- **Settings key** is the plugin's settings tab (`plugins.<plugin>`).
- **"Mark removed" is one-way.** The ledger treats Removed as an end status, and the row and its history are kept.
- **Landing:** per the rules, this branch does not merge itself. The merge queue lands it.
