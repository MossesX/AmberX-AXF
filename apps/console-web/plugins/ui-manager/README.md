# UI Manager (console plugin)

`ai.amberx.axf.console.ui-manager` · core on Fable, UI on Opus (build `ui-manager-floating-window-to-select-any`).

Brett (Nov 13 2026): "a UI manager, opens a floating window which contains the ability to select any UI element in the
whole console; collapsible categories; one category is all the ones visible on screen, like a Windows shortcut, two things
point to the shared source; select one and it opens an expanding row with all the properties and tokens; you change them by
selecting from predetermined things from the integration with the console and the framework".

## The core (Phase 1, Fable): `framework/core/engines/ui-manager-rules.mjs`

Pure, shared by the floating window, the server part, the CLI and the tests.

- **ui-element@1**: one selectable thing (`id`, `label`, `kind`, `category`, `assetType?`, `address?` (console-control@1),
  `selector?`, `plugin?`, `tokens[]`). Sources: one element per framework asset slot type (`frameworkElements`), every
  plugin's `plugin.json` → `uiElements` (`elementsFromManifest`; the plugin's id, never its folder), and the open console's
  console-control-targets@1 snapshot (`elementsFromTargets`). Categories: On screen now · Chrome & navigation · Screens &
  pages · Settings · Dialogs & popups · Controls · Widgets · Look · Plugins (`CATEGORIES`, open list).
- **On screen now = shortcuts.** `elementTree(elements, visibleIds)` puts `{ ref: <id> }` entries first; `resolveElement`
  follows a shortcut to the one element, so an override made through either lands in the same place.
- **Properties, never typed in.** `propsOf(element, catalog)` derives every property with its predetermined choices from
  the catalog (ui-catalog@1: `asset-types.json` types, every asset of every type, the asset in force per slot from the skin
  / look document, control@1 token paths): `visible` (on / off), `transparency` (0–100 % in steps of 5), `asset` (the ids
  the framework and plugins ship), `field:<path>` (the type's enum words, booleans, or the values known assets use),
  `token:<set>:<path>` (a colour = a token reference `@accent` → `var(--fx-accent)`; a number = a range with a nice step;
  enum / boolean / known strings). `validateValue` refuses anything outside the list and names the valid values.
- **ui-overrides@1**: `{ elements: { <element>: { <prop>: value } } }`, only what differs. `withOverride` (validated),
  `withoutOverride` (reset one property / one element / everything), `propertyRows` (the expanding row: value, base,
  `source` override · skin · asset · default, `overridden`), `overrideCount`.
- **Live preview**: `previewPlan` → CSS scoped to each element's selector that re-declares `--fx-*` tokens (a colour is
  `var(--fx-<token>)`, a size keeps its unit, transparency is `opacity`, hidden is `display:none`), plus `swaps` (asset in
  force) and `patches` (asset fields) for the runtime. Nothing is saved by a preview.
- **ui-change@1**: `diffOverrides` (old → new per element and property), `changeEntry` (who, when, what; the id carries the
  millisecond and a content hash), `undoChange`, `summarize` (the exit summary before Apply).

## The plugin

- `lib/catalog.mjs` reads the catalog (framework + plugin assets, the look document Token control writes); `lib/store.mjs`
  keeps `overrides.json` and `changes.jsonl` in the data folder; `lib/core.mjs` is the one set of operations.
- CLI `ui-manager.mjs`: `elements | tree | props | choices | set | reset | preview | apply | changes | undo | catalog | overrides`
  (`--json`; the server drives it this way).
- Server `/api/plugins/ui-manager/…`: the same operations as routes (header of `server/__init__.py`); through
  plugin-commands@1 they are also MCP tools `ui-manager_*`, REST `/api/control/ui-manager/<command>` and `axf ui-manager …`.
- Page `UI Manager` (Plugins menu, View → Look → UI Manager…) and settings tab under Settings → Plugins. The floating
  window, picker mode, expanding row with pickers, preview window and change log UI are the Opus phase of the build.

```bash
node apps/console-web/plugins/ui-manager/ui-manager.mjs props asset:toolbar
node apps/console-web/plugins/ui-manager/ui-manager.mjs choices asset:toolbar token:tokens.theme:surface
node apps/console-web/plugins/ui-manager/ui-manager.mjs set asset:toolbar transparency 80
node apps/console-web/plugins/ui-manager/ui-manager.mjs reset asset:toolbar
node apps/console-web/plugins/ui-manager/test.mjs
```
