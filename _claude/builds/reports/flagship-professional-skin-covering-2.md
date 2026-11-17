# flagship-professional-skin-covering-2 (Current profile; Fable; Phase 1: the skin format)

Brett (Nov 17 2026 21:30, verbatim): "build a skin with Fable Ultra Code, really sick professional skin that covers
everything: context menus, app menus, navigation menus, animations, colors, behavior, hooks, everything. Show me where
the data sets go, the layouts, every single thing. Professional. One app: axHub, console, AmberX all as one app."

Branch `claude/flagship-professional-skin-covering-2`. Plan Studio plan `flagship-professional-skin` (s1) holds the
surface and app inventory; this report holds the audit, the design and what landed.

## s2: audit of skin@1 against the registry

`node framework/spec/check-skin-coverage.mjs` over `framework/schemas/asset-types.json` + `schemas/customize.json`:
55 registered types, slot 30, parts 14, reference 3, bundle 4, none 4, uncovered 0. Every *asset type* is reachable.
The gaps are not types: they are the things Brett named that no asset type and no skin field expresses yet.

| Surface (plan s1) | Covered today by | How | Gap (not expressible on skin@1 yet) |
| --- | --- | --- | --- |
| Colours | `colorTheme`, `colorThemes { light, dark }` | slot `color-theme` (skin-modes@1), `--fx-*` colour tokens, `--fx-opacity-*` | none |
| Style | `styleTheme`, `assets.typography / density / sizing`, `extras.settings['axf.tokens.*']` | slot `style-theme` + scale slots; component tokens `grid` / `tabs` on the style theme | none |
| Layout | `layoutTheme`, `assets.dock-layout / xlayout`, `extras.spacing`, `extras.hidden` | slots, spacing, hidden chrome | none |
| Context menus | `assets.context-menu`, `chrome.context-menu` (interface, instances) | slot + chrome-settings@1 | enter / exit motion; hooks per target |
| App menus | `assets.app-menu`, `chrome.app-menu` | slot + chrome-settings@1 | enter / exit motion; hooks |
| Navigation menus | `assets.nav-menu`, `assets.nav-style`, `chrome.nav-menu` | slot + chrome-settings@1 + nav-style@1 | collapse default; motion; hooks |
| Tab groups | `assets.tab-group`, `chrome.tab-group.instances.<id>` | slot + chrome-settings@1 + `--fx-tab-*` | kind-wide overflow / sticky / collapse defaults (today per instance only); motion; hooks |
| Toolbars | `assets.toolbar`, `chrome.toolbar` | slot + chrome-settings@1 (page-toolbar@1) | tap-confirm arm time; collapse default; drop zones; hooks; motion |
| Banners + widgets | `assets.banner`, `parts.<widget>` | slot + parts (box / text / icon / items) | motion; hooks |
| Grids | style theme `grid` map through `extras.settings['axf.tokens.style']` | `--fx-grid-*` (component-tokens@1) | row density, rows per item, header style, zebra, lines as one skin slot (today 30 raw tokens) |
| Dialogs + pop-ups | `assets.dialog`, `assets.popup`, behaviour theme `windows.*` | slot + behaviour theme | dialog chrome (frame, backdrop, header, close) as a skin slot over the active dialog asset |
| Settings interfaces | `assets.settings`, `chrome.<kind>.interface` | slot + chrome-settings@1 | one place that names the settings asset per kind and the page |
| Animations | `behaviorTheme` (motion group: speed, easing, reduced, entrance, swatches, skinSwitch, picker, animSpeed, animIntensity) | `--fx-motion`, `--fx-ease`, `--fx-anim-*`, `data-fx-*` | durations as values, easings per role (standard / emphasized / exit), enter / exit per chrome kind, reduced-motion on the skin itself |
| Behaviour | `behaviorTheme` (interaction, windows, feedback) | behaviour theme | tap-confirm arm time + per-kind switch; hover / press / focus feedback on the skin; overflow modes; sticky / collapse defaults |
| Hooks | nothing | nothing | hook refs per chrome kind and grid row (hook@1 / grid-hook@1 / lib-dnd zones) |
| Brand | `iconPack`, `assets.branding` | reference (icon-pack; logo-mark + animated-logo via branding) | none |
| Where everything lives | nothing | nothing | skin-map@1: a generated read-only document (slot → asset / dataset / layout, tokens, components, hub / repo / data-store paths) |
| Apps | app-look@1 per app + `defaultSkin` on appearance@1 | hub default skin = the floor every app stands on | none (Phase 2 sets the Fable Ultra Code skin as the hub default) |

