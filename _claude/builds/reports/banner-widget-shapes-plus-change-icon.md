# Banner widget shapes plus change icon

Build `banner-widget-shapes-plus-change-icon` · branch `claude/banner-widget-shapes-plus-change-icon` · PR #821.
Phase 1 (Fable, s1–s4): the widget-shape@1 contract, migration, engine and golden fixture. Phase 2 (Opus, s5–s19): this report.
Brett asked (Nov 16 2026): "Rebuild." (a fresh rebuild on main of `banner-widget-shapes-more-than-circle`, which was archived).

## What changed

Every banner widget now has a **shape** (circle, square, rounded, pill, hexagon, or a custom SVG outline) and an **icon**
(its own, or any glyph of a registered icon pack). An unset or old widget stays a circle with its own icon: nothing moves
until someone picks.

- **Engine** (`framework/core/engines/bannerwidgets.ts`, s1–s4): `resolveWidgetShape`, `widgetShapeTokens`,
  `flattenCustomPath` / `customPathClip` (custom outlines become percent polygons that scale on every port; bad input
  falls back to circle), the migration, and now `WIDGET_SHAPE_PRESETS` (diamond, octagon, triangle, shield, star, tag,
  squircle, leaf; append-only, each proven by check-widgets).
- **Theme tokens** (s5): the radius each shape compiles to is the component-tokens@1 `widget` family
  (`--fx-widget-shape-circle | rounded | pill | square`, defaults in the axf.css `:root` block), so a style theme
  (`data.widget.*`) or one widget's instance overrides retune a shape; no px literals in the engine. The customize
  `widgetShape` token reaches the toolbar's widget slots and every widget type's style target (skin parts box).
- **CSS** (s6, `framework/ui/axf.css` banner section): banner items and toolbar widget slots read
  `--fx-widget-shape-radius` / `--fx-widget-shape-clip`, no fallbacks. Pill and hexagon/custom bodies get room from the
  density gaps so the clip never bites the glyph; clipped bodies draw focus inside. A shape only rounds or clips the
  body's own box, so attached widgets keep the snap / no-overlap rule for every shape.
- **React host** (s7, `framework/react/components/widgetShape.ts`): one helper for banner items, the banner strip,
  the ⋯ menu and toolbar widget slots (`data-fx-wshape`, `data-fx-shaped` + inline tokens when chosen); toolbar
  widgets get the same `IconOverride` as banner widgets. Role, aria and SkinScope untouched.
- **Context menu** (s8): a context contribution can be scoped to a banner widget (`scope: 'banner-widget'`, `{widget}` /
  `{label}` filled in), data only and portable. Right-click / long-press a widget: **Shape ▸** (Circle … Hexagon,
  Custom…) and **Change icon…**.
- **Change icon picker** (s9, `WidgetIconPicker.tsx`, dialog `axf.banner.widget-icon`): pack in force first, search,
  glyph grid, Reset to widget default.
- **Custom shape editor** (s10, `WidgetShapeEditor.tsx`, dialog `axf.banner.widget-shape`): preset swatches, paste a
  path, live preview; the engine is the only judge.
- **Banners settings** (s11, `BannerWidgetShapeRows.tsx`): Settings → Plugins → Banners → *Widget shape and icon*, one
  row per widget. Shape and Icon from **Basic**, the custom outline field from **Developer** (settings level toolbar).

## How each feature is reached

`<widget>` is the banner widget key `<type>:<id>`, e.g. `clock:digital-12h` (REST, MCP and the CLI also take a type,
id or label).

