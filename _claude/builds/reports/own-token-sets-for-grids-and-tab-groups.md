# Own token sets for grids and tab groups

Build `own-token-sets-for-grids-and-tab-groups` · contract `component-tokens@1` · PRs #654 (s1, merged) and the phase 2 PR.

## Brett asked (Nov 13 2026, verbatim)

> how many tokens does a grid have, colors, don't they need that to have hover colors; what about tab groups, are they the same way

## The answer

**Before:** a grid had only layout tokens (`--fx-grid-areas/cols/rows` and the `-m` mobile variants) and a tab group only its padding (`--fx-tab-py/px`) and `--fx-tabs-per-row`. **No colour tokens of their own.** Both borrowed the general colours (`--fx-surface2` for a hovered row, `--fx-accent` for the active tab line), so hover, selected and active could not be styled without changing every other surface too. Tab groups had the same problem.

**Now:** each has its own family.

| Family | Tokens | Colour | Length | Shadow | Opacity | Number | Basic / Pro / Advanced |
|---|---|---|---|---|---|---|---|
| Grid `--fx-grid-*` | 39 | 31 | 4 | 1 | 2 | 1 | 9 / 19 / 11 |
| Tab group `--fx-tab-*` | 61 | 44 | 11 | 2 | 2 | 2 | 12 / 28 / 21 |

The defaults point at the general token each component used before, so every skin looks the same until someone sets one.

- **Grid hover:** `hoverBg` and `hoverText`. Also `selectedBg/Text/Border`, `focusRing`, `focusedBg`, `expandedBg`, `disabledText/Opacity`, the header, zebra rows, lines, the outer border, cell padding, row height, radius, group headers (3 depths), the sticky shadow, the empty state, filter chips, and `opacity` (default 1 = 100%).
- **Tab hover:** `hoverText`, `hoverBg` and `hoverBorder`. Also idle, active, pressed and disabled text, background and border, the focus ring, the indicator colour and thickness, the badge (idle and active), the close button, the fold/overflow pick, the sticky bar, the window tab bar, a radius for each style (underline, pills, boxed, segmented, plain, chips, window), each style's active colours, and `opacity` (default 1).

## Where a value comes from (lowest → highest)

1. The `:root` defaults in `framework/ui/axf.css` (generated: `node framework/cli/component-tokens.mjs write`).
2. The skin's style theme: `data.grid.<token>` / `data.tabs.<token>` (Token Control → tokens.style paths `grid.*` / `tabs.*`).
3. One instance: setting `axf.tokens.instances`, an inline style on that one grid / tab row. It travels with the axHub look.

## How each one is reached (API)

| What | UI | Console REST / MCP / CLI | Voice / console actions |
|---|---|---|---|
| Skin-wide value | Token Control page (tokens.style) | control@1 `tokens.style` `grid.<token>` / `tabs.<token>` (list / get / set / reset) | — (through control@1) |
| One tab row | Tab group settings → Look → "Tab group colours & style (this one)" | control@1 `tokens.instances` path `tabs.<instance>[.<token>]` (list / get / set / reset; act `restore-previous` / `restore-hub`) | `chrome.token:tabs:<id>:<token>:<value>`, `chrome.token-restore:…`, `chrome.token-hub:…` |
| One grid | Grid header menu → "Grid colours & style…" (dialog `axf.chrome.tokens`) | control@1 `tokens.instances` path `grid.<instance>[.<token>]` | `chrome.tokens:grid:<id>` opens it (deep link); `chrome.token:grid:…` sets |

## Phase 2 changes (Opus)

