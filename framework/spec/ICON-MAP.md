# Icon map and icon packs (icon-map@1, icon-pack@1, icon-scope@1)

Build `icon-packs-with-drag-drop-pack-designer` (Nov 16 2026). Brett: "Very powerful, nice, easy to use drag and drop,
random generated ones, import icons from different sources. Make it sick."

Every place a UI draws an icon, a badge or an app icon is a **spot**. A spot has an id, a kind and a default glyph; an
**icon pack** says what each spot (or each glyph name) draws; a **scope chain** says which pack is in force where. The
designer, the API and the CLI all work on these three contracts, so a pack made by drag and drop, by the generator or
from an import is the same asset everywhere.

## Spot ids: `<app>:<area>/<slot>`

| part | what | examples |
| --- | --- | --- |
| `app` | the app the spot lives in; `framework` for framework/react and framework/libs (drawn inside every app) | `framework`, `console-web`, `amberx-droid`, `axhub-web`, `molly`, `expenses`, `walkthrough-studio` |
| `area` | the component, view, plugin, pane or library (kebab-case from the source path): `plugin-<id>`, `view-<name>`, `lib-<name>`, `studio-<name>`, `windows-<name>`, `pane-<name>`, `module-<name>`, a component's own name, `badge` for badge assets, `app` for app icons | `console-web:plugin-systems-check`, `framework:tab-group`, `framework:lib-settings` |
| `slot` | the role: the glyph name a literal `<Icon name="…">` asks for; for a dynamic `name={…}` the prop or expression it reads (`icon`, `chrome-icons`); `badge` for a badge drawn from data; a badge asset's id; `favicon` / `launcher` for app icons; `plugin-icon` for a plugin's own icon | `framework:tab-group/x`, `framework:banner/icon`, `console-web:app/favicon` |

Kinds: `icon` (a glyph in a control, menu, list, toolbar or banner), `badge` (a badge@1 asset or a badge drawn from data:
a glyph with a tone, a pill or a dot), `app-icon` (favicon, launcher, store icon: a mark on a tile, not a stroke glyph).

A **static** spot has its default glyph in its id (`…/x` draws `x`). A **dynamic** spot takes its glyph name from data at
run time (menus, toolbars, nav items, badges, widgets); it has no default glyph of its own, and a pack reaches it through
its **per-name** entries (`glyphs.<name>`) rather than a per-spot entry. Both are registered, so coverage reports see them.

Pattern: `^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9.-]*/[a-z0-9][a-z0-9.-]*$` (`SPOT_ID` in `cli/icon-map.mjs`, mirrored by the
engines in s4–s5).

## The inventory (Nov 16 2026, `node framework/cli/icon-map.mjs scan`)

`framework/spec/icon-inventory.json` (icon-inventory@1) is the scan of main's source: every `<Icon name=…>`, `<Badge>`,
badge asset, plugin icon and app icon, baked `src/axf` copies skipped. `icon-map.mjs list [--app] [--kind]` prints it.
The starter asset `framework/assets/icon-map/default.json` (s10) is generated from it.

| app | spots | areas | icon | badge | app-icon | dynamic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| framework (react + libs, inside every app) | 151 | 41 | 149 | 2 | 0 | 68 |
| console-web (shell, views, 69 plugins) | 487 | 69 | 486 | 0 | 1 | 205 |
| amberx-droid (web, 8 plugins) | 38 | 9 | 36 | 0 | 2 | 28 |
| axhub-web | 2 | 2 | 1 | 0 | 1 | 1 |
| molly (2 plugins) | 6 | 3 | 5 | 0 | 1 | 3 |
| expenses | 1 | 1 | 0 | 1 | 0 | 1 |
| walkthrough-studio | 26 | 7 | 25 | 1 | 0 | 17 |
| **total** | **711** | **132** | **702** | **4** | **5** | **323** |

On top of the component spots, **1 507 `icon` fields in 189 asset files** (menus, toolbars, nav items, context menus,
widgets, cards, plugin pages) name glyphs by data. They are not enumerated as spots: the loader that draws them
registers a dynamic spot per host (`framework:app-menu/icon`, `framework:banner/icon`, `framework:widgets/icon`, …), and a
pack restyles them through per-name entries. 66 distinct glyph names are asked for by source, 64 of them in the
framework set (`react/components/Icon.tsx`, 88 names); `calendar` and `message` fall back to `box` today and are the
first two gaps a pack can fill.

Where the spots are (the areas with the most, full list in the inventory):

- **framework**: `app-menu` (7), `menu-list` (6), `tab-group` (5), `chrome` (5), `windows-window-host` (13: external,
  layout, grid, x, grip, minimize, settings, download, minus + 4 dynamic), `nav-tree` (7, 6 dynamic), `controls` (4),
  `lib-settings` (10), `lib-workspace` (9), `lib-approvals` (7, one badge), `studio-*` (20 across the asset studio),
  `banner` / `banner-settings` / `banner-widgets` (5), `widgets` (3 dynamic: every widget icon), `badge/new` (the one
  starter badge asset).
- **console-web**: the shell (`change-batch`, `command-text`, `empty-state`, `search-palette`), eight views
  (`view-explorer` 10, `view-plan` 10, `view-boilerplates` 9, `view-pending` 9, `view-build-manager` 8, `view-standards` 7,
  `view-demos-modules`, `view-library-templates`), and 61 plugins with icons, the largest `plugin-console-terminal` (36),
  `plugin-ai-assistant` (29), `plugin-systems-check` (23), `plugin-plan-studio` (22), `plugin-build-orchestrator` (20),
  `plugin-md-studio` (18), `plugin-claude-handoff` (15), `plugin-plugin-manager` (14), `plugin-push-banner` (14). Sixteen
  plugins declare a `plugin.json` icon (`…/plugin-icon`).
