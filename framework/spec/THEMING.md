# Theming: engines, tokens and plugin UIs

Everything visible in AXF is styled by the engines. Assets go in, CSS custom properties (`--fx-*`) come out,
and UI reads only those. Swapping an asset (`runtime.swap(type, id)`) restyles every screen, every library
and every plugin at once. This file is the contract for anything that draws UI on the web port; the Android
port follows the same rules with Compose tokens.

## The engines and what they emit

| Engine | Source assets | Emits |
| --- | --- | --- |
| theme (`core/engines/theme.ts`) | `color-theme` | one `--fx-<token>` per colour token: `--fx-bg`, `--fx-surface`, `--fx-surface2`, `--fx-surface3`, `--fx-text`, `--fx-muted`, `--fx-border`, `--fx-accent`, `--fx-accent-text`, `--fx-accent-soft`, `--fx-success`, `--fx-warning`, `--fx-danger`, … |
| theme | `style-theme` | `--fx-font`, `--fx-font-display`, `--fx-font-mono`, `--fx-font-size`, `--fx-space`, `--fx-radius-sm/md/lg`, `--fx-border-w`, `--fx-shadow-sm/md/lg`, `--fx-motion`, `--fx-blur`, `--fx-heading-weight`, `--fx-tracking`, `--fx-row-h`, `--fx-density-k`, and the transparency tokens below |
| layout (`core/engines/layout.ts`, rules `layout-rules.mjs`) | `layout` | every layout parameter as `--fx-layout-<field>` (nav / inspector widths, content width, status height, region gap, main paddings desktop + phone, phone edge + nav item minimum, viewport cut-offs, the sides and switches), plus `--fx-grid-*` (columns read the width tokens), `--fx-content-max` and the shell's regions. The cut-offs become root attributes `data-fx-tiny` / `-small` / `-narrow` / `-medium`; select on those, never on a px breakpoint |
| components (`core/engines/components.ts`) | `button`, `slider`, `container`, … | `--fx-btn-*`, `--fx-slider-*`, … plus `data-fx-*` attributes |

**Controls come from the framework (Oct 22 2026, rule "Plugins inherit the app's style").** A plugin or library never
draws its own button, tab, chip or toggle: it uses `<Button tone size icon>` (`fx-btn`, `fx-btn--sm`, tones primary /
neutral / danger / success / ghost / quiet), `<IconButton icon label>` (`fx-iconbtn`), `<Segmented>` (`fx-seg`,
`fx-seg__opt`), `fx-chip` on a `<button>` (`is-on` = pressed), `fx-tab` (page tabs), `fx-menu__item` or `fx-nav__item`,
so the button asset, style theme and spacing restyle it with the app. A whole row or card you tap is marked
`data-fx-row` (no chrome; the plugin lays it out). A plugin's own class on a control may lay it out (margin, flex,
width…) but never set its background, colour, border, radius, padding, font size/weight, shadow or case.
CI: `node framework/cli/check-controls.mjs`.

## Token registry (token-registry@1, Nov 13 2026)

Every `--fx-*` token in the system is listed once, in `framework/schemas/token-registry.json`, with its element type,
area (layout / style / colour / behaviour), state (hover, selected, disabled …), scheme (light / dark / both), level
(basic / pro / advanced), a plain-English description, its default and where it comes from (axf.css, an engine, the
colour themes, a manifest). Engine: `core/engines/token-registry.mjs` (pure); CLI: `node framework/cli/token-registry.mjs
list | search | get | sync --write | check | manifest <plugin> --write`; CI: `spec/check-token-registry.mjs`.

- **Sync, don't hand-write.** `sync --write` derives the token set the way check-theme does (axf.css, the engines'
  literals, the colour themes' keys, the scale and layout registries, the names in use under a component prefix) and
  merges the manifests' `tokens.defines`, keeping every hand-edited description, level, area, state and element.
