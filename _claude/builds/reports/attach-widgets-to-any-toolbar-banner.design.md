# Attach widgets to any toolbar, banner style — design note (toolbar-widgets@1)

Build `attach-widgets-to-any-toolbar-banner`, Phase 1 (Fable), Nov 16 2026. Brett: "Rebuild." The first attempt
(`toolbar-widgets-attach-any-banner-style`, PR #656, archived at 1/3 steps) is read here for intent only; nothing of it is
on main. This note fixes the contract the Opus phase (s6–s19: runtime, React, picker, console actions, REST, MCP, CLI,
voice, docs) builds against.

## What Brett asked for

"I can attach widgets to the toolbar right, just like the banner widgets" (Nov 13 2026). Every toolbar, not only the
app's, takes the same widgets the banner takes, drawn the banner way (size, what it shows, width cap, priority, ⋯
overflow) and cut to the same shapes, with the per-toolbar settings every toolbar already has (`axf.toolbar.<id>.*`).

## What main has today (seams)

- `toolbar.widgets` is already a widget host in `framework/schemas/asset-types.json` (sides `start` / `end`, widgets
  only; entries `{type, id, at, order?}`), read by `core/engines/widgets.ts` (`placeToolbarWidgets`, `hostSpec`,
  `validateHostAttachments`) and drawn by `react/components/Chrome.tsx` (`rt.toolbarWidgets()`, the **app toolbar only**).
  `HostAttachment.widget` (the banner-widget hint) exists in TypeScript but is not declared in the spec for any host.
- Banner widget rules live in `core/engines/bannerwidgets.ts`: `BannerWidgetHint`, `BannerWidgetPref`,
  `bannerWidgetView` (size → cap in `--fx-space` multiples, `show`, priority, hide-when-empty, overflow),
  `overflowWidgets` (lowest priority leaves first), `findBannerWidget` (voice names). Saved at
  `axf.banners.widgets.<app>.<phone|desktop>`; side and order at `axf.widgets.arrange.banner`.
- Arrangement layer: `axf.widgets.arrange.<host>` (`normalizeArrangement`, `moveOnHost`), hosts `banner` and `toolbar`
  (the app toolbar). No per-instance hosts.
- Per-toolbar settings: `axf.toolbar.<id>.tapConfirm` (`core/engines/tapconfirm.ts`, `TAP_KEYS.perToolbar`),
  `axf.toolbar.collapsed`, chrome settings `axf.chrome.toolbar.<instance>` (`chrome-settings-rules.mjs`). The instance id
  is `toolbarIdOf({id, asset, label})`: `data-axf-toolbar`, else the asset id, else a slug of the aria-label; the app's
  own toolbar is `app` (the chrome-settings instance).
- Snap, never overlap (Brett, Oct 28 2026) is CSS today, banner section of `framework/ui/axf.css`: sides
  `minmax(max-content, 1fr)`, the search bar is the only piece that shrinks (`flex: 0 1 auto`, min 12 × space), then the
  host scrolls with `scroll-snap-type: x proximity`. The toolbar has the scroll-snap half only. No engine states the order.
- Style targets (`schemas/customize.json → targets`): `toolbar` root `.fx-toolbar` item `.fx-toolbtn`; every widget type
  has its own root (`.fx-widget-status`, `.fx-banner__clock`, …). The shapes build adds `shape → .fx-shaped`.
