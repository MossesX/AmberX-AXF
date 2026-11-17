# The flagship skin: where every slot lives

Generated from skin-map@1. Do not edit: `node framework/cli/skins.mjs map flagship --md > _claude/memory/docs/flagship-skin.md` rewrites it.

**flagship** sets 83 of 104 map rows (the rest are bundles, `none` types and Android-only types, or left to the level below). The skins check `node framework/spec/check-skin-coverage.mjs --complete flagship` fails if any registered type or skin-slots@1 slot is empty.

## How to reach it (API)

| Way | Read the map | Apply a skin |
| --- | --- | --- |
| UI | Settings → Appearance → Skin map (tap a row to open its asset) | Settings → Appearance → Skin |
| Deep link | `settings.open:skin-map`, console-control `view:settings/tab:settings.tabs=appearance/subtab:settings.subtabs=skin-map`, rows `grid:skin-map/row:<slot>` | Skins: `skin-gallery.focus:skin/<id>` |
| REST | `GET /api/plugins/theme-manager/skin-map?skin=flagship`, `GET …/skin-map/<slot>?skin=` | `POST …/skins/global`, `POST …/skins/<app>/use` {skin, scope?} |
| MCP | the same routes as theme-manager plugin commands | the same |
| CLI | `node framework/cli/skins.mjs map flagship [--slot <s>] [--json]` | `skins.mjs global <id>`, `skins.mjs use <app> <id> [--scope ui:<v> or plugin:<id>]` |
| Voice (AmberX) | `skin.map`, `skin.map.slot:<slot>` | `skin.use:<id>:<scope> (hub, app, ui:… or plugin:…)`, `skin.inherit:on` |

## Colours, type and style

| Slot | Set by the skin | Controls | Tokens | Read by | Lives in |
| --- | --- | --- | --- | --- | --- |
| **Color theme**<br>`colorTheme` | `flagship-dark` | asset, tokens | 16<br>`--fx-accent --fx-accent-soft --fx-accent-text` … | palette | `framework/assets/color-theme/<id>.json`<br>`pick app-look@1 slots.color-theme` |
| **Style theme**<br>`styleTheme` | `flagship` | asset, tokens | 123<br>`--fx-blur --fx-border-w --fx-density-k` … | grid, motion, page, palette | `framework/assets/style-theme/<id>.json`<br>`pick app-look@1 slots.style-theme` |
| **Typography**<br>`assets.typography` | `flagship` | asset, tokens | 30<br>`--fx-type-eyebrow-case --fx-type-eyebrow-size --fx-type-eyebrow-tracking` … | typography | `framework/assets/typography/<id>.json`<br>`pick app-look@1 slots.typography` |
| **Density**<br>`assets.density` | `flagship` | asset, tokens | 18<br>`--fx-dens-gap-2xl --fx-dens-gap-2xs --fx-dens-gap-3xl` … | density | `framework/assets/density/<id>.json`<br>`pick app-look@1 slots.density` |
| **Component sizing**<br>`assets.sizing` | `flagship` | asset, tokens | 32<br>`--fx-size-button-font --fx-size-button-height --fx-size-button-icon` … | sizing | `framework/assets/sizing/<id>.json`<br>`pick app-look@1 slots.sizing` |
| **Spacing**<br>`extras.spacing` | `compact` | settings, tokens | 1<br>`--fx-space` | engines/spacing.ts, styleThemeVars | `app-look@1 spacing` |
| **Look settings and token overrides**<br>`extras.settings` | — | settings, tokens | 0 | engines/control-tokens.mjs, compileStyles | `app-look@1 settings` |

## Layouts

