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
framework set (`core/engines/icon-glyphs.mjs`, 76 names, read by `react/components/Icon.tsx`); `calendar` and `message`
fall back to `box` today and are the first two gaps a pack can fill.

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
- **The Icon component** (`react/components/Icon.tsx`): 76 framework glyphs, `Icon name=…` reads `rt.brandGlyph`; no
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

## Which pack draws where: icon-scope@1

The chain for a place is the skin chain: **`plugin:<id>` → `ui:<view>` → `app` → `global` (hub-wide) → `brand`**, the
child overrides the parent. Engine `core/engines/icon-pack.ts` (`resolveIcon`, `iconChain`, s4), fixture
`spec/fixtures/icon-pack.json` (`scopes`, `resolve`, `reset`).

**Each level has a pack layer and an override layer.**

| level | pack (`pack`) | per-spot overrides (`overrides`) | where it is stored |
| --- | --- | --- | --- |
| `plugin:<id>` / `ui:<view>` | the scope's own pick, else the skin in force there (`axf.icons.pack.<scopeKey>`), else *inherit* | the scope's | app-look@1 `icon.scopes[<key>]` |
| `app` | the app's pick, else its skin's `iconPack`, else *inherit* | the app's | app-look@1 `icon.pack`, `icon.overrides` |
| `global` | the hub-wide pick, else the hub-wide / default skin's `iconPack`, else *inherit* | hub-wide | appearance@1 `icon.pack`, `icon.overrides` |
| `brand` | the branding package's `iconPack` (`branding@1 data.iconPack`), else none | — | the branding asset |

A level with no pick and no skin pack says nothing (*inherit*). The nearest level that names a pack decides the pack;
that pack's `extends` chain is folded first (inherit@1, depth ≤ 4, a cycle stops where it is).

**Resolving one spot** (`resolveIcon(spot, name, chain)` → `{ glyph, pack, scope, by }`), nearest level first:

1. **override**: an `overrides[spot]` entry at this level or any level nearer the leaf wins outright (`by: override`).
   An override is a glyph entry (path / svg / png / font / ref) or a glyph reference `pack:<id>/<name>` / `name:<glyph>`.
2. **spot**: the level's folded pack has a per-spot entry `spots[spot]` (`by: spot`).
3. **name**: the folded pack has a per-name entry `glyphs[<name>]` for the spot's glyph name (its default glyph, or the
   name a dynamic spot was given at run time) (`by: name`).
4. A name the pack lacks **falls through to the parent level's pack** while the pack says `fallback: framework`
   (the default), so a plugin's partial pack draws its own few glyphs and leaves the rest to the app's pack. A pack with
   `fallback: none` stops the walk: a name it lacks goes straight to step 5 (one consistent set, nothing mixed in).
5. **framework**: the framework glyph set (`react/components/Icon.tsx`), `by: framework`, `pack: ''`.

`scope` names the level that won (`plugin:<id>`, `ui:<view>`, `app`, `global`, `brand`, `framework`), so the designer
can show "from the app pack" / "overridden here" on every spot and offer the right reset.

**Reset** (pure, each returns the new document):

| op | what goes | function |
| --- | --- | --- |
| spot | one `overrides[spot]` at one level | `resetIconSpot(doc, spot, scopeKey?)` |
| scope | a `ui:` / `plugin:` entry (its pack and overrides) | `resetIconScope(look, scopeKey)` |
| app | the app's `icon` block (pack, scopes, overrides) | `resetIconApp(look)` |
| hub-wide | the shared document's `icon` block | `resetIconHub(appearance)` |

Resets never touch a skin's `iconPack` or the branding: after every reset the app draws what its skins and brand say.

**Dynamic spots** (`glyph: ''`): the name comes from data at run time (`<Icon name={item.icon}>`), so step 2 applies
only when a pack names the spot explicitly and step 3 uses the run-time name. `<AxfIcon spot=… name=…>` passes both.

**App icons** (`kind: app-icon`) resolve the same way; the winning glyph is tiled with the pack's `appIcon`
(shape, bg / fg tokens, padding) by `appIconSvg`.

### Storage

appearance@1 (hub-wide, `shared/settings/appearance.json`):

```json
"icon": { "pack": "outline", "overrides": { "framework:tab-group/x": "name:x-circle" } }
```

app-look@1 (`shared/settings/looks/<app>.json`):

```json
"icon": {
  "pack": "filled",
  "overrides": { "console-web:view-explorer/star": { "d": "M12 2 …" } },
  "scopes": { "plugin:console-terminal": { "pack": "generated-ember", "overrides": {} }, "ui:plan": { "pack": "", "overrides": { "console-web:view-plan/plus": "name:sparkles" } } }
}
```