- **s2:** a grid now has its own editor. A `chrome.tokens:<family>:<instance>` action plus the `axf.chrome.tokens` dialog (the same panel the tab group dialog uses), opened from the grid header menu. The chrome.token* ids are listed in `CHROME_ACTION_IDS` and the control inventory is regenerated.
- **s3 (grid):** `filterChipBg/Text/Border/ActiveBg/ActiveText` (for chips that plugins draw above a grid, inside a box-less `.axf-grid-above` wrapper that carries the grid's own values), `focusedBg`, `disabledText`.
- **s4 (tabs):** `pressedBorder` (boxed), `disabledBg` and `disabledBorder` (every style), and `activeBorder` is now drawn. It was declared in s1 but nothing used it.
- I tried a header-hover token and dropped it: the header cells are framework buttons, and lib CSS must not restyle a control (check-controls).

## Open

- **UI Manager:** that build (`ui-manager-floating-window-to-select-any`) has not landed yet. When it does, its rows read these same tokens through control@1 `tokens.style` / `tokens.instances`; nothing else is needed from this build.
- **Kotlin twin:** deferred (framework/spec/PORTING.md).
- **Experience levels:** every token has a level (basic / pro / advanced), but the per-instance panel lists them all. Filtering by level is follow-up work.

## Checks

`check-component-tokens` (100 tokens), `check-theme`, `check-controls`, `check-chrome-assets`, `check-toolbars`, `check-control` (396 checks), `check-console-control` and the token-control tests (22) all pass.

## Every token

### Grid (39)

| Token | Variable | Kind | Level | Default | What it styles |
|---|---|---|---|---|---|
| headerBg | `--fx-grid-header-bg` | colour | basic | `var(--fx-surface2)` | Background of the header row. |
| tableHeaderBg | `--fx-grid-table-header-bg` | colour | pro | `transparent` | Background of a plain table's header row (.fx-table; the data grid uses headerBg). |
| headerText | `--fx-grid-header-text` | colour | basic | `var(--fx-muted)` | Text colour of the column headers (a data grid's header buttons follow the quiet button until this is set). |
| headerActiveText | `--fx-grid-header-active-text` | colour | pro | `var(--fx-accent)` | Text of the current / highlighted column header (matrix tables). |
| headerBorder | `--fx-grid-header-border` | colour | pro | `var(--fx-border)` | Line under the header row. |
| headerWeight | `--fx-grid-header-weight` | number | advanced | `600` | Font weight of the column headers. |
| sortArrow | `--fx-grid-sort-arrow` | colour | pro | `currentColor` | The sort direction arrow on a sorted column (currentColor = the header text). |
| filterChipBg | `--fx-grid-filter-chip-bg` | colour | pro | `var(--fx-surface3)` | Background of a filter / count chip in the toolbar above the grid. |
| filterChipText | `--fx-grid-filter-chip-text` | colour | pro | `var(--fx-muted)` | Text of a filter / count chip above the grid. |
| filterChipBorder | `--fx-grid-filter-chip-border` | colour | advanced | `transparent` | Border of a filter / count chip above the grid. |
| filterChipActiveBg | `--fx-grid-filter-chip-active-bg` | colour | pro | `var(--fx-accent-soft)` | Background of a filter chip that is on. |
| filterChipActiveText | `--fx-grid-filter-chip-active-text` | colour | pro | `var(--fx-accent)` | Text of a filter chip that is on. |
| rowBg | `--fx-grid-row-bg` | colour | basic | `transparent` | Background of a plain row. |
| rowAltBg | `--fx-grid-row-alt-bg` | colour | pro | `transparent` | Background of every second row (zebra striping; same as rowBg = no stripes). |
| rowText | `--fx-grid-row-text` | colour | basic | `inherit` | Text colour of a row. |
| hoverBg | `--fx-grid-hover-bg` | colour | basic | `var(--fx-surface2)` | Background of the row under the pointer. |
| hoverText | `--fx-grid-hover-text` | colour | advanced | `inherit` | Text colour of the row under the pointer. |
| selectedBg | `--fx-grid-selected-bg` | colour | basic | `var(--fx-accent-soft)` | Background of the selected row. |
| selectedText | `--fx-grid-selected-text` | colour | advanced | `inherit` | Text colour of the selected row. |
| selectedBorder | `--fx-grid-selected-border` | colour | pro | `var(--fx-accent)` | Outline of a row in a multi-selection. |
| focusRing | `--fx-grid-focus-ring` | colour | pro | `var(--fx-focus)` | Keyboard focus ring on a row or header cell. |
| expandedBg | `--fx-grid-expanded-bg` | colour | pro | `var(--fx-surface2)` | Background of an expanded row's detail panel. |
| focusedBg | `--fx-grid-focused-bg` | colour | advanced | `transparent` | Tint laid over the row that has keyboard focus (transparent = none). |
| disabledText | `--fx-grid-disabled-text` | colour | pro | `inherit` | Text colour of a disabled row. |
| disabledOpacity | `--fx-grid-disabled-opacity` | opacity | advanced | `1` | How faded a disabled row is (1 = not faded; set var(--fx-opacity-disabled) or a number below 1). |
| lineColor | `--fx-grid-line-color` | colour | basic | `var(--fx-border)` | Grid lines between rows and cells. |
| outerBorder | `--fx-grid-outer-border` | colour | pro | `transparent` | Border around the whole grid. |
| cellPadY | `--fx-grid-cell-pad-y` | length | pro | `var(--fx-size-table-pad-y)` | Vertical cell padding (table cells). |
| cellPadX | `--fx-grid-cell-pad-x` | length | pro | `var(--fx-size-table-pad-x)` | Horizontal cell padding (table cells). |
| rowHeight | `--fx-grid-row-height` | length | pro | `auto` | Minimum row height; auto = as tall as the content. |
| radius | `--fx-grid-radius` | length | basic | `0` | Corner radius of the whole grid. |
| groupHeaderBg | `--fx-grid-group-header-bg` | colour | pro | `var(--fx-surface3)` | Background of a top-level group header row. |
| groupHeaderBgNested | `--fx-grid-group-header-bg-nested` | colour | advanced | `var(--fx-surface2)` | Background of a second-level group header row. |
| groupHeaderBgDeep | `--fx-grid-group-header-bg-deep` | colour | advanced | `var(--fx-surface)` | Background of a third-level (or deeper) group header row. |
| groupHeaderText | `--fx-grid-group-header-text` | colour | advanced | `inherit` | Text colour of a group header row. |
| groupSummaryText | `--fx-grid-group-summary-text` | colour | advanced | `var(--fx-muted)` | The summary text beside a group title. |
| stickyShadow | `--fx-grid-sticky-shadow` | shadow | advanced | `none` | Shadow under a sticky header / beside a sticky column. |
| emptyText | `--fx-grid-empty-text` | colour | pro | `var(--fx-muted)` | Text colour of the empty state ("Nothing to show"). |
| opacity | `--fx-grid-opacity` | opacity | basic | `1` | Transparency of the grid's backgrounds (1 = opaque). |

### Tab group (61)

| Token | Variable | Kind | Level | Default | What it styles |
|---|---|---|---|---|---|
| barBg | `--fx-tab-bar-bg` | colour | basic | `transparent` | Background of the tab row. |
| barBorder | `--fx-tab-bar-border` | colour | basic | `var(--fx-border)` | Rule under (or beside) the tab row. |
| gap | `--fx-tab-gap` | length | pro | `var(--fx-dens-gap-md)` | Space between tabs. |
| text | `--fx-tab-text` | colour | basic | `var(--fx-muted)` | Text of an idle tab. |
| bg | `--fx-tab-bg` | colour | basic | `transparent` | Background of an idle tab. |
| border | `--fx-tab-border` | colour | pro | `transparent` | Border of an idle tab (boxed and chips styles). |
| hoverText | `--fx-tab-hover-text` | colour | basic | `var(--fx-text)` | Text of the tab under the pointer. |
| hoverBg | `--fx-tab-hover-bg` | colour | basic | `transparent` | Background of the tab under the pointer. |
| hoverBorder | `--fx-tab-hover-border` | colour | advanced | `var(--fx-tab-border)` | Border of the tab under the pointer. |
| activeText | `--fx-tab-active-text` | colour | basic | `var(--fx-text)` | Text of the active tab. |
| activeBg | `--fx-tab-active-bg` | colour | basic | `transparent` | Background of the active tab (underline style). |
| activeBorder | `--fx-tab-active-border` | colour | pro | `transparent` | Ring drawn inside the active tab's edge (underline style; transparent = none). |
| activeWeight | `--fx-tab-active-weight` | number | advanced | `inherit` | Font weight of the active tab. |
| pressedText | `--fx-tab-pressed-text` | colour | advanced | `var(--fx-tab-hover-text)` | Text of a tab while it is pressed. |
| pressedBg | `--fx-tab-pressed-bg` | colour | advanced | `var(--fx-tab-hover-bg)` | Background of a tab while it is pressed. |
| pressedBorder | `--fx-tab-pressed-border` | colour | advanced | `var(--fx-tab-hover-border)` | Border of a tab while it is pressed (boxed style). |
| disabledText | `--fx-tab-disabled-text` | colour | pro | `var(--fx-tab-text)` | Text of a disabled tab. |
| disabledBg | `--fx-tab-disabled-bg` | colour | advanced | `transparent` | Tint laid over a disabled tab's background (transparent = none). |
| disabledBorder | `--fx-tab-disabled-border` | colour | advanced | `transparent` | Ring drawn inside a disabled tab's edge (transparent = none). |
| disabledOpacity | `--fx-tab-disabled-opacity` | opacity | advanced | `1` | How faded a disabled tab is (1 = not faded; set var(--fx-opacity-disabled) or a number below 1). |
| focusRing | `--fx-tab-focus-ring` | colour | pro | `var(--fx-focus)` | Keyboard focus ring on a tab. |
| indicator | `--fx-tab-indicator` | colour | basic | `var(--fx-accent)` | The active tab's line (underline style) and drop marker. |
| indicatorSize | `--fx-tab-indicator-size` | length | pro | `2px` | Thickness of the active tab's line. |
| badgeBg | `--fx-tab-badge-bg` | colour | pro | `var(--fx-surface3)` | Background of the count badge on an idle tab. |
| badgeText | `--fx-tab-badge-text` | colour | pro | `var(--fx-muted)` | Text of the count badge on an idle tab. |
| badgeActiveBg | `--fx-tab-badge-active-bg` | colour | advanced | `color-mix(in srgb, var(--fx-accent) calc(var(--fx-opacity-tint) * 100%), transparent)` | Background of the count badge on the active tab. |
| badgeActiveText | `--fx-tab-badge-active-text` | colour | advanced | `var(--fx-text)` | Text of the count badge on the active tab. |
| closeText | `--fx-tab-close-text` | colour | advanced | `var(--fx-muted)` | The close (×) button on a closable tab. |
| closeHoverText | `--fx-tab-close-hover-text` | colour | advanced | `var(--fx-danger)` | The close button under the pointer. |
| closeHoverBg | `--fx-tab-close-hover-bg` | colour | advanced | `var(--fx-surface3)` | Background of the close button under the pointer. |
| foldBg | `--fx-tab-fold-bg` | colour | pro | `var(--fx-surface)` | Background of the dropdown pick (overflow "dropdown": the one button that stands for the row). |
| foldText | `--fx-tab-fold-text` | colour | pro | `var(--fx-text)` | Text of the dropdown pick. |
| foldBorder | `--fx-tab-fold-border` | colour | advanced | `var(--fx-border)` | Border of the dropdown pick. |
| foldRadius | `--fx-tab-fold-radius` | length | advanced | `var(--fx-radius-sm)` | Corner radius of the dropdown pick. |
| stickyBg | `--fx-tab-sticky-bg` | colour | pro | `var(--fx-surface)` | Background of a sticky tab row (so content scrolling under it stays hidden). |
| windowBarBg | `--fx-tab-window-bar-bg` | colour | pro | `var(--fx-surface2)` | Background of a window's tab bar. |
| windowActiveBg | `--fx-tab-window-active-bg` | colour | pro | `var(--fx-surface)` | Background of the active tab in a window's tab bar. |
| windowActiveShadow | `--fx-tab-window-active-shadow` | shadow | advanced | `var(--fx-shadow-sm)` | Shadow of the active tab in a window's tab bar. |
| radiusUnderline | `--fx-tab-radius-underline` | length | pro | `0` | Corner radius of a tab in the underline style. |
| radiusPills | `--fx-tab-radius-pills` | length | pro | `999px` | Corner radius of a tab in the pills style. |
| radiusBoxed | `--fx-tab-radius-boxed` | length | pro | `var(--fx-radius-sm)` | Corner radius (top corners) of a tab in the boxed style. |
| radiusSegmented | `--fx-tab-radius-segmented` | length | pro | `var(--fx-radius-sm)` | Corner radius of a tab in the segmented style. |
| radiusPlain | `--fx-tab-radius-plain` | length | pro | `0` | Corner radius of a tab in the plain style. |
| radiusChips | `--fx-tab-radius-chips` | length | pro | `999px` | Corner radius of a tab in the chips style. |
| radiusWindow | `--fx-tab-radius-window` | length | advanced | `var(--fx-radius-sm)` | Corner radius of a tab in a window's tab bar. |
| pillsActiveBg | `--fx-tab-pills-active-bg` | colour | basic | `var(--fx-accent)` | Background of the active pill. |
| pillsActiveText | `--fx-tab-pills-active-text` | colour | basic | `var(--fx-accent-text)` | Text of the active pill. |
| boxedActiveBg | `--fx-tab-boxed-active-bg` | colour | pro | `var(--fx-surface)` | Background of the active boxed tab. |
| boxedActiveBorder | `--fx-tab-boxed-active-border` | colour | pro | `var(--fx-border)` | Border of the active boxed tab. |
| segmentedBg | `--fx-tab-segmented-bg` | colour | pro | `var(--fx-surface2)` | Background of the segmented control's track. |
| segmentedBorder | `--fx-tab-segmented-border` | colour | advanced | `var(--fx-border)` | Border of the segmented control's track. |
| segmentedRadius | `--fx-tab-segmented-radius` | length | advanced | `var(--fx-radius-md)` | Corner radius of the segmented control's track. |
| segmentedActiveBg | `--fx-tab-segmented-active-bg` | colour | pro | `var(--fx-surface)` | Background of the active segment. |
| segmentedActiveShadow | `--fx-tab-segmented-active-shadow` | shadow | advanced | `var(--fx-shadow-sm)` | Shadow of the active segment. |
| plainActiveText | `--fx-tab-plain-active-text` | colour | pro | `var(--fx-accent)` | Text of the active tab in the plain style. |
| plainActiveWeight | `--fx-tab-plain-active-weight` | number | advanced | `600` | Font weight of the active tab in the plain style. |
| chipsBg | `--fx-tab-chips-bg` | colour | pro | `var(--fx-surface)` | Background of an idle chip. |
| chipsBorder | `--fx-tab-chips-border` | colour | pro | `var(--fx-border)` | Border of an idle chip. |
| chipsActiveBg | `--fx-tab-chips-active-bg` | colour | pro | `var(--fx-accent-soft)` | Background of the active chip. |
| chipsActiveBorder | `--fx-tab-chips-active-border` | colour | pro | `var(--fx-accent)` | Border of the active chip. |
| opacity | `--fx-tab-opacity` | opacity | basic | `1` | Transparency of the tab row's backgrounds (1 = opaque). |