| Slot | Set by the skin | Controls | Tokens | Read by | Lives in |
| --- | --- | --- | --- | --- | --- |
| **Layout**<br>`layoutTheme` | `flagship` | layout, tokens | 31<br>`--fx-content-max --fx-grid-areas --fx-grid-areas-m` … | layout, page | `framework/assets/layout/<id>.json`<br>`pick app-look@1 slots.layout` |
| **Pane layout**<br>`assets.dock-layout` | `main-side` | layout, tokens | 0 |  | `framework/assets/dock-layout/<id>.json`<br>`pick app-look@1 slots.dock-layout` |
| **xLayout**<br>`assets.xlayout` | `molly` | layout, tokens | 0 |  | `framework/assets/xlayout/<id>.json`<br>`pick app-look@1 slots.xlayout` |
| **Navigation style**<br>`assets.nav-style` | `flagship` | asset, tokens | 9<br>`--fx-layout-nav-width --fx-nav-item-py --fx-navs-dur` … | layout, nav-menu, nav-style, page | `framework/assets/nav-style/<id>.json`<br>`pick app-look@1 slots.nav-style` |

## Menus and chrome

| Slot | Set by the skin | Controls | Tokens | Read by | Lives in |
| --- | --- | --- | --- | --- | --- |
| **Application menu**<br>`assets.app-menu` | `flagship` | asset, tokens | 1<br>`--fx-menubar-h` | .fx-menubar, .fx-menubar__btn, app-menu | `framework/assets/app-menu/<id>.json`<br>`pick app-look@1 slots.app-menu` |
| **Application menu parts**<br>`parts.app-menu` | `{"itemPadding":"sm","hover":"highlight","animation":"fade","animationSpeed":"fast","easing":"ease-out"}` | tokens | 0 | .fx-menubar, .fx-menubar__btn | `app-look@1 settings["axf.custom.<type>"]` |
| **Toolbar**<br>`assets.toolbar` | `flagship` | asset, tokens | 1<br>`--fx-toolbar-py` | .fx-toolbar, .fx-toolbtn, toolbar | `framework/assets/toolbar/<id>.json`<br>`pick app-look@1 slots.toolbar` |
| **Toolbar parts**<br>`parts.toolbar` | `{"gap":"xs","itemPadding":"sm","hover":"tint","click":"press","focusRing":"soft"}` | tokens | 0 | .fx-toolbar, .fx-toolbtn | `app-look@1 settings["axf.custom.<type>"]` |
| **Navigation menu**<br>`assets.nav-menu` | `flagship` | asset, tokens | 1<br>`--fx-nav-item-py` | .fx-nav, .fx-nav__item, nav-menu | `framework/assets/nav-menu/<id>.json`<br>`pick app-look@1 slots.nav-menu` |
| **Navigation menu parts**<br>`parts.nav-menu` | `{"itemPadding":"sm","radius":"md","hover":"tint","click":"press","focusRing":"soft"}` | tokens | 0 | .fx-nav, .fx-nav__item | `app-look@1 settings["axf.custom.<type>"]` |
| **Context menu**<br>`assets.context-menu` | `flagship` | asset | 0 | .fx-ctx, .fx-menu__item | `framework/assets/context-menu/<id>.json`<br>`pick app-look@1 slots.context-menu` |
| **Context menu parts**<br>`parts.context-menu` | `{"radius":"md","shadow":"lg","itemPadding":"sm","hover":"highlight","animation":"scale","animationSpeed":"fast","easing":"ease-out"}` | tokens | 0 | .fx-ctx, .fx-menu__item | `app-look@1 settings["axf.custom.<type>"]` |
| **Tab group**<br>`assets.tab-group` | `flagship` | asset, tokens | 61<br>`--fx-tab-active-bg --fx-tab-active-border --fx-tab-active-text` … | .fx-tab, .fx-tabs, .fx-tabgroup__bar, tab-group | `framework/assets/tab-group/<id>.json`<br>`pick app-look@1 slots.tab-group` |
| **Tab group parts**<br>`parts.tab-group` | `{"radius":"pill","hover":"tint","click":"press","focusRing":"soft"}` | tokens | 0 | .fx-tab, .fx-tabs, .fx-tabgroup__bar | `app-look@1 settings["axf.custom.<type>"]` |
| **Banner**<br>`assets.banner` | `flagship` | asset, tokens | 1<br>`--fx-banner-h` | .fx-banner, .fx-banner__item, banner | `framework/assets/banner/<id>.json`<br>`pick app-look@1 slots.banner` |
| **Banner parts**<br>`parts.banner` | `{"padding":"sm","gap":"sm","shadow":"sm","alignment":"spread"}` | tokens | 0 | .fx-banner, .fx-banner__item | `app-look@1 settings["axf.custom.<type>"]` |
| **Settings interface**<br>`assets.settings` | `flagship` | asset | 0 |  | `framework/assets/settings/<id>.json`<br>`pick app-look@1 slots.settings` |
| **Hidden chrome**<br>`extras.hidden` | `{"banner":false,"app-menu":false,"toolbar":false,"nav-menu":false}` | settings | 0 | engines/hide.ts, AppShell | `app-look@1 hidden` |
| **Chrome settings per kind**<br>`chrome` | — | settings, asset | 0 | TabGroup, ChromeContext, rt.chromeData, engines/chrome-settings-rules.mjs | `app-look@1 settings["axf.chrome.*"]` |
| **Settings chrome**<br>`settings` | `{"page":"flagship","tab-group":"chrome-tab-group","toolbar":"chrome-toolbar","banner":"chrome-banner","nav-menu":"chrome-nav-menu","app-menu` | asset, settings | 0 | lib-settings (the settings page), ChromeContext settings dialogs, engines/settingsui.ts | `app-look@1 slots.settings and settings["axf.chrome.settings.<kind>"]` |