- **A new UI, component or plugin registers its tokens through its manifest.** plugin.json (and axf.manifest.json):
  `"tokens": { "$axf": "token-registry@1", "uses": ["--fx-accent", …], "defines": [{ "id": "--fx-…", "element", "area",
  "state", "scheme", "level", "description", "default" }] }`. `uses` must equal what the folder's files read
  (`manifest <folder> --write` fills it); `defines` are the plugin's own tokens, merged into the registry.
- **CI fails** on a token a UI reads that is not registered, on a registered token nothing reads (generated scale /
  layout tokens and `deprecated` entries excepted), and on a plugin outside `spec/token-manifest-baseline.json` with no
  or a stale `tokens` block. The baseline lists the plugins that pre-date the rule and only shrinks.
- **Levels** are what the Skin editor and Token control show: basic = the handful everyone changes (page colours,
  accent, font, size, space, radius), pro = per-element looks and transparencies, advanced = layout, scale, density,
  shadows, motion.
- **Skin snapshots (skin-snapshot@1).** The Skin editor keeps one chain per picked UI: the root is the default skin (no
  edits), every edit is a snapshot with a parent, a revert is a new snapshot that copies an older state (nothing is
  lost), `snapshotBefore` answers "as it was 10 minutes ago", and `exportSkin` turns any state into a skin asset whose
  mapped tokens ride `extras.settings['axf.tokens.<set>']` (control@1 overrides, applied everywhere the skin is used)
  while variables no set carries ride `extras.settings['axf.skin-editor.vars']`.

## Transparency tokens

Part of the style theme (optional fields, 0–1; defaults in `OPACITY_DEFAULTS`, identical on Android):

| Field | Variable | Default | Use |
| --- | --- | --- | --- |
| `opacityDisabled` | `--fx-opacity-disabled` | 0.38 | disabled controls (`opacity: var(--fx-opacity-disabled)`) |
| `opacityMuted` | `--fx-opacity-muted` | 0.62 | de-emphasised content: secondary icons, done items |
| `opacityHover` | `--fx-opacity-hover` | 0.08 | hover / pressed wash over a surface |
| `opacityTint` | `--fx-opacity-tint` | 0.14 | soft status/accent backgrounds (chips, badges, error boxes) |
| `opacityScrim` | `--fx-opacity-scrim` | 0.5 | backdrop behind dialogs, sheets, lightboxes |
| `opacityGlass` | `--fx-opacity-glass` | 0.72 | how much surface colour a glass panel keeps |

Translucent colours are built from a colour token and a transparency token, never a fixed percentage:
`color-mix(in srgb, var(--fx-success) calc(var(--fx-opacity-tint) * 100%), transparent)`.
`--fx-scrim` is derived the same way on both ports (black at `opacityScrim`); a colour theme that authors a
`scrim` token overrides it. The style editors (Android Studio → Style tokens, web Element Explorer → Dialog,
Chip, Card) edit these live.

### Surface transparency (every surface has its own token)

Every framed surface reads its own transparency token (build transparency-token-works-every-dialog, Nov 13 2026).
Default 1 = fully opaque; lower it to see through. Below 1 the surface also frosts what is behind it
(`--fx-backdrop-<kind>` = `blur(var(--fx-blur))`; at 1 it is `none`, so an opaque surface never traps fixed popovers).
Defaults in `SURFACE_KINDS` / `SURFACE_OPACITY_DEFAULT` (`engines/theme.ts`).

| Field | Variables | Surfaces |
| --- | --- | --- |
| `opacityDialog` | `--fx-opacity-dialog`, `--fx-backdrop-dialog` | `.fx-dialog` (modal, drawer, sheet) |
| `opacitySettings` | `--fx-opacity-settings`, `--fx-backdrop-settings` | `.fx-window` + title bar: settings interfaces, floating tool windows |
| `opacityPanel` | `--fx-opacity-panel`, `--fx-backdrop-panel` | `.fx-card` (containers, groups) |
| `opacityMenu` | `--fx-opacity-menu`, `--fx-backdrop-menu` | `.fx-popover`, dropdowns, context menus |
| `opacityToolbar` | `--fx-opacity-toolbar`, `--fx-backdrop-toolbar` | `.fx-toolbar`, `.fx-menubar` |
| `opacityBanner` | `--fx-opacity-banner`, `--fx-backdrop-banner` | `.fx-banner` |

