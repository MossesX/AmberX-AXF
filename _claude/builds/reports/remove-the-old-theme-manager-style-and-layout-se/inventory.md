# Inventory: every old appearance control (build `remove-the-old-theme-manager-style-and-layout-se`, s1)

Brett (Nov 10 2026): "We need to remove all the styling and theme and layout stuff. Remove it all because the new
thing's going to override it." The new thing is the skin: one asset that is the whole look, with a colour theme
inside it. This inventory lists every place that still lets someone pick, edit or read a theme, style theme, layout
or other look option on its own, and says where each one lands in the skin model.

Repo layout note: the brief's "packages/framework/…" paths do not exist; the framework is `framework/` (core engines
in `framework/core/engines`, React shell in `framework/react`, shared settings UI in `framework/libs/settings`) and
every app keeps a baked copy under `apps/<app>/src/axf/` (`framework/cli/shared-assets.mjs`, CI-checked). Any change
below is made in `framework/` and lands in every app copy by the bake.

## The skin model this maps onto

- **On main today (skin@1, `framework/core/engines/skin.ts` + `skin-rules.mjs`)**: `data.layoutTheme`, `colorTheme`,
  `styleTheme` (ids), `assets` (every other slot → id), `iconPack`, `parts`, `extras { spacing, hidden, settings }`.
  Each app has an app-look@1 document (`shared/settings/looks/<app>.json`, or the `axf.skin.look` setting without a
  hub): `default` snapshot, `own` picks, `skin { use, id, overrides }`, `scopes`, `undo`. The shared appearance@1
  document (`shared/settings/appearance.json`) stays the transport for `skin` (hub-wide) and `axf.tokens.*` overrides.
- **PR #430 (`claude/appearance-skins-colour-themes-only-remove-design-packs`, open, CI red, 1082 commits behind
  main)**: skin@2 adds `behaviorTheme` and `sections { colors, style, layout, behavior }` (a section is either a preset
  id or written inline), every design package and style package becomes a skin with the same id, the four theme
  pickers go, `migrateLegacyLook` folds an app-look's retired slots into the skin pick. This build is based on main
  (the PR does not land cleanly) and uses the same field names, so whichever lands second has no naming conflict:
  the four section fields and the `sections` block are the only skin fields this build writes to.

Mapping rule used throughout: **a pick that used to be its own setting becomes a part of the active skin**. The
colour theme stays swappable inside the skin (Brett: the skin and its colour theme). Everything else (style theme,
layout theme, behaviour theme, spacing, scale assets, chrome picks) is the skin's and only changes by changing skin
or by a skin-level override (`skin.overrides[type]`, the "dot + Back to skin" model that already exists).

## 1. Settings keys (what s2 retires or folds)

