# grid-rows@1: every grid shows 1 or 2 lines per item, set by the skin

Build every-grid-1-2-rows-per-item-set-skin (Nov 15 2026). Brett: "every grid supposed to be 1 or 2 rows depending on
the skin". Engine `framework/core/engines/grid-rows.ts` (pure), fixture `framework/spec/fixtures/grid-rows.json`
(`gen-fixtures.mts`), check `framework/spec/check-grid-rows.mts`. Kotlin twin deferred (`PORTING.md`, "grid-rows@1").

## The row slots

Every item of a grid gives three slots:

| slot | what | where it shows |
| --- | --- | --- |
| `primary` | the cells that name the item | always on the first line |
| `secondary` | the cells that qualify it | inline after the primary cells (1 line) or on the second line (2 lines) |
| `detail` | everything else: free text and / or label → value fields | under the row, only while open; `null` = the row never opens |

Raw items are read tolerantly (`normalizeGridRows`): `{ id | key, primary, secondary?, detail? }`, a cell a string /
number or `{ key?, text | value | label, title? }`, a detail a string or `{ text?, fields?: [{ label, value }] | { label:
value } }`. Bad entries drop out, a repeated id keeps its first row, at most 12 cells per slot, 400 characters per cell,
40 detail fields, 5000 items. An item with no primary and no secondary cell is not a row.

## Collapsed: 1 line or 2

`gridRowCollapsedLines(item, lines)`, the heart of the contract:

| lines | collapsed row | truncation |
| --- | --- | --- |
| `1` | one line, role `inline`: primary cells, then secondary cells | one line, ellipsis at the end |
| `2` | line 1 role `primary`: the primary cells; line 2 role `secondary`: the secondary cells (left out when the item has none) | each line one line, ellipsis at the end |

Rows of a grid are the same height collapsed; the detail is where everything fits. The lines per row never come from
the item or the renderer: they come from the look.

## Where the lines come from

The grid token `rowLines` (component-tokens@1, `--fx-grid-row-lines`, 1 | 2, default 2) and the root hook
`data-axf-row-lines` the runtime mirrors it on (`styleThemeAttrs`). `resolveGridRowLines({ instance, root, theme })`
applies, highest first:

1. one grid's own override: control@1 `tokens.instances` path `grid.<instance>.rowLines`;
2. the root the grid sits under: a tab group's or container's customize token `rowLines` (sets `--fx-grid-row-lines` on
   that root), or the document root's `data-axf-row-lines`;
3. the style theme's `grid.rowLines`, which is where the skin's lands: skin@1 `grid.rowLines` (a design package's
   `extras.grid.rowLines`), and a pick per level inside the skin (`rowLines` beside `colorTheme` on the app level, a
   `ui:<view>` / `plugin:<id>` scope, the hub-wide skin, the `defaultSkin` pointer), folded hub → app → ui → plugin with
   the child overriding the parent (`resolveSkinChain`); the composed look writes it as the tokens.style override
   `grid.rowLines` (APPEARANCE-SOURCE.md, "Grid rows are set by the skin");
4. nothing anywhere: 2.

Default skins: Ledger and Control room draw 1 line, the others 2; the dense design packages (Data desk, Enterprise day /
night, Ops center) draw 1.

## Tap or Enter toggles the detail

The state is the app's: `{ expanded: string[] }` (ids whose detail is open, in opening order; `normalizeGridRowsState`).
`gridRowInput(state, item, input)` with `input = { kind: 'tap' } | { kind: 'key', key }`:

- a tap toggles the row's detail (open ↔ closed); so does the key `Enter` (`GRID_ROWS_TOGGLE_KEYS`, append-only);
- every other key leaves the state as it is; so does any input on a row whose `detail` is `null`;
- the same state object comes back when nothing changed, so a renderer can skip the redraw;
- `gridRowToggle` is the bare toggle, `gridRowsCollapseAll` closes everything, `gridRowOpen` reads one row.

## The plan a renderer draws

`gridRowPlan(item, lines, state)` → `{ id, lines, collapsed, toggles, open, detail, attrs, label }`:

- `collapsed`: the lines above; `toggles`: the item has a detail; `open`: it is open now; `detail`: the detail while
  open, else `null`;
- `attrs`: `role="row"`, `data-axf-row-lines="1|2"`, `data-fx-row="<id>"`; when the row toggles also
  `aria-expanded="true|false"` and `tabindex="0"` (keyboard reach, Enter handled by the renderer through
  `gridRowInput`);
- `label`: the primary texts, then the secondary, joined with " · " (assistive tech, search, voice).

`gridRowsPlan(items, lines, state)` is the plan of every row. Renderers draw exactly the plan: the web classes are
`GRID_ROWS_CLASSES` (`fx-rows`, `fx-rows__item`, `fx-rows__line` + `--inline | --primary | --secondary`, `fx-rows__cell`
+ `--secondary` on a 1-line row's secondary cells, `fx-rows__detail`) and `framework/ui/axf.css` carries a rule for each,
reading only the grid family tokens (`--fx-grid-row-text`, `-row-bg`, `-row-alt-bg`, `-hover-bg`, `-expanded-bg`,
`-line-color`, `-outer-border`, `-radius`, `-cell-pad-*`, `-row-height`, `-focus-ring`, `-secondary-text`).

## API

The lines per row are a token, so every entry point already reaches them: control@1 `tokens.style` path `grid.rowLines`
(REST, MCP `control`, the CLI, voice) for the look; `tokens.instances` `grid.<instance>.rowLines` for one grid; the skin
file's `grid.rowLines` for a skin; the console's skin actions for the per-level pick (`setSkinRowLines`, next phase);
the state of a grid (open rows) is the app's console-control@1 state like any other.

## Pinned

`spec/fixtures/grid-rows.json`: golden rows at 1 and 2 lines for the default, a skin's own value, the skin scope chain
(hub → app → ui → plugin) and a plugin override, the input table (tap / Enter / other keys / no detail), the resolve
order and the normalisation of junk. `check-grid-rows.mts` replays it and checks the stylesheet carries every class.
