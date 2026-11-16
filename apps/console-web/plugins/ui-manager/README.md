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

## Every way in (REST, MCP, CLI, voice, console actions)

Everything the window does is reachable without it, through one set of functions (`lib/core.mjs`, `lib/query.mjs`,
`lib/say.mjs`). The open window follows the server's selection and view (`web/bridge.ts`).

| Do | REST (`/api/plugins/ui-manager/…`) | MCP / control@1 | CLI | Console action / voice |
|---|---|---|---|---|
| open the window | | `console_open {screen: "ui manager"}` | `axf console action ui-manager.open` | `ui-manager.open` |
| say it | `POST say {text}` | `ui-manager_say` | `ui-manager.mjs say select the main toolbar, set its transparency to 80` | `ui-manager.say:<words>` |
| select an element | `POST select {element}` | `ui-manager_select` | `ui-manager.mjs select main toolbar` | `ui-manager.select:<id or words>` |
| read the window state | `GET state` | `ui-manager_state` | `ui-manager.mjs state` | |
| choose the view | `POST view {view}` | `ui-manager_view` | `ui-manager.mjs view grid` | `ui-manager.view:<row\|panel\|grid>` |
| pick on screen | | `console_action {action: "ui-manager.pick"}` | `axf console action ui-manager.pick` | `ui-manager.pick` |
| search / sort / filter | `GET elements?q=&kinds=&categories=&plugins=&overridden=&onScreen=&sort=&desc=` | `ui-manager_elements` | `ui-manager.mjs elements --kinds toolbar --sort overrides --desc` | `ui-manager.search:<words>` |
| properties of an element | `GET element?id=` (`q`, `groups`, `changed`) | `ui-manager_element` | `ui-manager.mjs props asset:toolbar --groups Tokens` | |
| set / reset | `POST set`, `POST reset` | `ui-manager_set-element`, `ui-manager_reset` | `ui-manager.mjs set asset:toolbar transparency 80` | via `ui-manager.say` |

## Pending changes, Apply and the change log (s12)

The window edits a **draft** (`web/draft.ts`), never the saved overrides. Each pick hot-renders at once (`POST preview
{pending}` → CSS on `--fx-*` tokens in the one override stylesheet), rows show `pending`. **Closing the window, leaving
the page or Discard drops the draft** and puts the saved look back. **Apply…** shows the exit summary (element, property
/ token, old → new); only **Save** writes it, as one ui-change@1 entry. Apply re-reads the saved document and writes
just the draft's keys onto it (last save wins per key). **Change log** lists every applied set, newest first, each with
its own **Undo** (an undo is itself logged). `set` / `reset` through the API and voice still save at once.

| Do | REST | MCP / control@1 | CLI | Console action / voice |
|---|---|---|---|---|
| preview a pending doc | `POST preview {pending}` (css, summary, errors) | `ui-manager_preview` | `ui-manager.mjs preview --pending f` | |
| apply (exit summary first in the window) | `POST apply {pending}` | `ui-manager_apply` | `ui-manager.mjs apply --pending f` | `ui-manager.apply` |
| discard the window's draft | | `console_action {action: "ui-manager.discard"}` | `axf console action ui-manager.discard` | `ui-manager.discard` |
| change log | `GET changes?limit=` | `ui-manager_changes` | `ui-manager.mjs changes` | `ui-manager.log` |
| undo one entry | `POST undo {id}` | `ui-manager_undo` | `ui-manager.mjs undo <id>` | `ui-manager.undo:<id>` |

## Live preview window (s13)

**Live preview** (window toolbar) opens a floating, movable, resizable window (tab kind `ui-manager-preview`): the
console itself in a same-origin frame at the current route (`?axf-uim-preview=1`), at its own size and scaled to fit (or
50 / 75 / 100 %). The override CSS in force, saved or pending, is mirrored into it on every change; the selected element
is scrolled into view and outlined, so off-screen elements are seen as they will look. The UI Manager's own windows are
hidden in it and the frame never opens a preview of its own. Action `ui-manager.preview[:on|off]` (toggle by default):
`console_action`, `axf console action ui-manager.preview:on`, voice; the scale is the persisted `previewScale`.