- shape@1 (`banner-widget-shapes-more-than-circle`, PR #703, 28/28 steps, **not on main**; `banner-widget-shapes-and-
  change-icon` pending): a `shape` asset type (kinds circle, pill, rounded, square, squircle, hexagon, diamond, tag,
  corners, mask), tokens `--fx-shape-widget-*` + `data-fx-shape`, banner default `shape: { icon, chip }`, resolve chain
  global → skin → app → instance. This build reserves the same field names so that build resolves toolbars with no
  second contract.

## Contract: toolbar-widgets@1

### 1. Asset model (s2, `framework/schemas/asset-types.json`)

The host block grows one declared entry shape, used by every widget host (toolbar now, banner the same):

```
toolbar.widgets[] = {
  type: <widget type>, id: <asset id>, at: start | end, order?: number,
  widget?: { label?, icon?, size?: icon|compact|normal|wide, show?: auto|both|icon|text|number,
             priority?: 1–9, hideWhenEmpty?, overflow?, hidden?, aliases?: string[] },   // banner widget style
  shape?: <shape@1 asset id>                                                            // shape ref, per slot
}
toolbar.shape? = { icon?: <shape id>, chip?: <shape id> }   // the toolbar's default widget shapes (same as banner.shape)
```

- `widget` is the existing `BannerWidgetHint`, declared once under `types.<host>.widgets.entry` / `attach.entry` so the
  spec, both validators and the JSON Schema agree; the banner's `attach[]` gets the same `widget` and `shape` fields.
- `shape` is an id string (envelope `idPattern`); it is **not** required to exist until shape@1 lands (open registry: the
  validators check the form, the engine passes it through as `data-fx-shape` + the resolve input).
- JSON Schema: `writeSchemas` in `cli/build-engine.mjs` emits `data.widgets` items and `data.shape` for toolbar and
  `data.attach` items for banner from the spec entry (no hand-written schema).
- `tab-group` is **not** made a host in this build (the archived branch did; follows under the snappable-assets items).

### 2. Settings keys (s4)

| Key | Holds | Scope |
| --- | --- | --- |
| `axf.toolbar.<id>.widgets` | **list** of slots `[{ type, id, at?, order?, hidden?, size?, show?, maxWidth?, maxUnit?, priority?, hideWhenEmpty?, overflow?, shape? }]`: what the person added to this toolbar (`at` set) and their choices for any widget on it | per toolbar instance, look setting (axHub appearance document) |
| `axf.toolbar.<id>.widgetStyle` | `{ size?, show?, priority?, hideWhenEmpty?, overflow?, shape? }` defaults for every widget on this toolbar | per toolbar |
| `axf.toolbars.widgetStyle` | the same, for every toolbar in the app | app |
| `axf.widgets.arrange.toolbar` | legacy app-toolbar arrangement (unchanged, read as a layer) | app |

Rules: `<id>` is the chrome-settings instance (`app` for the app toolbar). One slot per `type:id`; at most 60 slots
(`TOOLBAR_WIDGETS_MAX`); a slot with nothing in it is dropped and an empty list clears the key. Not per form factor:
a toolbar is one thing on every device (the banner keeps its phone/desktop split). Resolution order, lowest first:
toolbar asset `widgets[]` → run-time attachments (`rt.attachToToolbar`, origin = plugin) → `axf.widgets.arrange.toolbar`
(app toolbar only) → `axf.toolbars.widgetStyle` → `axf.toolbar.<id>.widgetStyle` → `axf.toolbar.<id>.widgets` (top).

Migration (`migrateToolbarWidgets`): nothing moves.
- The banner's keys (`axf.banners.widgets.*`, `axf.widgets.arrange.banner`) are the banner's and are never read for a
  toolbar; a widget on the banner stays there, and the same widget may also be added to a toolbar.
- A plain `{type, id, at}` entry in a toolbar asset keeps its place and draws with the banner defaults (compact chips,
  fixed shapes keep their own width), so today's app toolbar looks the same.
- An existing `axf.widgets.arrange.toolbar` is folded once into `axf.toolbar.app.widgets` (side + order only) when the
  person next changes that toolbar; until then it is read as a layer, so the saved order is honoured either way.

### 3. Reference engine (s3, `framework/core/engines/toolbar-widgets.ts` + `toolbar-widget-rules.mjs`)

Pure, fixture-pinned (`spec/fixtures/toolbar-widgets.json`), exported from `core/index.ts`.

- `TOOLBAR_WIDGETS_CONTRACT = 'toolbar-widgets@1'`, `TOOLBAR_APP_INSTANCE = 'app'`, `TOOLBAR_WIDGETS_MAX = 60`.
- Keys: `toolbarWidgetsKey(id)`, `toolbarWidgetStyleKey(id)`, `TOOLBARS_WIDGET_STYLE_KEY`; `toolbarInstanceId` = `toolbarIdOf`.
- `normalizeToolbarWidgetSlots(raw)` / `normalizeWidgetStyle(raw)`: only valid fields survive, damaged settings never trusted.
- `resolveToolbarWidgets(input)` → `{ start: ResolvedToolbarWidget[], end: …, hidden: key[], addable: key[] }`; each item
  `{ key, type, id, at, order, origin, view: BannerWidgetView, shape: string | null, attrs }` where `attrs` are the
  tokens the UI puts on the item: `data-fx-wsize`, `data-fx-wshow`, `--fx-widget-cap` (from `bannerWidgetCapCss`),
  `data-fx-shape` (slot shape → toolbar `shape.chip` / `shape.icon` by size → null). Hidden widgets are listed, not drawn.
- `fitToolbar(plan, available)` states the snap-not-overlap order the CSS follows, in px: (1) each side is the sum of its
  items + gaps and never shrinks; (2) the flexible piece (the toolbar's groups / search area, `flex.min`) gives way first,
  down to its minimum; (3) still too wide: widgets that may overflow leave for ⋯ by priority (`overflowWidgets`); (4) still
  too wide: the host scrolls sideways and every item is a snap point (`snap: [offsets]`). Output
  `{ sides: {start, end}, flex, overflow: key[], scroll: boolean, snap: number[] }`.
- Slot edits: `addToolbarWidget`, `removeToolbarWidget`, `patchToolbarWidget`, `moveToolbarWidget` (side + index, whole
  side renumbered × 10 like `moveOnHost`), `resetToolbarWidgets`; `parseToolbarWidgetArgs` for the action grammar below;
  `findToolbarWidget` = `findBannerWidget` over the resolved rows.
- Validation twin (`toolbar-widget-rules.mjs`, plain JS so `cli/build-engine.mjs` and `core/validate.ts` share it):
  `widgetSlotErrors(path, entry)` for `widget` fields and `shape`, `toolbarShapeErrors(data.shape)`; `check-widgets.mts`
  asserts both validators give the same messages.

### 4. Addresses and API (the Opus phase builds them; the names are fixed here)

Every toolbar is a console-control target already (`toolbar:<instance>`); widgets hang under it.

| Surface | Form |
| --- | --- |
| Deep link | `console_show` / `axf console open` address `toolbar:<instance>/widgets` opens the picker; `toolbar:<instance>/widget:<type:id>` focuses one widget; `dialog:axf.toolbar.widgets` |
| State | `setting:axf.toolbar.<id>.widgets` (readable through `console_settings` like any key); `rt.toolbarWidgetRows(instance)` lists every widget on the bar or addable |
| Console actions | `toolbar.widgets[:<instance>]` (picker), `toolbar.widget:[<instance>:]<name>:<op>` with op `add \| remove \| hide \| show \| reset \| icon \| compact \| normal \| wide \| start \| end`, `toolbar.widget.shape:<instance>:<name>:<shape id \| inherit>`, `toolbar.widgets.reset[:<instance>]`. Two arguments mean the app toolbar; a key with a colon (`status:cpu`) needs the instance spelled out |
| REST | `POST /api/console-control` with the addresses above; `/api/console/actions` for the actions; the toolbars plugin route `GET/PUT /api/plugins/toolbars/<instance>/widgets` |
| MCP | `console_action("toolbar.widget", ["settings", "cpu", "add"])`, `console_control_*` on the addresses, plugin command `toolbars widgets` |
| CLI | `node framework/cli/console.mjs action toolbar.widget settings cpu add`; `axf toolbar-widgets <instance> list\|add\|remove\|set\|reset` |
| Voice (AmberX) | "add the CPU widget to the settings toolbar", "make the clock on the main toolbar icon only", "put the search bar at the end of the build toolbar" → the same actions through `console-control-voice.mjs` |

UI (Opus phase): right-click / long-press any toolbar → **Widgets…** (the banner picker on the toolbar's rows), a **Widgets**
tab in the toolbar's chrome settings dialog (`chrome-toolbar` + every app copy), **Add a widget** over the one registry
(every widget asset + every chip a plugin attached anywhere, with its hint), drag on the bar = arrange mode for that bar.
Every control is a framework control with a `data-axf-target`; tokens only (`--fx-*`), `check-theme`, `check-controls`,
`check-toolbars`, `check-console-control` stay green.

## Pending-list clashes

- `toolbar-widgets-in-any-banner-style` (pending, Opus, no steps) is this build under another name: marked merged into
  this build.
- `toolbar-widgets-attach-any-banner-style` (archived, PR #656) is superseded by this rebuild.
- `banner-widget-shapes-more-than-circle` (archived, PR #703, not landed) / `banner-widget-shapes-and-change-icon`
  (pending): this build reserves `widgets[].shape`, `toolbar.shape { icon, chip }` and `data-fx-shape` on toolbar widgets
  so the shape chain resolves toolbars with no second contract; noted on the pending item, not built here.

## Steps

- s1 this note. s2 spec + JSON Schemas. s3 engine + export. s4 keys + migration + validators. s5 fixture + PORTING.md
  (Kotlin twin deferred: `ToolbarWidgetsEngine.kt`, `AxfToolbar` instance hosts, the Compose picker).

## Decided while building (Phase 1)

- **A toolbar with no asset of its own** (a hand-drawn strip carrying `data-axf-toolbar="<id>"`) resolves as an empty
  list under the app toolbar's `shape` defaults: run-time widgets attached to that instance and the person's slots draw
  there, nothing of the app toolbar's own list does (`rt.toolbarInstanceData`).
- **Legacy arrangement retires on the first save.** `saveToolbarWidgetSlots` folds `axf.widgets.arrange.toolbar` into the
  app toolbar's slots, clears that key first, then writes the slots. Reading it as a layer until then keeps the order
  on every device that has not saved yet.
- **Kernel fix:** `SettingsRegistry.clear` replaced the in-memory values with what storage held, so a session without
  storage (headless runtime, the spec checks) lost every other in-memory setting when one key was cleared. It now merges
  the way `set` already did (storage wins per key). Found by the toolbar-widgets runtime check; the four other checks
  that clear settings (chrome-apply, embed, hub-look, interface) stay green.
- **Fixture drift:** regenerating produced only `toolbar-widgets.json` (new) and the three new `validation.json` cases.
- **Phase 2 (Opus) reads from here:** runtime `toolbarInstanceWidgets / toolbarWidgetSlots / addToolbarWidget /
  removeToolbarWidget / setToolbarWidget / moveToolbarWidget / resetToolbarWidgets / setToolbarWidgetStyle`,
  `attachToToolbar(a, instance)`; the React `Toolbar` / `AssetToolbar` should draw `toolbarInstanceWidgets(instance)`
  and put each item's `attrs` on the item; arrange mode on a toolbar should call `moveToolbarWidget` (the app toolbar's
  `moveHostItem('toolbar', …)` still works through the legacy layer until then). `fitToolbar` is the contract the CSS
  must match when the toolbar gets its ⋯ button and the sides' `minmax(max-content, 1fr)` grid like the banner's.