Note on hooks: `hook@1` / `drop-target@1` were dropped from build toolbar-tap-confirm (s13-s18, `framework/catalog/libraries.json`
`axf.toolbars.drop`). What exists: grid row hooks (grid-hook@1, `framework/libs/datagrid/datasets.ts`) and lib-dnd zones
(`data-axf-drop`). The skin's hook slot carries refs; the engine resolves them against a registry the host supplies.

## s3: the new skin@1 slots (optional, additive; an old skin is byte-identical after normalising)

| Slot | Shape | Compiles to |
| --- | --- | --- |
| `motion` | `{ speed?: { fast, normal, slow } ms (0..2000), easing?: { standard, emphasized, exit } (name or cubic-bezier), reduced?: system \| always \| never, chrome?: { <kind>: { enter, exit, duration, stagger } } }`; kinds = the six chrome-settings@1 kinds + dialog, popup, grid, page | `--fx-motion-fast / -normal / -slow`, `--fx-motion-ease-standard / -emphasized / -exit`, `--fx-motion-<kind>-enter / -exit / -dur / -stagger`, `data-fx-motion-reduced` |
| `behavior` | `{ tapConfirm?: { armMs 1000..10000, <tap kind>: on \| off }, hover?, press?, focusRing? (behaviour-theme enums), overflow?: { tab-group }, sticky?: { tab-group }, collapse?: { tab-group, toolbar, nav-menu } }` | settings: `axf.toolbars.armMs`, `axf.toolbars.tapConfirm` / `axf.tapConfirm.<kind>`, `axf.behavior` (interaction overrides over the behaviour theme), `axf.chrome.<kind>.*` (kind-wide field defaults under every instance override), `axf.nav.collapsed` |
| `hooks` | `{ <kind>: { hooks?: [ id \| { id, args? } ], drop?: [ zone ids ] } }`; kinds = the six chrome kinds + grid-row | settings `axf.hooks.<kind>`; `resolveSkinHooks(hooks, registry)` says which refs the host knows |
| `grid` | `{ density?: compact \| regular \| roomy, rows?: 1..6, header?: plain \| bold \| boxed \| hidden, zebra?: bool, lines?: none \| rows \| cells, sticky?: bool }` | `axf.tokens.style['*']` grid paths (`grid.rowHeight`, `grid.cellPadY/X`, `grid.headerWeight`, `grid.headerBg`, `grid.rowAltBg`, `grid.lineColor`, `grid.stickyShadow`) + `axf.grid` for the DataGrid attributes |
| `dialog` | the dialog asset's own fields as overrides: `{ variant?, backdrop?, animation?, header?, closeOnBackdrop?, width? }` | settings `axf.chrome.dialog` (field overrides over the active dialog asset, compiled by `dialogStyle`) |
| `settings` | `{ page?: settings asset id, <chrome kind>?: settings asset id }` | slot `settings` (page) and `axf.chrome.settings.<kind>` (chrome-settings@1 pick; `chrome.<kind>.interface` wins when both name one) |

Precedence stays child-overrides-parent through `resolveLookSkin`; every unset slot compiles to nothing, so today's
defaults (axf.css `:root`, the behaviour theme, chrome-settings@1 field defaults) stand.