## Controls and widgets

| Slot | Set by the skin | Controls | Tokens | Read by | Lives in |
| --- | --- | --- | --- | --- | --- |
| **Application menu parts**<br>`parts.app-menu` | `{"itemPadding":"sm","hover":"highlight","animation":"fade","animationSpeed":"fast","easing":"ease-out"}` | tokens | 0 | .fx-menubar, .fx-menubar__btn | `app-look@1 settings["axf.custom.<type>"]` |
| **Toolbar parts**<br>`parts.toolbar` | `{"gap":"xs","itemPadding":"sm","hover":"tint","click":"press","focusRing":"soft"}` | tokens | 0 | .fx-toolbar, .fx-toolbtn | `app-look@1 settings["axf.custom.<type>"]` |
| **Navigation menu parts**<br>`parts.nav-menu` | `{"itemPadding":"sm","radius":"md","hover":"tint","click":"press","focusRing":"soft"}` | tokens | 0 | .fx-nav, .fx-nav__item | `app-look@1 settings["axf.custom.<type>"]` |
| **Context menu parts**<br>`parts.context-menu` | `{"radius":"md","shadow":"lg","itemPadding":"sm","hover":"highlight","animation":"scale","animationSpeed":"fast","easing":"ease-out"}` | tokens | 0 | .fx-ctx, .fx-menu__item | `app-look@1 settings["axf.custom.<type>"]` |
| **Tab group parts**<br>`parts.tab-group` | `{"radius":"pill","hover":"tint","click":"press","focusRing":"soft"}` | tokens | 0 | .fx-tab, .fx-tabs, .fx-tabgroup__bar | `app-look@1 settings["axf.custom.<type>"]` |
| **Dialog**<br>`assets.dialog` | `flagship` | asset, tokens | 1<br>`--fx-dialog-w` | .fx-dialog, dialog | `framework/assets/dialog/<id>.json`<br>`pick app-look@1 slots.dialog` |
| **Dialog parts**<br>`parts.dialog` | `{"radius":"lg","shadow":"lg","animation":"scale","animationSpeed":"normal","easing":"ease-out"}` | tokens | 0 | .fx-dialog | `app-look@1 settings["axf.custom.<type>"]` |
| **Popup / toast**<br>`assets.popup` | `flagship` | asset | 0 | .fx-popover, .fx-dropdown | `framework/assets/popup/<id>.json`<br>`pick app-look@1 slots.popup` |
| **Popup / toast parts**<br>`parts.popup` | `{"radius":"md","shadow":"md","animation":"fade","animationSpeed":"fast","easing":"ease-out"}` | tokens | 0 | .fx-popover, .fx-dropdown | `app-look@1 settings["axf.custom.<type>"]` |
| **Button**<br>`assets.button` | `enterprise-crisp` | asset, tokens | 7<br>`--fx-btn-case --fx-btn-px --fx-btn-py` … | .fx-btn, .fx-iconbtn, button | `framework/assets/button/<id>.json`<br>`pick app-look@1 slots.button` |
| **Button parts**<br>`parts.button` | `{"radius":"md","hover":"tint","click":"press","focusRing":"soft","fontWeight":"500"}` | tokens | 0 | .fx-btn, .fx-iconbtn | `app-look@1 settings["axf.custom.<type>"]` |
| **Slider**<br>`assets.slider` | `enterprise-crisp` | asset, tokens | 4<br>`--fx-slider-thumb --fx-slider-thumb-r --fx-slider-thumb-w` … | .fx-slider, slider | `framework/assets/slider/<id>.json`<br>`pick app-look@1 slots.slider` |
| **Slider parts**<br>`parts.slider` | `{"radius":"pill","focusRing":"soft"}` | tokens | 0 | .fx-slider | `app-look@1 settings["axf.custom.<type>"]` |
| **Container**<br>`assets.container` | `flagship` | asset, tokens | 2<br>`--fx-card-pad --fx-card-shadow` | .fx-card, container | `framework/assets/container/<id>.json`<br>`pick app-look@1 slots.container` |
| **Container parts**<br>`parts.container` | `{"radius":"md","shadow":"sm","padding":"md","gap":"sm"}` | tokens | 0 | .fx-card | `app-look@1 settings["axf.custom.<type>"]` |
| **Gauge**<br>`assets.gauge` | `level-bar` | asset, tokens | 2<br>`--fx-gauge-cap --fx-gauge-thickness` | .fx-gauge, gauge | `framework/assets/gauge/<id>.json`<br>`pick app-look@1 slots.gauge` |
| **Gauge parts**<br>`parts.gauge` | `{"fontFamily":"mono","fontWeight":"600","iconColor":"accent"}` | tokens | 0 | .fx-gauge | `app-look@1 settings["axf.custom.<type>"]` |
| **Progress meter**<br>`assets.meter` | `hairline` | asset, tokens | 2<br>`--fx-meter-h --fx-meter-radius` | .fx-meter, meter | `framework/assets/meter/<id>.json`<br>`pick app-look@1 slots.meter` |
| **Progress meter parts**<br>`parts.meter` | `{"radius":"pill","gap":"xs"}` | tokens | 0 | .fx-meter | `app-look@1 settings["axf.custom.<type>"]` |
| **Banner parts**<br>`parts.banner` | `{"padding":"sm","gap":"sm","shadow":"sm","alignment":"spread"}` | tokens | 0 | .fx-banner, .fx-banner__item | `app-look@1 settings["axf.custom.<type>"]` |
| **Clock**<br>`assets.clock` | `{"fontFamily":"mono","textColor":"muted","fontWeight":"500"}` | asset | 0 | .fx-banner__clock | `framework/assets/clock/<id>.json`<br>`pick app-look@1 slots.clock` |
| **Clock parts**<br>`parts.clock` | `{"fontFamily":"mono","textColor":"muted","fontWeight":"500"}` | tokens | 0 | .fx-banner__clock | `app-look@1 settings["axf.custom.<type>"]` |
| **Search bar**<br>`assets.search-bar` | `{"radius":"md","background":"surface2","borderColor":"border","focusRing":"soft"}` | asset | 0 | .fx-search | `framework/assets/search-bar/<id>.json`<br>`pick app-look@1 slots.search-bar` |
| **Search bar parts**<br>`parts.search-bar` | `{"radius":"md","background":"surface2","borderColor":"border","focusRing":"soft"}` | tokens | 0 | .fx-search | `app-look@1 settings["axf.custom.<type>"]` |
| **Action button**<br>`assets.action-button` | `{"radius":"md","hover":"tint","click":"press","focusRing":"soft","fontWeight":"600"}` | asset | 0 | .fx-widget-button | `framework/assets/action-button/<id>.json`<br>`pick app-look@1 slots.action-button` |
| **Action button parts**<br>`parts.action-button` | `{"radius":"md","hover":"tint","click":"press","focusRing":"soft","fontWeight":"600"}` | tokens | 0 | .fx-widget-button | `app-look@1 settings["axf.custom.<type>"]` |
| **Logo**<br>`assets.logo` | `{"fontWeight":"700","letterSpacing":"tight"}` | asset | 0 | .fx-widget-logo | `framework/assets/logo/<id>.json`<br>`pick app-look@1 slots.logo` |
| **Logo parts**<br>`parts.logo` | `{"fontWeight":"700","letterSpacing":"tight"}` | tokens | 0 | .fx-widget-logo | `app-look@1 settings["axf.custom.<type>"]` |
| **Label**<br>`assets.label` | `{"fontWeight":"500","textColor":"muted"}` | asset | 0 | .fx-widget-label | `framework/assets/label/<id>.json`<br>`pick app-look@1 slots.label` |
| **Label parts**<br>`parts.label` | `{"fontWeight":"500","textColor":"muted"}` | tokens | 0 | .fx-widget-label | `app-look@1 settings["axf.custom.<type>"]` |
| **Status**<br>`assets.status` | `{"radius":"pill","fontWeight":"500","padding":"xs"}` | asset | 0 | .fx-widget-status | `framework/assets/status/<id>.json`<br>`pick app-look@1 slots.status` |
| **Status parts**<br>`parts.status` | `{"radius":"pill","fontWeight":"500","padding":"xs"}` | tokens | 0 | .fx-widget-status | `app-look@1 settings["axf.custom.<type>"]` |
| **Counter**<br>`assets.counter` | `{"radius":"pill","fontWeight":"600","fontFamily":"mono"}` | asset | 0 | .fx-widget-counter | `framework/assets/counter/<id>.json`<br>`pick app-look@1 slots.counter` |
| **Counter parts**<br>`parts.counter` | `{"radius":"pill","fontWeight":"600","fontFamily":"mono"}` | tokens | 0 | .fx-widget-counter | `app-look@1 settings["axf.custom.<type>"]` |
| **Progress**<br>`assets.progress` | `{"radius":"pill"}` | asset | 0 | .fx-widget-progress | `framework/assets/progress/<id>.json`<br>`pick app-look@1 slots.progress` |
| **Progress parts**<br>`parts.progress` | `{"radius":"pill"}` | tokens | 0 | .fx-widget-progress | `app-look@1 settings["axf.custom.<type>"]` |
| **Avatar**<br>`assets.avatar` | `{"radius":"pill","hover":"glow"}` | asset | 0 | .fx-widget-avatar | `framework/assets/avatar/<id>.json`<br>`pick app-look@1 slots.avatar` |
| **Avatar parts**<br>`parts.avatar` | `{"radius":"pill","hover":"glow"}` | tokens | 0 | .fx-widget-avatar | `app-look@1 settings["axf.custom.<type>"]` |
| **Link**<br>`assets.link` | `{"textColor":"accent","hover":"underline"}` | asset | 0 | .fx-widget-link | `framework/assets/link/<id>.json`<br>`pick app-look@1 slots.link` |
| **Link parts**<br>`parts.link` | `{"textColor":"accent","hover":"underline"}` | tokens | 0 | .fx-widget-link | `app-look@1 settings["axf.custom.<type>"]` |
| **Theme switch**<br>`assets.theme-switch` | `{"radius":"pill","hover":"tint","click":"press"}` | asset | 0 | .fx-widget-theme | `framework/assets/theme-switch/<id>.json`<br>`pick app-look@1 slots.theme-switch` |
| **Theme switch parts**<br>`parts.theme-switch` | `{"radius":"pill","hover":"tint","click":"press"}` | tokens | 0 | .fx-widget-theme | `app-look@1 settings["axf.custom.<type>"]` |
| **Spacer**<br>`assets.spacer` | `{"padding":"none"}` | asset | 0 | .fx-widget-spacer | `framework/assets/spacer/<id>.json`<br>`pick app-look@1 slots.spacer` |
| **Spacer parts**<br>`parts.spacer` | `{"padding":"none"}` | tokens | 0 | .fx-widget-spacer | `app-look@1 settings["axf.custom.<type>"]` |
| **Divider**<br>`assets.divider` | `{"borderColor":"border"}` | asset | 0 | .fx-widget-divider | `framework/assets/divider/<id>.json`<br>`pick app-look@1 slots.divider` |
| **Divider parts**<br>`parts.divider` | `{"borderColor":"border"}` | tokens | 0 | .fx-widget-divider | `app-look@1 settings["axf.custom.<type>"]` |
| **Badge**<br>`assets.badge` | `{"radius":"pill","fontWeight":"600"}` | asset | 0 | .fx-badge | `framework/assets/badge/<id>.json`<br>`pick app-look@1 slots.badge` |
| **Badge parts**<br>`parts.badge` | `{"radius":"pill","fontWeight":"600"}` | tokens | 0 | .fx-badge | `app-look@1 settings["axf.custom.<type>"]` |
| **Dialog chrome**<br>`dialog` | `{"variant":"modal","backdrop":"blur","animation":"scale","header":"plain","closeOnBackdrop":true,"width":560}` | settings, tokens | 1<br>`--fx-dialog-w` | dialogStyle (engines/components.ts), Dialog host | `app-look@1 settings["axf.chrome.dialog"]` |

