# Data set bar plugin (`dataset-bar`, Nov 7 2026, Fable, agent Reel Rhonda)

**What Brett said:** "A plugin that attaches to ANY data set (grid, list, tree, table) and is hidden by default. Search, Filter and Sort are each their own registry asset (search-bar, filter-button, sort-control), reusable on their own, plus a combined 'data set bar' asset. Attach: right-click any data set -> 'Attach data set bar' (or attach pieces individually), with placement top/bottom/inline/floating. Detach the same way. Also attachable from the Registry Browser, by voice, and via API/MCP/CLI. Filter: per-column/field rules, saved filters. Sort: multi-key, saved. Search: field-scoped, fuzzy. Per-attachment config stored locally (local-first), with Reset to default. Existing top-bar search widget becomes an instance of the search-bar asset. Submit at least 3 UI options to UI Review first."

Branch `claude/dataset-bar`. Shots: `_claude/builds/reports/dataset-bar/shots/` (desktop + phone), submitted to UI Review (group `dataset-bar - Nov 7 …`).

## What landed

**Asset types (data-set-bar@1, `framework/schemas/asset-types.json` + `core/types.ts`)**
- `filter-button`, `sort-control`, `data-set-bar`: three new optional types right before `uac-policy`, never rolled, not widgets / attachable (the Kotlin widget pins stay as they are).
- `search-bar` grew `scope: app | dataset`, `fuzzy`, `fields`, `fieldPicker`, `minChars`. The top-bar search (search-bar/everything) and every data set search (search-bar/dataset) are instances of one type; `datasetSearchConfig` reads both.
- Starters: data-set-bar `default` (A, top), `compact` (B, inline), `floating` (C, pill), `bottom` (D, footer); filter-button `default`, `icon`; sort-control `default` (menu), `chips`, `icon`; search-bar `dataset` (fuzzy, field picker), `dataset-exact`.

**Engine `framework/core/engines/datasetbar.ts`** (pure, cross-port; fixture `spec/fixtures/dataset-bar.json`, check `spec/check-dataset-bar.mts` in CI, 275 checks)
- normalizers for the four assets with ranges and enums, `dsbAssetErrors`;
- attachments: one record per data set (`bar`, `overrides`, `state`, `saved.filters / sorts`, `floatingPos`), `resolveAttachment` (asset + overrides), `attachBar / attachPiece / detachBar / detachPiece / setAttachmentPlacement / setAttachmentState`, `resetAttachment` (keeps saved filters and sorts), `parseAttachments`;
- search: field-scoped, fuzzy (substring > one edit away > subsequence), `searchScore / searchRow`; rules: 14 ops, match all / any, `makeDsbFilter`; sort: multi-key, empties last in both directions, numbers and dates by value, `makeDsbCompare`, `toggleDsbSort`;
- `placementSlot`: top / inline → `axf.dataset.toolbar`, bottom → `axf.dataset.footer` (new), floating → portal.

**Framework hooks**
- `rt.contextDataset`: the context menu host records the `data-axf-dataset` under a right-click / long-press (like `contextBannerWidget`).
- lib-datagrid: `DATASET_FOOTER_SLOT`, rendered by `DataGrid` below the grid; `DatasetFrame` wraps lists / trees / tables that use `useDataset` so they get both slots and the dataset name for right-click.

**Plugin `apps/console-web/plugins/data-set-bar`** (web only, `ai.amberx.axf.console.data-set-bar`)
- hidden until attached; right-click a data set → Attach data set bar ▸ Top / Bottom / Inline / Floating, Attach piece ▸ Search bar / Filter button / Sort control; attached → Data set bar ▸ Settings…, Filter…, Sort…, Move ▸, Change bar ▸, Attach / Detach piece ▸, Clear (with the summary), Reset to default, Detach;
- the Registry Browser (Appearance → Assets): right-click a data-set-bar / search-bar / filter-button / sort-control card → Attach to data set ▸ (data sets seen so far, on screen first);
- voice + API / MCP / CLI: console actions `data-set-bar.list | attach | detach | piece | unpiece | move | bar | reset | settings | filter | sort | search | clear` (arguments URL-encoded so data set ids with `:` work), declared in plugin-commands;
- pieces draw from their assets: search box with field picker (fuzzy / exact per asset), filter button with a rule count badge, sort control in menu / chips / buttons style with a key count, row count, clear button, a settings cog;
- Filter dialog (rules per field with on / off, match all / any, saved filters), Sort dialog (keys with direction, reorder, saved sorts), attachment Settings dialog (bar asset, placement, pill corner, pieces + their assets, count / clear, align / density / surface, Reset to default, Detach);
- Settings → Plugins → Data set bar: attached data sets (settings / reset / detach, attach another), defaults for a plain attach, every look drawn over no data set, Install & uninstall;
- per-attachment config in the device's settings (`data-set-bar.attachments`, local-first), defaults in `data-set-bar.defaults`;
- help.json (every control), self-test `test.mts` (runs `web/check.mts` under tsx with the console tsconfig; CI's plugin glob picks it up).

## Checks
- `check-dataset-bar.mts` 275 ✓, `check-widgets` 277 ✓, `check-tab-group` ✓, `check-agent-card` ✓, `check-appearance` ✓, `check-project-fixtures` ✓, `axf validate --framework` 527 assets ✓, `axf validate apps/console-web` ✓
- console `tsc --noEmit` ✓; plugin test 9 ✓; `plugin-commands check` ✓ (3 reads · 9 commands); `plugin-lifecycle check` ✓
- `check-theme` ✓, `check-controls` ✓, `check-toolbars` ✓, `check-chrome-assets` ✓, `help-coverage --check` 100% ✓, `check-plugin-pages` ✓
- `plugins.mjs --check` fails on `asset-browser` on this VPS (hub data; the same on main, not this build; green with CI's `AXF_DATA_DIR=off`).

## Gaps and notes
- Kotlin twin deferred (Android on hold): `spec/PORTING.md` → Deferred: data set bar.
- Lists / trees / tables outside `DataGrid` get the bar once they wrap their rows in `DatasetFrame` (one line); every `DataGrid` has it today.
- Inline placement draws in the dataset's top slot as one quiet line (no border, right-aligned by the compact asset); a true "inside the header row" inline needs the grid to offer a header slot (not built).
- The pill's spot is kept as viewport fractions per attachment, so it survives resizes but not a very different window shape.
- Saved filters and sorts are per data set on this device; sharing them through axHub is a later build.

## Lessons (for the next session; the memory folder is read-only from this worktree)
- Check the port before serving a static console for shots: a `200` from another session's node server means your `python3 -m http.server` never bound and Playwright shot someone else's console (your plugin "never loads"). 7141 was taken; 716x were free.
- `page.waitForFunction` with the default `raf` polling starves the console's lazy plugin loader (it learns new plugins in an idle callback): poll with `polling: 1500` or sleep + evaluate.
- The console's context-menu asset `amber` has `contributions: false`: on the `default` target only its own items show. Plugin items need an element with a `data-fx-ctx-target` the asset doesn't define; DataGrid roots and `DatasetFrame` now name `axf-dataset` for that.
- `--fx-space` is 3.4px in the console theme: size boxes with ~60× (≈200px), not 24×.
- Store step ids can be rewritten by a merge (`s7` became `s7-6`); read the store before `act step`.
- Node 20 on the VPS: a plugin `test.mts` must spawn `npx tsx --tsconfig apps/console-web/tsconfig.json web/check.mts` (follow-amber pattern); CI's node 22 strip-types runs it as is.