They live in the style theme, so they follow skins and design packages. Edit them in Token Control
(control@1 `tokens.style`, e.g. `set tokens.style opacitySettings 0.8`) or the Element Explorer (Dialog, Window, Card,
Context menu, Toolbar, Menubar, Banner). One floating window overrides its own value: window menu → Window settings →
Background (`WindowSettings.surface`, `surfaceVars('settings', v)` on the window; action
`windows.background:<window id>:<0..1|theme>`, deep link `dialog:window-settings:<window id>`). Inside a floating window
the tab group draws no background of its own (the window is the surface), and its tab bar reads `opacitySettings`;
elsewhere tab groups and the settings library's panels (level bar, nav list, group bodies, level columns) read
`opacityPanel`. The `glass` variants keep reading
`opacityGlass`. `check-theme.mjs` (rule *surface*) fails on any CSS rule that sets a surface root's background without
an `--fx-opacity-*` token.

`framework/ui/axf.css` is the base stylesheet. It reads only these variables and provides the shared layout
primitives (`fx-stack`, `fx-row`, `fx-row--wrap`, `fx-small`, `fx-muted`, `fx-mono`, `fx-eyebrow`, …) and
the React controls (`Button`, `Chip`, `Container`, …) render through them.

## Component token families: grid and tab group (component-tokens@1, Nov 13 2026)

Brett: "how many tokens does a grid have, colors, don't they need that to have hover colors; what about tab groups, are
they the same way". Until this build a grid had only its layout tokens and a tab group its padding; both borrowed the
general colour tokens, so a hovered row or an active tab could not be styled on its own. Now each has its own family,
declared once in `core/engines/component-tokens.mjs` (kind, level basic / pro / advanced, plain-English description,
default) and listed by `node framework/cli/component-tokens.mjs list [grid|tabs]`:

| Family | Variables | Read by | Tokens |
| --- | --- | --- | --- |
| `grid` | `--fx-grid-*` | `.fx-table` / `.fx-tablewrap` (axf.css), lib-datagrid `.axf-grid` | header (bg, text, active text, border, weight, sort arrow, plain-table header bg), rows (bg, alternate bg, text, hover, selected + border, focus ring, expanded, disabled opacity), lines, outer border, cell padding, row height, radius, group headers (three depths, text, summary), sticky shadow, empty text, opacity |
| `tabs` | `--fx-tab-*` | `.fx-tabs` / `.fx-tab` (page tabs), `.fx-tabs--group` (TabGroup), `.fx-tabgroup__bar` (window tab bars) | bar bg + border, gap, idle / hover / active / pressed / disabled text, bg, border, weight, focus ring, indicator colour + size, badge (idle + active), close button, dropdown pick, sticky bg, window bar + active tab, radius per style (underline, pills, boxed, segmented, plain, chips, window), the colours each style draws (pills active, boxed active, segmented track + active, plain active, chips), opacity |

**Defaults reproduce today's look.** Every default in the `:root` block of `framework/ui/axf.css` (generated:
`node framework/cli/component-tokens.mjs write`) points at the general token the component read before
(`--fx-grid-hover-bg: var(--fx-surface2)`, `--fx-tab-indicator: var(--fx-accent)`, …), so every existing skin renders
exactly as it did. Three places set a token, lowest to highest:

1. the `:root` defaults;
2. the style theme: optional `data.grid.<token>` / `data.tabs.<token>` maps (asset-types.json), compiled by `styleThemeVars`;
   skins set them, and control@1 `tokens.style` lists them as `grid.<token>` / `tabs.<token>` with variable, level,
   default and description (`axf token style set tabs.pillsActiveBg accent2`; Token control page, REST, MCP, voice);