`pack: ""` at a scope = inherit (the entry is kept for its overrides). Ids only and small glyph entries (an override
entry is capped like a pack glyph); never asset bodies. Both documents drop the block when it is empty. Settings:
the look document rides `axf.skin.look` as today, so the runtime needs no new key; the skin's `axf.icons.pack.<scopeKey>`
stays the skin layer. `axf.icons.*` is already an appearance setting prefix (`designpackage.ts`), so a skin's pack still
reaches every app through the hub document.

### Migration from the existing `iconPack` fields

Nothing on main stores an icon pick outside a skin or branding asset, so no document changes shape:

- `branding@1 data.iconPack` is the `brand` level, unchanged.
- `skin@1 data.iconPack` → `axf.icons.pack.<scopeKey>` is the skin layer at each level, unchanged (`SKIN_ICON_PACK_KEY`).
- `rt.brandGlyph(name)` (the per-name path `Icon` uses) is re-implemented over `resolveIcon` with no spot, so every
  existing `<Icon name=…>` draws exactly what it drew: with no `icon` block anywhere the chain is skin → branding →
  framework, as today. Pinned by the `legacy` cases of `spec/fixtures/icon-pack.json`.
- A look document that carries a top-level `iconPack` string or `own.settings["axf.icons.pack.app"]` (written by
  pre-main experiments) is read as `icon.pack` on normalize (`normalizeIconLook`) and written back in the new shape.

## Phase 1 delivered (Nov 16 2026): engines, assets, React

| piece | where | reached by |
| --- | --- | --- |
| spot inventory + scanner | `cli/icon-map.mjs scan \| list`, `spec/icon-inventory.json` | CLI |
| asset types | `schemas/asset-types.json` icon-map, icon-pack (extended); `schemas/json/icon-map.schema.json`, `icon-pack.schema.json` | `axf validate --framework`, build engine |
| rules (plain JS mirror) | `core/engines/icon-rules.mjs` | core validator, build engine, console server |
| framework glyph set | `core/engines/icon-glyphs.mjs` (`FRAMEWORK_GLYPHS`, 76) | Icon, AxfIcon, the `default` pack |
| pack engine | `core/engines/icon-pack.ts` (fold, chain, resolve, overrides, reset, markup) | `rt.resolveIconSpot`, `rt.iconMarkup`, `rt.appIconMarkup`, `rt.iconPack`, `rt.iconOverrides`, `rt.setIconPack`, `rt.setIconOverride`, `rt.resetIconSpot` / `resetIconScope` / `resetIconApp`, `rt.setHubIconPack` / `setHubIconOverride` / `resetHubIconSpot` / `resetHubIcon` |
| map engine | `core/engines/icon-map.ts` (registry, dedupe, coverage, search, tree) | `rt.registerIconSpot`, `rt.iconRegistry`, `rt.iconCoverageHere`, `rt.searchIconSpots`, `rt.iconSpotTree` |
| generator | `core/engines/icon-gen.ts` (`generateIcon`, `generatePack`, seeded) | `spec/gen-icon-starters.mts` (the `generated-ember` pack) |
| import | `core/engines/icon-import.ts` (`sanitizeSvg`, `normalizeSvg`, `importSvg`, `importPng`, `importGlyph`) | every upload / URL / library import |
| documents | appearance@1 `icon`, app-look@1 `icon` (`normalizeIconHub`, `normalizeIconLook`) | the hub, `skins.mjs`, the runtime |
| starters | `assets/icon-map/default.json`; `assets/icon-pack/default.json`, `outline.json`, `filled.json`, `generated-ember.json` | baked into every shared app (`shared-assets.mjs bake`) |
| React | `react/components/AxfIcon.tsx` (`<AxfIcon spot=… name=…>`, `useIconSpot`, `iconSizeCss`, `iconTintCss`); `Icon` draws through the same chain | every app on framework/react |
| fixtures + check | `spec/fixtures/icon-pack.json`, `icon-gen.json`, `icon-import.json`; `spec/check-icon-pack.mts` (CI) | `npx -y tsx framework/spec/check-icon-pack.mts` |

The runtime methods are the one surface the next phases wrap: the icon-packs plugin's REST routes, `framework/cli/icon-packs.mjs`,
the MCP tools (plugin commands) and the AmberX voice actions all call these same functions, and the designer plugin
(drag and drop, sources, generator panel, live preview) edits the same two documents. Nothing in this phase has a UI of
its own beyond `<AxfIcon>` (which draws what the API says), so the API-first rule holds: every pick, override and reset
is a runtime call today and a route, command and spoken action in the next phases.