| key / field | where defined | what it holds | lands in |
| --- | --- | --- | --- |
| appearance@1 `slots['color-theme' \| 'style-theme' \| 'layout' \| 'behavior-theme']` | `framework/core/engines/appearance.ts` | the four themes picked on their own | skin sections (`colorTheme`, `styleTheme`, `layoutTheme`, `behaviorTheme`); the colour theme stays the one swappable override |
| appearance@1 `slots['design-package' \| 'style-package']` | same | the package picked | the skin of the same id (PR #430 model); dropped from the document (`APPEARANCE_NEVER`) |
| appearance@1 `slots['typography' \| 'density' \| 'sizing']` | same; scale engine `engines/scale.ts` | density / sizing / typography scale picks ("density/layout options") | `skin.data.assets[type]` (the Windows skin already names them); a saved pick becomes a skin override |
| appearance@1 `spacing` | same; `SPACING_KEY = 'axf.appearance.spacing'` in `runtime.ts:125` | tight / compact / regular | `skin.data.extras.spacing`; a saved value becomes `skin.overrides` extras, nothing is picked on its own |
| appearance@1 `hidden` | same | chrome shown / hidden | stays: `skin.data.extras.hidden`, and the Visible parts control is a skin-level override, not a theme setting |
| appearance@1 `settings['axf.tokens.theme' \| 'axf.tokens.style' \| 'axf.tokens.layout' \| 'axf.tokens.typography' \| 'axf.tokens.density' \| 'axf.tokens.sizing']` | `engines/control-tokens.mjs` (`CONTROL_TOKENS_PREFIX`), `schemas/control.json` targets | control@1 per-token overrides on the four themes and the scale assets | kept as **skin-level token overrides** (the API's one hand-tuning path); backed up and left in place by the migration; later phase (s7/s8) decides whether `tokens.theme/style/layout` stay as targets or become `tokens.skin.*` |
| `axf.appearance.design` (`DESIGN_APPLIED_KEY`) | `engines/designpackage.ts:31` | the design package applied | the skin pick (`skin.id`), then deleted |
| `axf.appearance.package` (`PACKAGE_APPLIED_KEY`) | `engines/designpackage.ts:33` | retired appearance-package pick | read once as a skin id, then deleted |
| `axf.appearance.overrides` (`DESIGN_OVERRIDES_KEY`) | `engines/designpackage.ts:115` | precedence overrides of design packages | deleted (skins have `overrides` by slot) |
| `axf.appearance.interface` (`INTERFACE_SETTING_KEY`) | `engines/interface.ts:28` | interface applied | the interface's `design` reads as the skin (PR #430 alias); the key is retired |
| `axf.look` (Sliders, retired Nov 1) + `axf.look.sliders` | `framework/libs/settings/index.tsx:301` | look@1 token overrides for the page | deleted (already retired; the migration backs it up and clears it) |
| `axf.hub.appearance.follow` (`APPEARANCE_FOLLOW_KEY`) | `runtime.ts:141` | retired switch | deleted |
| app-look@1 `own.slots[color-theme \| style-theme \| layout \| behavior-theme \| design-package \| style-package]` | `engines/skin-rules.mjs` | an app's own theme picks with no skin on | folded into `skin { use: true, id, overrides }`: the picks become the skin id when they match a skin, else overrides on the app's default skin; `own` keeps only non-theme slots |
| app-look@1 `default.slots[...]` snapshot | same | the look at landing | kept as the snapshot (Restore to default still works); read only through the skin chain |
| `axf.skin.look`, `axf.skin.whereLayout`, `axf.lock.appearance` | `runtime.ts:133`, `libs/settings/skinwhere.tsx:19`, `runtime.ts:131` | the skin document without a hub, the Where layout, the look lock | **kept** (skin model) |
| `axf.nav.width`, `axf.nav.open`, `axf.nav.collapsed`, `axf.tokens.nav` | `runtime.ts:99-101`, `engines/navstyle.ts` | nav width / state, nav-style overrides | kept: nav state is not a look pick; nav-style is a slot the skin fills |
| `axf.display.fontScale`, `axf.display.animations` | `core/settings.ts:18`, `libs/settings/index.tsx:798` | accessibility display settings | kept (not theme) |
| plugin look (`libs/plugintheme`, key `PLUGIN_LOOK_KEY`, one per plugin) | `framework/libs/plugintheme/core.ts` | a per-plugin theme override (colour / style / layout tokens) | superseded by skin scopes `plugin:<id>` (`scopes` in app-look@1); backed up; the override switch is retired in s6 |
| manifest `defaults['color-theme' \| 'style-theme' \| 'layout' \| 'behavior-theme' \| 'design-package']` | every `apps/*/axf.manifest.json` | the app's default themes | stay as the app's default **skin** (`skins.mjs snapshot` keeps the default look); the shell reads them only through the default skin |

## 2. Shared GUI framework (what s3 changes)

| control | file | what it does | lands in |
| --- | --- | --- | --- |
| Settings → Appearance panel titled "Theme manager" | `framework/libs/settings/index.tsx:564-634` (`AppearancePanel`, `DESIGN_PANEL_ID`, rows `Style theme`, `Colour theme`, `Layout theme`) | skin picker + Use skin switch + the three theme rows + Visible parts + Restore | the three rows go; the panel keeps Skin, Colour theme (the skin's swappable section), Where the skin applies, Visible parts, Restore |
| Skin picker dialog (`axf.settings.skin`) | same file `639-675` | tap to preview, Apply, Turn skin off, Reset | kept |
| `compileStyles()` | `framework/core/runtime.ts:2442-2495` | compiles `color-theme`, `style-theme`, `layout`, scale assets, `behavior-theme` from `state.active` | reads them from the composed skin (the chain) only; no direct slot picks |
| `swap(type, target)` + action `swap:<type>:<id\|next\|prev\|default\|random>` | `runtime.ts:1397`, `runtime.ts:2764` | the generic hot swap; for theme types it is the old theme picker | for `color-theme`: swaps the active skin's colour theme (kept, routed); for `style-theme`, `layout`, `behavior-theme`, `typography`, `density`, `sizing`, `design-package`, `style-package`: refused with a toast naming the skin (aliased in s7/s8) |
| `setSpacing` / action `spacing:<v>` | `runtime.ts:1606-1620`, `2797` | the Spacing choice | the skin's `extras.spacing`; the action becomes a skin override |
| `applyDesignPackage`, `applyAppearancePackage`, actions `design.package`, `appearance.package`, `style.package` | `runtime.ts:1680-1735`, `2817-2837`, `2859` | apply a package = four themes at once | `skin.use:<id>` (the package id is a skin id); the actions become aliases (s8) |
| `applyInterface` | `runtime.ts:2534` | interface = design + slots | its `design` reads as a skin |
| `restoreDefaultAppearance`, `appearance.restore` | `runtime.ts:1735`, `2860` | back to the app's default look | kept, already the skin model's Restore |
| `randomize` / `assets.random`, `roll.slot`, `roll.asset` | `runtime.ts:2782-2790` | roll any slot incl. the themes | theme types excluded from rolls (a roll may pick a skin) |
| `StatusBar` | `framework/react/components/Chrome.tsx:331-347` | shows colour theme, style theme and layout names | shows the skin name and its colour theme |
| `ThemeSwitchWidget` (asset type `theme-switch`) | `framework/react/components/Widgets.tsx:137-171`; assets `framework/assets/theme-switch/*.json` | light / dark colour theme flip | kept: flips the active skin's colour theme (the one swappable section) |
| `LookEditor` (look@1 Sliders) | `framework/react/components/LookEditor.tsx`, `engines/looktokens.ts` | token sliders for the page | retired Nov 1; the component stays for Banner settings → Apply to all only |
| `NavStyleSettings` | `framework/react/components/NavStyleSettings.tsx` | nav-style@1 editor | kept: nav-style is a slot the skin fills; the editor is a skin override UI |
| Plugin theme override | `framework/libs/plugintheme/*` (`pluginThemeLibrary`, `withPluginTheme`, action `plugin-theme.toggle:<id>`) | a theme per plugin | superseded by skin scopes (`SkinScope kind="plugin"` already wraps every plugin root) |
| Appearance lock | `runtime.ts:1857-1880`, `appearance.lock` | greys out look controls | kept |
| Design package and style package engines | `engines/designpackage.ts`, `engines/stylepackage.ts`; assets `framework/assets/design-package/*` (27), `framework/assets/style-package/*` (25) | the packs | become skins (PR #430 does the asset conversion; this build reads them as skins through `skinFromDesignPackage`) |
| Spec checks that pin the old behaviour | `framework/spec/check-appearance.mts`, `check-hub-look.mts`, `check-appearance-lock.mts`, `check-style-packages.mts`, `check-skin.mts`, fixtures `spec/fixtures/appearance.json`, `skin.json`, `theme.json` | | updated with the engines (s3 and s10) |

## 3. Menus, toolbars and context menus (assets; app copies follow the bake)

| asset | items | lands in |
| --- | --- | --- |
| `apps/console-web/src/assets/app-menu/console.json` | View → Layouts (Next layout, Focus top, Classic IDE, Studio dock: `swap:layout:*`); View → Look (Next color theme, Next style theme, Next layout, Next design package); View → Spacing (tight / compact / regular); Appearance settings; Restore default look | Look → Skin (Next skin, Previous skin, Pick…), Colour theme (next / prev); Layouts and Spacing go; Appearance settings and Restore stay |
| `apps/console-web/src/assets/context-menu/amber.json` | Theme: Next theme, Previous theme, Reset theme (`swap:color-theme:*`) | Colour theme (the skin's): kept wording "Colour theme" |
| `apps/console-web/src/assets/toolbar/console-search.json` | Look: Next color theme, Next layout | Next colour theme stays; Next layout goes |
| `framework/assets/app-menu/minimal-picker.json` | Look → Styles (3 style themes), Layouts (3 layouts) | Skins submenu |
| `framework/assets/context-menu/roomy-touch.json` | Styles (3 style themes), Layouts (3 layouts) | Skins |
| `framework/assets/context-menu/appearance-quick.json`, `asset-manager.json` | `design.package:next` | `skin.use:next` (alias) |
| `framework/assets/toolbar/appearance-studio.json` | Themes group, `design.package:next` | Skins group |
| `framework/assets/toolbar/standard-icons.json`, `labeled-actions.json`, `windows.json` | `style`, `layout` buttons (swap) | one `skin` button |
| `framework/assets/toolbar/settings-page.json`, `text-commands.json` | `appearance.restore`, `look` | kept |
| Molly / axHub / AmberX / walkthrough-studio copies under `apps/*/src/assets/{app-menu,context-menu,toolbar}` | the same ids | follow the framework assets |

## 4. Console plugins

| plugin | surfaces | lands in |
| --- | --- | --- |
| **Theme manager** `apps/console-web/plugins/theme-manager` (`ai.amberx.axf.console.theme-manager`, `uiEditor: theme, style, layout`) | view `theme-manager`, settings tab (Appearance / Theme manager / Install & uninstall), menu items Plugins → Theme manager and View → Look → Theme manager…, action `theme-manager.open`, service `axf.token-tree@1`; REST `GET/POST /themes`, `PUT/DELETE /themes/{t}/{iid}`, `GET/PUT /presets`, `GET /skins`, `/skins/coverage`, `/skins/covers/{skin}`, `GET/POST /skins/global`, `GET /skins/{app}/at`, `POST /skins/{app}/follow\|inherit\|use\|off\|back\|restore\|undo` (MCP tools by plugin-commands `auto`) | the roll / theme-save UI and `/themes`, `/presets` go (s4); the `/skins/*` routes move to a skins service (s7) so the API keeps its one home; `axf.token-tree@1` is only used by Theme editor |
| **Theme editor** `apps/console-web/plugins/theme-editor` (`uiEditor: theme, style`, requires `axf.token-tree@1`) | view, settings tab, action `theme-editor.open`, REST `GET/POST /themes`, `DELETE /themes/{t}/{iid}` | goes with the Theme manager (s4); token editing of a skin's sections is the Skin Designer's job (build `skins-are-a-complete-rework-look-layout-behavior`, pending) |
| Console `hubAppearance.tsx` → `AssetPickerPanel` (`apps/console-web/src/assetPicker.tsx`) | one row per asset type incl. the theme types; `rt.swap` | theme / scale / package types are left out of the rows (skin picks them); the other rows are skin overrides |
| Console `views/Explorer.tsx` | style-theme parameter sliders (radius, space, density, font, alphas) | reads the skin's style section; editing moves to the Skin Designer |
| Plugin manager / plugin settings "Appearance" sub-tab (plugintheme) | per-plugin theme override | skin scope per plugin |
| `walkthrough-studio/src/studio/commands.ts:228` | pushes `swap:<type>:<id>` for every asset type incl. themes | skips the skin section types |

## 5. Molly and the other apps

| app | surface | lands in |
| --- | --- | --- |
| Molly `apps/molly/plugins/navigation` (`uiEditor: style`) | its own settings interface "for the theme, colours, fonts, icons, density, width, animation" (nav-style@1) | the nav-style slot is the skin's; the editor stays as a skin override UI (s5 trims the theme wording) |
| Molly `apps/molly/plugins/xlayout` (`uiEditor: layout`) | IDE pane layouts (dock-layout / xlayout@1), ten presets | **not a look layout**: pane docking. Stays; the skin fills the `dock-layout` / `xlayout` slots |
| Molly Settings → Appearance | the shared `AppearancePanel` | follows s3 |
| axHub web `apps/axhub-web/src/views/Passes.tsx` | veto pass scopes `theme`, `style`, `layout`, `tokens` | `tokens` (and `skin`) once the targets are renamed (s7/s8) |
| AmberX `apps/amberx-droid/src/plugins/voice/web/core.ts:144` | curated voice action `swap:color-theme:next` | stays: the skin's colour theme |
| AmberX `apps/amberx-droid/src/plugins/commands/web/lib-developer.ts:74` | "Change the console theme" (`console theme {text}`, `switch theme to {text}`) | "Change the console skin" + colour theme |
| AmberX, Molly, axHub `main.tsx` | `attachAppearanceSource(new HubAppearanceSource(...))` | kept: the transport |
| Demo / expenses / voicevault / walkthrough-studio | devtools hints `AXF.swap('color-theme','next')`, seed script text | docs only (s9) |
| Android (`framework/android/axf-ui/.../theme/AxfColors.kt`, `AxfTheme.kt`, `AxfTypography.kt`; `apps/console` manifest defaults; `apps/axhub-android` assets) | Kotlin theme twin | deferred gap in `framework/spec/PORTING.md` (Android on hold) |

## 6. API surfaces (REST, MCP, CLI, voice)

| surface | today | lands in |
| --- | --- | --- |
| REST control@1 `GET/PUT /api/control/tokens.theme\|tokens.style\|tokens.layout\|tokens.typography\|tokens.density\|tokens.sizing/{path}`, `POST …/reset` | token overrides on the four themes and the scale assets | kept as skin-level token overrides (the API's hand-tuning path), named in the skin docs; renaming the targets is s7's call |
| REST `tokens.slots` (`axf token slots set color-theme <id>`) | sets any slot, incl. themes | `color-theme` only; the other section types answer with the skin to use |
| REST `POST /api/token/reset` | resets token overrides | kept |
| Theme manager plugin REST (section 4) | | `/themes`, `/presets` go; `/skins/*` stay (moved) |
| Hub data API `GET/PUT /data/shared/settings/appearance.json`, `/data/shared/settings/looks/<app>.json` | the documents | kept; s2's migration rewrites the documents once |
| MCP `control_list/get/set/reset/add/remove/act` with the token targets; `pass_grant`/`pass_status` scopes `theme`, `style`, `layout`, `tokens` | | targets as above; pass scopes `tokens` and `skin` (s8) |
| MCP `console_action` (any runtime action: `swap:…`, `design.package:…`, `spacing:…`, `skin.*`) | | `skin.*` and `swap:color-theme:*` only; the others alias or refuse with the skin hint |
| MCP `console_settings("appearance")` | opens Settings → Appearance | kept (deep link to the skin picker) |
| MCP plugin-commands auto tools for theme-manager / theme-editor routes | | go with the routes |
| CLI `node framework/cli/axf.mjs token <set> …`, `axf control …`, `axf pass grant --scope theme\|style\|layout\|tokens` | | targets as above |
| CLI `node framework/cli/skins.mjs apps\|list\|snapshot\|use\|off\|inherit\|follow\|global\|at\|back\|restore\|undo\|coverage\|covers` | the skin API | kept; gains `colour <app> <color-theme>` for the skin's swappable section (s8) |
| CLI `axf new-asset color-theme …`, `scale-adopt.mjs`, `layout-adopt.mjs`, `check-theme.mjs` | developer tools on tokens | kept (they are about `--fx-*` tokens, not pickers) |
| Voice (AmberX) | `swap:color-theme:next`, "console theme {text}" | colour theme of the skin; "use skin {text}" |

## 7. Asset types

| type | today | after |
| --- | --- | --- |
| `color-theme` | picked on its own; appearance slot | the skin's colours section preset; still swappable inside the skin |
| `style-theme`, `layout`, `behavior-theme` | picked on their own | section presets of the skin only (never a slot of their own) |
| `design-package`, `style-package` | bundles, slot | skins of the same id (PR #430); `APPEARANCE_NEVER` |
| `typography`, `density`, `sizing` | scale slots | the skin's `assets`; overrides allowed |
| `theme-switch` | widget flipping colour themes | widget flipping the skin's colour theme |
| `dock-layout`, `xlayout`, `nav-style` | slots | slots the skin fills (unchanged) |
| `skin` | the look | the only look |

## What this phase does with it

- **s2** writes `framework/core/engines/look-migration.mjs` (+ `.d.mts`): pure, idempotent, one run per profile
  (a `migrated` stamp with version, app id and date on the app-look document and on the local settings), a backup of
  every retired value under `legacy` on the same document / `axf.legacy.look` setting, and the fold described in
  section 1. Fixture `spec/fixtures/look-migration.json`, check `spec/check-look-migration.mts`.
- **s3** makes `compileStyles` and the Settings → Appearance panel read the four sections, spacing and the scale
  assets from the composed skin only, routes `swap` for the section types through the skin (colour theme swappable,
  the rest refused with the skin hint), excludes the section types from rolls, shows the skin on the status bar, and
  calls the migration on startup (both with a hub source and without one).
- **s4 to s10** (Opus phases) remove the pickers listed in sections 3 to 6 app by app, alias the API surfaces, clean
  the docs and add the tests.