## Export any UI as an asset library (ui-library@1)

Any element (or everything changed) exports as one self-contained, schema-validated library (`libraryFrom` /
`libraryErrors` in the rules engine; IO in `lib/library.mjs`):

- **assets**: the asset in force for each exported slot, with the UI Manager's field and token changes written in under a
  new id `<asset>-<library>` (an unchanged asset the catalog already ships is named, not copied);
- **token values**: what a look element set (`tokens.theme.surface` …; a colour reference resolves to the literal of
  the theme in force), replayed as control@1 overrides;
- **manifest**: the asset per slot, what is hidden, transparency per element; plus the **overrides** (ui-overrides@1)
  rewritten to the patched ids, so another console replays the export exactly.

It lands in the **shared hub library** (`/projects/_shared/_data/libraries/ui/<id>.json` + `index.json`,
ui-library-index@1, next to the appearance document every app reads) and downloads as one **package**
(`<id>.ui-library.json`, `GET library/{id}/download`). Import (`libraryImportPlan`): `framework` writes the assets into
`framework/assets` (the shared set: every listed app bakes it with `shared-assets.mjs bake --all`, every future app on
`axf init` gets it, so they conform without doing anything); `app <dir>` into the app's `src/assets`
(`src/assets-overrides` for an id the shared set has); `project <dir>` into `assets/`; `skin` writes the skin@1 asset
the library makes (`libraryAsSkin`: sections from its slots, filled from the asset in force; hidden chrome and the
token values under `extras`), usable with `skins.mjs use <app> <id>`; `console` puts the assets where this plugin's
catalog reads them and applies the overrides as one change-log entry. JSON Schema: `framework/schemas/json/ui-library.schema.json`.

| Do | REST (`/api/plugins/ui-manager/…`) | MCP / control@1 | CLI | Console action / voice |
|---|---|---|---|---|
| export | `POST library/export {elements?, all?, id?, name?, publish?, skin?}` | `ui-manager_library-export` | `ui-manager.mjs library --id x --name "…" [--publish] [--skin] [--out f]` | `ui-manager.export[:<element>]` (Export buttons in the window) |
| list the hub library | `GET libraries` | `ui-manager_libraries` | `ui-manager.mjs libraries` | |
| one library / package | `GET library/{id}` · `GET library/{id}/download` | `ui-manager_library` | `ui-manager.mjs library-get <id or file> [--skin]` | |
| validate a package | `POST library/validate {library}` | `ui-manager_library-validate` | `ui-manager.mjs library-validate --pending f` | |
| import | `POST library/import {id \| library, into, dir?, force?, plan?}` | `ui-manager_library-import` | `ui-manager.mjs import <id or file> --into framework\|app\|project\|skin\|console [--dir d]` | |

## How elements register (new plugins appear on their own)

`lib/manifest.mjs` turns every installed plugin's existing `plugin.json` into elements: the plugin itself
(`plugin:<id>`), each `provides` view, settings tab, dialog, banner item and context menu (views, tabs and dialogs use
the same `target:…` ids the open console reports, so the two merge into one entry). Nothing has to be written for the
UI Manager. A plugin adds more (grids, toolbars, panels) with `uiElements` in its `plugin.json`:

```json
"uiElements": [{ "id": "queue-grid", "label": "Queue", "kind": "grid", "address": "view:builds/grid:queue", "tokens": ["tokens.theme:accent"] }]
```

Open gap: `uiElements` is read by `framework/core/engines/ui-manager-rules.mjs` (`elementsFromManifest`) but is not
yet a documented field of `framework/schemas/plugin.schema.json`. Adding it changes a contract, so it is left for a Fable step.
