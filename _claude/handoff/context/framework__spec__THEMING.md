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
| layout (`core/engines/layout.ts`) | `layout` | `--fx-grid-*`, `--fx-content-max` and the shell's regions |
| components (`core/engines/components.ts`) | `button`, `slider`, `container`, … | `--fx-btn-*`, `--fx-slider-*`, … plus `data-fx-*` attributes |

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

`framework/ui/axf.css` is the base stylesheet. It reads only these variables and provides the shared layout
primitives (`fx-stack`, `fx-row`, `fx-row--wrap`, `fx-small`, `fx-muted`, `fx-mono`, `fx-eyebrow`, …) and
the React controls (`Button`, `Chip`, `Container`, …) render through them.

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

Checked automatically: `node framework/cli/check-theme.mjs` (runs in CI). Libraries, plugins and the console's
own UI get every rule: literal colours, fixed transparency, hard-coded sizes, `var()` fallbacks, unknown `--fx-*` names and
defining `--fx-*`. The framework's React/CSS, other app UIs and the app templates get the colour and
transparency rules, so swapping a colour or style theme restyles them too. (`apps/demo` is untouched
`axf init` output on an older baked framework and is skipped until it is re-baked.)

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
