# lib-datagrid

The framework's one grid (`library@1` `ai.amberx.axf.datagrid`). Every grid in every app uses it: grouped or flat rows,
sort, expandable rows, row hooks, drag, datasets, and **hideable columns**.

## Hiding columns (grid-columns@1)

Right-click (or long-press) any column header, or tap the `⋯` at the end of the header row:

- **Hide <column>**: hides the one you pressed on
- **Columns**: a checklist of every column; tick to show, untick to hide
- **Show all columns**
- **Reset columns to default**

The choice is saved per grid in the app's settings, under `axf.grid.<grid id>.columns`. It's kept per app and per
device (browser storage), never in the shared axHub look, and survives reloads and redeploys. It's saved as changes from
the grid's defaults (`-cost`, `+notes`), so a column added later still starts the way the grid declares it.

```tsx
import { DataGrid, type GridColumn } from '../axf/libs/datagrid';

const columns: GridColumn<Row>[] = [
  { id: 'title', label: 'Title', fixed: true, width: 'minmax(calc(var(--fx-space) * 20), 3fr)', render: (r) => r.title }, // can't be hidden
  { id: 'cost', label: 'Cost', width: 'calc(var(--fx-space) * 10)', render: (r) => r.cost },
  { id: 'notes', label: 'Notes', hidden: true, width: '1fr', render: (r) => r.notes },                                // hidden until shown
];

<DataGrid id="my-grid" label="My grid" rows={rows} columns={columns} rowId={(r) => r.id} />        // flat table
<DataGrid id="my-grid" label="My grid" groups={groups} columns={columns} rowId={(r) => r.id} />    // grouped
```

- `hidden={[…]}` without `onToggleColumn` adds more default-hidden columns (e.g. phone defaults).
- `hidden` + `onToggleColumn` (+ `onShowAll`, `onResetColumns`) = the app keeps visibility itself (controlled).
  Only do this when something else edits the same list.

## By voice / console

Action `axf.grid.columns:<grid>:<hide|show|toggle|all|reset>:<column>` works on any grid on screen. Grid and column
can be named loosely (id or label), so Amber can call `console_action` with
`axf.grid.columns:Build manager:hide:cost`. It's a view preference, so it runs with the navigate grant. `gridsOnScreen()`
lists the grids on screen with their columns and what's hidden.

## Rules

- No hand-made tables with a column header row: `node framework/cli/check-grids.mjs` fails CI on a new one. The ones
  left are in `framework/spec/grids-baseline.json`, which only shrinks (`--update-baseline` after converting).
  Key/value tables (a `<th>` per row) aren't grids. A Markdown renderer's table carries `axf-grid-exempt: <reason>`.
- Theme tokens only (`datagrid.css`); widths are token tracks (`calc(var(--fx-space) * N)`, `minmax(…)`).
- Tests: `npx -y tsx framework/spec/check-grid-columns.mts`.