## Motion, behaviour and hooks

| Slot | Set by the skin | Controls | Tokens | Read by | Lives in |
| --- | --- | --- | --- | --- | --- |
| **Behaviour theme**<br>`behaviorTheme` | `standard` | asset, tokens | 11<br>`--fx-anim-dur --fx-anim-ease --fx-anim-intensity` … | motion, page | `framework/assets/behavior-theme/<id>.json`<br>`pick app-look@1 slots.behavior-theme` |
| **Motion**<br>`motion` | `{"speed":{"fast":90,"normal":150,"slow":240},"easing":{"standard":"standard","emphasized":"cubic-bezier(0.2, 0, 0, 1.05)","exit":"cubic-bezi` | tokens, settings | 47<br>`--fx-motion --fx-motion-app-menu-dur --fx-motion-app-menu-enter` … | compileStyles (skinMotionStyle) | `app-look@1 settings["axf.motion"]` |
| **Behaviour defaults**<br>`behavior` | `{"tapConfirm":{"armMs":3000,"toolbar":"on","tab-group":"on","nav-menu":"on","app-menu":"on","context-menu":"on","banner":"on"},"overflow":{"` | settings | 0 | engines/tapconfirm.ts (tapConfigFor), behaviorStyle (withBehaviorOverrides), TabGroup, rt.chromeData | `app-look@1 settings (the keys listed)` |
| **Hooks and drop zones**<br>`hooks` | `{"tab-group":{"hooks":["chrome.tab-group.settings","chrome.tab-group.change","chrome.tab-group.move"],"drop":["axf.chrome.tab-group"]},"tool` | settings | 0 | rt.skinHooks / rt.hookRegistry, ActionBus (registered actions), lib-datagrid row hooks (grid-hook@1), lib-dnd zones (data-axf-drop) | `app-look@1 settings["axf.hooks.<kind>"]` |

