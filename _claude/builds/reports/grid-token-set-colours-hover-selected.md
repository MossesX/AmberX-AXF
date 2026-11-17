# Grid token set: colours, hover, selected, lines

Build `grid-token-set-colours-hover-selected`. Brett (Nov 13 2026): "how many tokens does a grid have; don't they need that to have hover colors".

## Answer

A grid has 39 tokens of its own (`--fx-grid-*`, component-tokens@1, `framework/core/engines/component-tokens.mjs`). Hover, selected, focused, striping, lines, header, filter chips, group headers, sticky shadow, empty state and per-grid transparency are each their own token. Every default chains the general token the grid read before, so no skin changes look until it sets one.

## What was already on main (build own-token-sets-for-grids-and-tab-groups, s1)

- The grid family (32 tokens) and the tab-group family in the engine, with kind, level and description per token.
- `:root` defaults in `framework/ui/axf.css`; `.fx-table` and lib-datagrid `.axf-grid` rules read only family tokens.
- Style theme `data.grid.<token>` (skins), control@1 `tokens.style` paths `grid.<token>`, per-instance `tokens.instances` (`axf.tokens.instances`) with Restore previous edit / Restore from axHub.
- DataGrid and TabGroup set their instance values inline; the chrome right-click panel edits them (`chrome.token`, `chrome.token-restore`, `chrome.token-hub`).
- Token Control lists `tokens.style` and `tokens.instances`; the Skin Editor has a Grid element.
- CI: `framework/spec/check-component-tokens.mjs` in `.github/workflows/android.yml`.

## What this step adds (s1)

Taken from the archived branch's unlanded commit `3b73afb97` (grid part, tab part rides along):

- Grid: `filterChipBg`, `filterChipText`, `filterChipBorder`, `filterChipActiveBg`, `filterChipActiveText` (the chips plugins draw above a grid; `DATASET_TOOLBAR_SLOT` now sits in a box-less `.axf-grid-above` wrapper that carries the grid's instance values), `focusedBg` (tint on the keyboard-focused row), `disabledText`.
- Tab group: `pressedBorder`, `disabledBg`, `disabledBorder`; `activeBorder` is now drawn.
- Schema, `:root` block, control@1 paths and fixtures regenerated; the CI check names the new tokens.
- Catalog note updated to 39 grid / 61 tab tokens.

## How each piece is reached

- Deep link: Token Control → Style theme tokens → grid.* (`view:token-control`); any grid → right-click → Settings… → tokens panel.
- REST / MCP / CLI / voice: control@1 `set tokens.style grid.hoverBg accentSoft`; `set tokens.instances grid.<grid id>.hoverBg <value>`; `act tokens.instances grid.<grid id> restore-previous | restore-hub`; console actions `chrome.token:grid:<id>:<token>:<value>`, `chrome.token-restore:grid:<id>`, `chrome.token-hub:grid:<id>`.

## Clashes handled

- `grids-get-their-own-full-token-set` (queued) was the same ask with the same step text: marked complete, noted to this branch.
- `own-look-per-grid-and-tab-group` (PR #752, running) builds the per-instance look record (instance-look@1) on top of this; not duplicated here.

## Checks

- `node framework/spec/check-component-tokens.mjs`: ok (100 tokens: 39 grid, 61 tabs).
- `node framework/cli/check-theme.mjs`: ok.
- `npx -y tsx framework/spec/gen-fixtures.mts`: fixtures regenerated, no drift.
- Console typecheck: see the PR.

## Deferred

- Kotlin twin of the new tokens: `framework/spec/PORTING.md` (already recorded for component-tokens@1).