- **amberx-droid** (web): `plugin-companion` (16), `plugin-notes` (10), `plugin-commands` (4), `plugin-ai`, `plugin-tasks`,
  `plugin-voice`, `plugin-web`, `plugin-lifecycle`; app icons `app/favicon` and `app/launcher` (the Android adaptive
  launcher under `android/app/src/main/res/mipmap-*`, a PNG set: an app-icon spot, drawn from a pack's app-icon entry
  when the Android side resumes).
- **axhub-web**: one dynamic spot (`view-held-call/icon`); everything else axHub draws is its own server pages, which read
  the appearance palette only. **molly**: `plugin-toolbar-designer` (3), `plugin-xlayout` (2). **expenses**: one badge
  spot. **walkthrough-studio**: six panes (26).

Badges: badge@1 assets are attachable (banners draw them, `framework/react/components/Banner.tsx`), so a badge spot is
`<app>:badge/<asset id>` with the asset's `data.icon` as default glyph; badges drawn from data (approvals, expenses) are
dynamic `…/badge` spots. The hubstatus badge is a `status` widget (a dot, no glyph) and is not a spot.

## What the archived build left behind

`icon-map-icon-packs-every-icon-badge-app` (PR #664, closed unmerged, archived Nov 16 2026: ">500 behind main") landed
nothing of its own. What main has today, and this build stands on:

- **icon-pack@1** (enterprise-branding s6–s9, `core/engines/brand-rules.mjs` `normalizeIconPack` / `iconPackErrors`,
  `core/engines/brand.ts` `glyphFor` / `glyphSvg` / `splitGlyph`): style outline | filled | duotone | sharp | rounded,
  grid 16–48, stroke, linecap, `fallback: framework | none`, `glyphs.<name> = { d, fill?, secondary? }` (path commands
  only, `PATH_DATA`), 600 glyphs max. Starters: `assets/icon-pack/amberx-outline.json` (12 glyphs), two generated
  duotone packs (`pack-021`, `pack-053`, brand-gen seeds), 100 more in `framework/brand-library`. **Per-name only**: no
  spots, no sources, no extends, no licence, no seed on the asset. s2 extends the type in place; every existing pack
  stays valid (per-name entries are the `glyphs` map it already has).
- **Who picks a pack**: `branding@1 data.iconPack` (the branding package's pack), and `skin@1 data.iconPack`, which the
  skin engine writes to the setting **`axf.icons.pack.<scopeKey>`** (`SKIN_ICON_PACK_KEY`, `core/engines/skin.ts:59`,
  "the icon-map engine's own key, so icon maps read it as the scope's pack"). `rt.brandGlyph(name)` reads the skin's
  pack for the current scope, else the app's, else the branding's (`core/runtime.ts:3080`). `designpackage.ts` lists
  `axf.icons.` as a look-setting prefix the hub document carries. s3 keeps these keys as the pack layer of the scope
  chain and adds overrides and reset on top.
- **The Icon component** (`react/components/Icon.tsx`): 88 framework glyphs, `Icon name=…` reads `rt.brandGlyph`; no
  spot id, no registration. s11 adds `<AxfIcon spot=…>` and `useIconSpot`; `Icon` stays as the per-name path.
- **icon-sets@1** (`schemas/icon-sets.json`, `customize.ts iconSetCss`): 100 CSS restyles of the framework line icons
  (stroke, cap, fill, frame). Orthogonal: a set restyles whatever glyph is drawn, a pack decides which glyph.
- **The pending plan** (`fable-icon-map-icon-packs-icon-pack`, `icon-pack-studio-fable`, `icon-pack-studio-on-fable`,
  `icon-browser-manager` #377 archived) describes the same model (address → spot, hub → app → screen → plugin chain,
  sanitizer, seeded generator, designer). This build is the one that ships it; those records are merged into it.

## Contracts in this build

| step | contract | where |
| --- | --- | --- |
| s2 | icon-map@1, icon-pack@1 (extended) asset types | `schemas/asset-types.json`, `schemas/json/icon-map.schema.json`, `icon-pack.schema.json` |
| s3 | icon-scope@1 resolution + storage keys | this file (below), `spec/APPEARANCE-SOURCE.md` |
| s4 | `core/engines/icon-pack.ts` validate, fold extends, resolve, overrides, reset | fixture `spec/fixtures/icon-pack.json` |
| s5 | `core/engines/icon-map.ts` registry, dedupe, coverage, search | fixture `spec/fixtures/icon-pack.json` (`coverage`) |
| s6 | `core/engines/icon-gen.ts` seeded glyph grammar | fixture `spec/fixtures/icon-gen.json` |
| s7 | `core/engines/icon-import.ts` sanitizer + normalizer | fixture `spec/fixtures/icon-import.json` |
| s8 | validator rules (`axf validate --framework`) | `core/validate.ts`, `core/engines/icon-rules.mjs` |
| s10 | starter assets | `assets/icon-map/default.json`, `assets/icon-pack/{default,outline,filled,generated-*}.json` |
| s11 | `<AxfIcon spot=…>`, `useIconSpot`, `rt.icons` | `react/components/AxfIcon.tsx` |

Kotlin twin: deferred (Android on hold), recorded in `spec/PORTING.md` by s9.