## Grids and data

| Slot | Set by the skin | Controls | Tokens | Read by | Lives in |
| --- | --- | --- | --- | --- | --- |
| **Grid layout**<br>`grid` | `{"density":"compact","rows":1,"header":"bold","zebra":false,"lines":"rows","sticky":true}` | tokens, settings | 32<br>`--fx-grid-header-bg --fx-grid-table-header-bg --fx-grid-header-text` … | lib-datagrid DataGrid (.axf-grid), framework table (.fx-table), engines/component-tokens.mjs | `app-look@1 settings["axf.tokens.style"]["*"]["grid.<token>"] and settings["axf.grid"]` |

## Brand and icons

| Slot | Set by the skin | Controls | Tokens | Read by | Lives in |
| --- | --- | --- | --- | --- | --- |
| **Logo mark**<br>`assets.logo-mark` | `amberx` | asset | 0 |  | `framework/assets/logo-mark/<id>.json`<br>`pick app-look@1 slots.logo-mark` |
| **Animated logo**<br>`assets.animated-logo` | `amberx` | asset | 0 |  | `framework/assets/animated-logo/<id>.json`<br>`pick app-look@1 slots.animated-logo` |
| **Icon pack**<br>`assets.icon-pack` | `amberx-outline` | asset | 0 |  | `framework/assets/icon-pack/<id>.json`<br>`pick app-look@1 slots.icon-pack` |
| **Branding package**<br>`assets.branding` | `amberx` | asset, tokens | 5<br>`--fx-accent --fx-brand-anim-delay --fx-brand-anim-k` … | palette | `framework/assets/branding/<id>.json`<br>`pick app-look@1 slots.branding` |
| **Agent card**<br>`assets.agent-card` | `corporate-badge` | asset | 0 |  | `framework/assets/agent-card/<id>.json`<br>`pick app-look@1 slots.agent-card` |
| **Icon pack**<br>`iconPack` | `amberx-outline` | asset, settings | 0 | Icon, brandGlyph, engines/iconmap-rules.mjs | `framework/assets/icon-pack/<id>.json`<br>`pick app-look@1 slots.icon-pack` |