3. one instance: a TabGroup by its id, a DataGrid by its id. Right-click a tab row → Settings… → Look → "Tab group colours &
   style (this one)": pick a token, type a value, Set; **Restore previous edit** swaps back to the values before the last
   edit (again = redo); **Restore from axHub** drops every value of that instance so it follows the shared look. Stored in
   the one setting `axf.tokens.instances` (rides the axHub look like every `axf.tokens.*` key). API: control@1
   `tokens.instances` (`set tabs.<row id>.<token> <value>`, `reset tabs.<row id>[.<token>]`,
   `act tabs.<row id> restore-previous | restore-hub`) and the actions `chrome.token`, `chrome.token-restore`,
   `chrome.token-hub` (voice, console actions). A grid's per-instance values are set the same way by API; the grid
   settings panel comes with the UI Manager work.

Values: a colour-theme token name (`accent`, `surface2`, `accentSoft`) → `var(--fx-accent-soft)`; a CSS colour; for
lengths a number (px), a CSS length, or a style / scale token (`radius.sm`, `dens-gap-md`, `space`); shadows
`shadow.sm|md|lg` or a CSS shadow; opacity 0..1. Anything else is refused by name and never written.

CI: `node framework/spec/check-component-tokens.mjs` fails when the `:root` block drifts from the schema, when a grid /
tab rule in axf.css or lib-datagrid reads a general colour token or a literal, when the compile / per-instance rules stop
matching `spec/fixtures/component-tokens.json`, or when control@1 stops listing a token. Kotlin twin deferred
(PORTING.md).

## Shared form controls (Oct 21 2026)

Apps and plugins never hand-roll a switch, a labelled field, a choice grid, a callout or a Markdown renderer: the
framework ships them on both ports with the same names, props and behaviour, and they size themselves from the style
theme (`--fx-space`, `--fx-font-size`, `--fx-row-h`, radii), so the Spacing choice applies.

| Web (`framework/react`, `.fx-*` in axf.css) | Compose (`axf-ui/components`) | What |
| --- | --- | --- |
| `Switch` (`.fx-switch`, `role="switch"` + `aria-checked`) | `AxfSwitch` | on/off with label + hint, or bare (`hideLabel`, `text`) |
| `Field` (`.fx-field`) | `AxfField` | label / control / hint-or-error wrapper (`aria-describedby`, `role="alert"` error) |
| `TextField` | `AxfTextField` | single- or multi-line input (`rows`), `mono`, `required`, `error` |
| `SelectField` | `AxfSelectField` | drop-down inside a Field (`empty` adds a blank choice) |
| `ChoiceGrid` (`.fx-choices`, radiogroup / group) | `AxfChoiceGrid` | tappable cards, single or `multiple` |
| `Note` (`.fx-note`, tones info / warning / danger / success) | `AxfNote` | inline callout |
| `Section` (`.fx-section`) | `AxfSection` | titled block without card chrome |
| `Markdown` (`.fx-md`, `compact`) | `AxfMarkdown` | safe Markdown: elements only, http(s)/mailto links only |
| `LibraryParamField` | `AxfLibraryParamField` | a library@1 parameter by type (`core/library.ts` = Kotlin `LibraryParams`) |

None of them is a component-style engine input: they read the compiled tokens only (no asset of their own). A kit
replaces them by overriding the corresponding `ComponentKind` (SWITCH, TEXT_FIELD, SELECT_FIELD, CHOICE_GRID,
LIBRARY_PARAM, SECTION, NOTE, MARKDOWN). The web Components view and the Android Component gallery show every one.

## Plugin and library UIs

Every library (`framework/libs/*`) and every app plugin (`apps/*/plugins/*`) that draws UI conforms to the
engines. This matters beyond looks: the planned **plugin designer** will lay out plugin interfaces, so a
plugin's UI has to be built from parts the engines and the designer understand.

