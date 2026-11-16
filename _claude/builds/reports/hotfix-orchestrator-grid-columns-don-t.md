# Hotfix: orchestrator grid columns don't line up

Build `hotfix-orchestrator-grid-columns-don-t` · branch `claude/hotfix-orchestrator-grid-columns-don-t` · Phase 1 (Opus)

Brett said (2026-11-16 18:28):
> Line up the grid in the orchestrator, the pending builds grid, none of the columns are lined up, it looks like trash. I built a skin on Fable and it did that.

## Root cause (s2)

`lib-datagrid` (`framework/libs/datagrid`) drew the header and **every row as its own CSS grid**:

```css
.axf-grid-head, .axf-grid-row { display: grid; grid-template-columns: var(--axf-grid-cols); min-width: max-content; … }
```

They shared the same *track list* (`--axf-grid-cols`), but each one resolved it alone. That is only safe when every
track is a fixed length. The build grids use flexible and intrinsic tracks:

- Pending / Queue / Active / Incomplete / Complete / Errors / Archive / Deleted (`plugins/build-orchestrator/web/pipeline.tsx`):
  the Build column is `minmax(14em, 4fr)`;
- the steps sub-grid: the What column is `minmax(14em, 1fr)`;
- every grid with row hooks: the tail track is `minmax(4sp, max-content)`.

Each row is `min-width: max-content` and its cells are `white-space: nowrap` (`orchestrator.css`). A row whose title is
longer than the screen is wider than the header, so its `fr` track takes the extra width, and every column after it
moves right by that much. A short row and the header stay put. Measured before the fix: the Build cell runs up to
2,275px past its header on a phone, and 35–72 of every 72 header/cell pairs are off per tab. The All builds grid
(`ui.tsx`, every track bounded, no `fr`) lines up, which confirms the cause.

**Why it looked like the skin did it.** It doesn't depend on the skin: the default look fails the same way (see the
before set). A skin with a wider font or more cell padding makes more titles overflow, so more rows break and it gets
far more visible. Brett's Fable-made skin lives on the hub (not in `framework/assets/skin`); the framework skins
(`windows` measured) fail identically.

**What the two named builds changed.**

- `console-look-becomes-default-axhub-skin` (#717): no change to the grid CSS, the DataGrid component or grid tokens.
  It moves the console's look into a skin, so the console now draws under a skin by default; that is when the bug
  became visible on the live console.
- `every-grid-1-2-rows-per-item-set-skin` (#707, draft, **not on main**): adds the `grid.rowLines` token
  (`--fx-grid-row-lines`, `data-axf-row-lines`) and the `grid-rows@1` contract (primary cells on line 1, secondary on
  line 2) plus a separate `fx-rows` renderer. None of its CSS reaches DataGrid yet, so there is no 2-row mode on
  main. This hotfix gives DataGrid a 2-row layout on the same shared columns with the same names (`data-axf-row-lines`,
  primary = the grid's fixed columns), so #707's s5 can feed the skin token into it instead of drawing rows a second way.

No skin asset or `console.css` sets column widths, gaps or padding on only the header or only the rows; the gap and
padding tokens were already the same on both (`--fx-dens-gap-md`, `--axf-grid-pad`, `--fx-dens-gap-xl`). The one
one-sided rule is `orchestrator.css`'s `white-space: nowrap` on cells, which is fine once the tracks are shared.

## Fix

_(s4–s7)_

## Tests

| Check | Before | After |
|---|---|---|
| `apps/console-web/scripts/grid-align.mjs` (default + windows, desktop + phone, 9 tabs) | 52 failures: every `fr`-track grid misaligned; 2-row mode missing | _(s9)_ |

## Shots

Before: `hotfix-orchestrator-grid-columns-don-t - before` (UI Review → Screenshots), manifest
`hotfix-orchestrator-grid-columns-don-t/shots.json`, a subset in `hotfix-orchestrator-grid-columns-don-t/shots/before/`.

## API

_(s8)_