| Feature | Deep link (console_show / console_open) | REST | MCP | CLI | Voice (AmberX) |
|---|---|---|---|---|---|
| List / read every widget's shape and icon | `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=banners` | `GET /api/console-control/banner-widgets[/<widget>]` | `console_control_banner_widget` (no args / `widget=`) | `axf banner widget list` · `get <widget>` | "set the clock shape to …" reads via search |
| Set a shape | `setting:banner.widget.<widget>.shape` | `POST …/banner-widgets/<widget>/shape {shape}` | `widget=… shape=hexagon` | `axf banner widget shape <widget> hexagon` | "make the clock a hexagon" |
| Custom outline | `function:banner.widget.<widget>.custom-shape` (opens the editor) · `setting:banner.widget.<widget>.path` | `POST …/<widget>/shape {path}` or `…/path {path}` | `widget=… path="M50 0 …Z"` | `axf banner widget shape <widget> --path "…"` | — (an outline isn't spoken) |
| Change icon | `function:banner.widget.<widget>.change-icon` (opens the picker) · `setting:banner.widget.<widget>.icon` | `POST …/<widget>/icon {icon: <pack>/<glyph> \| own}` | `widget=… icon=amberx-outline/bell` | `axf banner widget icon <widget> <pack>/<glyph>\|own` | "change the clock's icon" (opens the picker) |
| Reset one widget | `function:banner.widget.<widget>.reset` | `POST …/<widget>/reset {confirm: true}` | `widget=… reset=true confirm=true` | `axf banner widget reset <widget> --confirm` | "reset the clock widget" |
| Shape submenu | `function:banner.widget.shape-menu` (press with `<widget>:<shape>`) | via `/do` | `console_control_do` | `axf console do press function:banner.widget.shape-menu --value clock:digital-12h:pill` | — |
| Open a dialog | — | `POST …/<widget>/open {what: settings\|shape\|icon}` | `widget=… open=icon` | `axf banner widget open <widget> icon` | — |

Console actions (menus, Ctrl+K, voice, plugin commands): `banner.widget:<widget>:<shape>|path=<svg>|icon=<pack>/<glyph>|icon=own|reset`,
plus the named forms `banner.widget.shape`, `banner.widget.icon`, `banner.widget.reset`, `banner.widget.icon-picker`,
`banner.widget.custom-shape`. All surfaces end in the same console-control command on the same derived address
(proved by `apps/console-web/server/tests/test_banner_widgets.py`). Reset is a resetting press: every surface answers
`confirmation_required` until it is sent with confirm.

There is no separate "banners" plugin (the Banners settings are the framework's own), so the routes live on the
console-control API next to the toolbars routes, and the UI Review option assets under `plugins/console-commands`.

## Checks

validate --framework, check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control (node and
mts), token-registry check, check-skin-coverage, check-component-tokens, check-widgets (485), check-customize,
shared-assets check, chrome-settings check, check-done-means-merged, tracker --check: all pass. Console typecheck and
`npm run build` pass. Python: test_console_control.py, test_banner_widgets.py, test_mcp_tools.py (14 passed).

**theme-swap.mjs** on the built console: one finding, the dialog scrim (`.fx-backdrop`, `--fx-scrim` is black by
design) never follows the colour theme. The same finding shows on a build of `origin/main`, so it is pre-existing and
not from this build.

## UI Review (hold)

Item `r-20261117-e3w9v01`, group *Banner widget shapes plus change icon*: desktop + phone of the Shape menu, the bar
with a hexagon widget, the custom shape editor and the Change icon picker. Three choices (ui-choices@1, dialog assets in
`apps/console-web/plugins/console-commands/assets/dialog/`): the picker and editor open as a **centered modal**, a
**bottom sheet** or a **side drawer**. The PR is held until Brett decides. Shots are reproducible with
`node apps/console-web/scripts/banner-widget-shape-shots.mjs <out-dir>` after `npm run build`.

## Overlap

`icon-picker-every-banner-settings-widget` (#820) runs in parallel with its own widget-icons@1 contract
(`axf.widget.<id>.icon`) and an `IconPicker`. Notes are on both builds: whichever lands second routes its Change icon…
through the one picker and bridges the per-widget key, so there's one icon override per widget.

## Deferred gap (Android)

Kotlin twin of widget-shape@1 (`BannerWidgetEngine.kt`: shape fields, the one-shot migration, Compose clip shapes, the
component-tokens `widget` family): recorded in `framework/spec/PORTING.md`, Android port on hold (Oct 21 2026).