1. **Tokens only.** No colour literals (`#hex`, `rgb()`, `hsl()`, named colours), no fixed transparency
   (`opacity: .5`, `color-mix(… 20%, transparent)`), no hard-coded font sizes, spacing or radii. Use `var(--fx-…)`, or `calc()` on a token (`calc(var(--fx-space) * 1.5)`). Layout
   limits and shapes (`min-width`, `max-width`, fixed heights of bars and charts, percentages, `0`, `999px`
   pill radii) are fine.
2. **No `var()` fallbacks** on `--fx-*`. The engines always define their tokens; a fallback only hides a
   misspelt or non-existent name.
3. **Lay out with the framework's primitives** (`fx-stack`, `fx-row`, `Container`, `Button`, `Chip`, …)
   rather than ad-hoc inline flex styles, so the designer can rearrange the parts.
4. **Its own look, through the engines.** A plugin that wants a look of its own ships its own assets
   (`color-theme`, `style-theme`, `layout`, component assets) and they are compiled by the same engines.
   It never hand-rolls styling outside them. *Status: planned — scoping a plugin's own assets to its views
   is not built yet; until it is, plugins use the app's active assets.*
5. Deliberate exceptions (a colour picker's default *value*, say) carry a `theme-ok` comment on the line.
6. **No px breakpoints (Nov 2026, every layout parameter is a token).** A media query can't read a token, so a
   stylesheet never writes `@media (max-width: 760px)`. The layout asset's viewport cut-offs (`tinyMaxWidth` 480,
   `smallMaxWidth` 640, `phoneMaxWidth` 760, `mediumMaxWidth` 900, `largeMaxWidth` 1200; `--fx-layout-*-max-width`)
   are stamped on the root by the runtime as `data-fx-tiny` / `-small` / `-narrow` / `-medium` / `-large`, so a
   rule selects on them: `:where([data-fx-narrow]) .axp-x { … }` (`:where()` adds no specificity, so the cascade is
   the media query's). `node framework/cli/layout-adopt.mjs <path>` rewrites a stylesheet; check-theme's `layout`
   rule fails any px breakpoint left (`layout-ok` on the line for a print or orientation query).

Checked automatically: `node framework/cli/check-theme.mjs` (runs in CI). Since the asset-conform build (Oct 31 2026,
shared rule "Handwritten code conforms to the asset system") **every** web UI gets every rule, handwritten or generated:
libraries, plugins, the framework's React and CSS, every app's own UI (`apps/demo` included), the app templates,
boilerplates and library templates. Rules: literal colours, fixed transparency, hard-coded sizes (px, rem, em spacing),
border widths (`--fx-border-w`), literal fonts (`--fx-font*`), `var()` fallbacks, unknown `--fx-*` names, defining
`--fx-*` and px breakpoints (`layout-adopt.mjs` moves them onto the viewport attributes); each finding names file:line and the token to use (`node framework/cli/scale-adopt.mjs <path>` writes most of
them in). Kotlin Compose files get the same treatment: no `Color(0x…)`, `.sp` text sizes, `.dp` spacing / radii or raw
Material controls (use `Axf.colors` / `Axf.type` / `Axf.space` / `Axf.shapes` and the `Axf*` controls).
Exempt: token/asset definition files (framework/core engines, `framework/ui/axf.css`'s own `--fx-*` defaults and optional
component-token fallbacks, axf-ui's `theme/` package, the controls in `axf-ui/components`). Frozen code (Android on hold,
is held to `framework/spec/conform-baseline.json`, which may only shrink (`--update-baseline`).
`node framework/cli/check-controls.mjs` holds every web `<button>` to the framework controls the same way. `axf init`
runs the theme check on what it generates and refuses to finish on a finding.

### Naming principles for plugin UIs

Names are how the engines, the designer and other plugins find a plugin's parts, so they follow one scheme.

- **`fx` belongs to the framework.** `.fx-*` classes, `--fx-*` variables and `data-fx-*` attributes are
  defined only by the engines and `axf.css`. A library or plugin reads them and never defines or overrides
  them.
- **One prefix per UI owner.** Every class and private variable a library or plugin defines starts with its
  prefix:
  - framework libraries: `axf-<library>` (the settings library uses `axf-settings`);
  - app plugins: `axp-<plugin folder>` (the Hub plugin in `plugins/hub/` uses `axp-hub`).
- **BEM inside the prefix:** `prefix__part`, `prefix__part--variant` (`axf-settings__tab`,
  `axp-hub__approval--expired`).
- **Parts are named for what they are, not how they look:** `__toolbar`, `__approval`, `__field`, never
  `__blue-box` or `__left-col`. A theme or the designer can move or recolour a part; its name must stay true.
- **State uses the shared `is-*` classes** (`is-active`, `is-selected`, `is-open`, `is-disabled`) on the part,
  not new state names, so themes style every plugin's states the same way.
- **Private variables are derived from tokens:** `--axp-hub-gap: calc(var(--fx-space) * 2)`. Never a raw value.
- **IDs are namespaced the same way:** view ids, nav item ids and settings keys use the plugin folder
  (`hub`, `hub.approvals`, `hub.pinPrompt`), and the library or plugin id is reverse-DNS
  (`ai.amberx.axf.console.hub`).
- **Names are stable.** Renaming a part breaks themes and saved designer layouts, so treat part names like
  public API: add new ones, deprecate old ones, don't silently rename.

## Skin animations: where they go (Nov 13 2026)

Brett: "where can I put some cool animations, like color swatches". Animations are part of the skin, so they live in
the **behaviour theme** a skin carries (`framework/assets/behavior-theme/<id>.json`, `data.motion`), never in a
plugin's CSS:

| Field | Values | Where it plays |
|---|---|---|
| `swatches` | `wave` · `ripple` · `pop` · `off` | every `Swatches` row (`react/components/Swatches.tsx`): skin cards in the skin picker, the Animations preview; a parent with `data-fx-swatch-host` plays its row on hover / focus / tap |
| `skinSwitch` | `ripple` · `sweep` · `fade` · `off` | every look change (skin on / off, picker preview, Back to skin, colour theme inside a skin): the new colours grow out of the last tap (runtime `withSkinSwitchFx`, View Transitions) |
| `picker` | `fan` · `pop` · `off` | every `SwatchFan` (ColorField, colour settings, Theme manager, Explorer): the pick pops and fans out into its shades |
| `animSpeed` | 25 to 400 (percent) | all of them · `animIntensity` 0 to 100: how far they move (0 = still) |

Rules: the engine (`core/engines/behavior.ts`, picks in `core/engines/animation-rules.mjs`) compiles these to
`--fx-anim-dur`, `--fx-anim-sweep-dur`, `--fx-anim-stagger`, `--fx-anim-ease`, `--fx-anim-pop-ease`,
`--fx-anim-intensity` and `data-fx-anim-*` attributes; `framework/ui/axf.css` (the "Skin animations" block) is the only
place keyframes are drawn, and every duration and distance there is a token. Reduced motion (system or the skin's
`reduced: always`) and intensity 0 turn every one off. Settings → Appearance → Animations lays this app's picks over the
skin's (`axf.appearance.animations`, carried in the app's look document).

To add a new animation: add its field to `ANIMATION_ENUMS` / `SKIN_ANIMATIONS` in animation-rules.mjs (and the copy in
`cli/build-engine.mjs`), draw it in the axf.css block under its `data-fx-anim-<name>` attribute, give the shipped
behaviour themes a value, regenerate `spec/fixtures/skin-animations.json` and extend `spec/check-skin-animations.mts`.
To put an existing one somewhere new: render `Swatches` (a palette row) or `SwatchFan` (a colour pick); nothing else.