## Help and learning

| Slot | Set by the skin | Controls | Tokens | Read by | Lives in |
| --- | --- | --- | --- | --- | --- |
| **Demonstration**<br>`assets.demonstration` | `what-is-an-asset` | asset | 0 |  | `framework/assets/demonstration/<id>.json`<br>`pick app-look@1 slots.demonstration` |
| **Book**<br>`assets.book` | `getting-started` | asset | 0 |  | `framework/assets/book/<id>.json`<br>`pick app-look@1 slots.book` |
| **Clip**<br>`assets.clip` | `what-is-an-asset-clip` | asset | 0 |  | `framework/assets/clip/<id>.json`<br>`pick app-look@1 slots.clip` |
| **Documentation**<br>`assets.docs` | `getting-started-docs` | asset | 0 |  | `framework/assets/docs/<id>.json`<br>`pick app-look@1 slots.docs` |

## Where the datasets go

| Dataset | Contract | What | Hub | Data store | Repo |
| --- | --- | --- | --- | --- | --- |
| `appearance` | appearance@1 | The shared document: the hub-wide skin (`skin`), the hub default skin (`defaultSkin`), the palette and the shared token overrides (axf.tokens.*). | `shared:settings/appearance.json` | `settings/appearance.json` | `framework/core/engines/appearance.ts` |
| `look:axf-console` | app-look@1 | axf-console's own look: the default snapshot, its own picks, Use skin, scopes, the colour theme inside the skin, undo and backups. | `shared:settings/looks/axf-console.json` | `settings/looks/axf-console.json` | `framework/core/engines/skin-rules.mjs` |
| `default-skin:axf-console` | skin@1 | axf-console's Default skin: its saved look as a protected skin asset (default-axf-console). | `shared:settings/skins/axf-console.json` | `settings/skins/axf-console.json` | `framework/core/engines/skin-config-rules.mjs` |
| `skin-config:axf-console` | skin-config@1 | What the AI may change when it makes a skin for axf-console (allow / lock / ask, limits). | `shared:settings/skin-config/axf-console.json` | `settings/skin-config/axf-console.json` | `framework/core/engines/skin-config-rules.mjs` |
| `look:axhub-web` | app-look@1 | axhub-web's own look: the default snapshot, its own picks, Use skin, scopes, the colour theme inside the skin, undo and backups. | `shared:settings/looks/axhub-web.json` | `settings/looks/axhub-web.json` | `framework/core/engines/skin-rules.mjs` |
| `default-skin:axhub-web` | skin@1 | axhub-web's Default skin: its saved look as a protected skin asset (default-axhub-web). | `shared:settings/skins/axhub-web.json` | `settings/skins/axhub-web.json` | `framework/core/engines/skin-config-rules.mjs` |
| `skin-config:axhub-web` | skin-config@1 | What the AI may change when it makes a skin for axhub-web (allow / lock / ask, limits). | `shared:settings/skin-config/axhub-web.json` | `settings/skin-config/axhub-web.json` | `framework/core/engines/skin-config-rules.mjs` |
| `look:amberx-droid` | app-look@1 | amberx-droid's own look: the default snapshot, its own picks, Use skin, scopes, the colour theme inside the skin, undo and backups. | `shared:settings/looks/amberx-droid.json` | `settings/looks/amberx-droid.json` | `framework/core/engines/skin-rules.mjs` |
| `default-skin:amberx-droid` | skin@1 | amberx-droid's Default skin: its saved look as a protected skin asset (default-amberx-droid). | `shared:settings/skins/amberx-droid.json` | `settings/skins/amberx-droid.json` | `framework/core/engines/skin-config-rules.mjs` |
| `skin-config:amberx-droid` | skin-config@1 | What the AI may change when it makes a skin for amberx-droid (allow / lock / ask, limits). | `shared:settings/skin-config/amberx-droid.json` | `settings/skin-config/amberx-droid.json` | `framework/core/engines/skin-config-rules.mjs` |
| `look:molly` | app-look@1 | molly's own look: the default snapshot, its own picks, Use skin, scopes, the colour theme inside the skin, undo and backups. | `shared:settings/looks/molly.json` | `settings/looks/molly.json` | `framework/core/engines/skin-rules.mjs` |
| `default-skin:molly` | skin@1 | molly's Default skin: its saved look as a protected skin asset (default-molly). | `shared:settings/skins/molly.json` | `settings/skins/molly.json` | `framework/core/engines/skin-config-rules.mjs` |
| `skin-config:molly` | skin-config@1 | What the AI may change when it makes a skin for molly (allow / lock / ask, limits). | `shared:settings/skin-config/molly.json` | `settings/skin-config/molly.json` | `framework/core/engines/skin-config-rules.mjs` |
| `default-skin:global` | skin@1 | The hub-wide look as a skin (default-global). | `shared:settings/skins/global.json` | `settings/skins/global.json` | `framework/core/engines/skin-config-rules.mjs` |
| `skins:framework` | skin@1 | The framework skins (repo files, baked into every app that ships the shared set). | — | — | `framework/assets/skin/<id>.json` |
| `animation-prefs` | animation-prefs | This app's own animation picks over the skin's (Settings → Appearance → Animations). | `app-look@1 settings["axf.appearance.animations"]` | — | `framework/core/engines/animation-rules.mjs` |

## Layouts

| Layout type | Assets | Picked at | Engine | Repo |
| --- | --- | --- | --- | --- |
| Layout (`layout`) | 17 | `app-look@1 slots.layout` | `framework/core/engines/layout.ts (layoutVars)` | `framework/assets/layout/<id>.json` |
| Pane layout (`dock-layout`) | 10 | `app-look@1 slots.dock-layout` | `framework/core/engines/dock.ts` | `framework/assets/dock-layout/<id>.json` |
| xLayout (`xlayout`) | 1 | `app-look@1 slots.xlayout` | `framework/core/engines/xlayout.ts` | `framework/assets/xlayout/<id>.json` |

Summary: 104 slots, 16 datasets, 3 layout types, 341 tokens, 77 settings keys.
