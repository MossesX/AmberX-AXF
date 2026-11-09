# Skin audit: what a skin can't restyle

Build `skins-restyle-everything-badges-banner-and-every-visual-element` (Nov 2026). Brett: "the skin literally needs to
change every single visual thing everywhere, in every framework app … I need it to look professional."

Re-run at any time: `node framework/cli/skin-audit.mjs` (`--json` for the full list with line numbers). The registry
side is `node framework/cli/skins.mjs coverage` (every asset type has a way in: 0 uncovered).

## How a skin reaches the screen

1. **Themes**: the colour, style and layout themes set the `--fx-*` tokens every rule reads.
2. **Slots**: the assets the skin picks for each appearance slot (banner, toolbar, button, dialog …).
3. **Parts**: `skin.data.parts.<type>` style tokens, drawn by the customize engine (`core/engines/customize.ts`) under
   the type's style target in `schemas/customize.json` (`root` + `item`), as `:root body <root>{…}`.

Anything only (1) reaches changes colour with the skin but keeps its shape, weight and type. Anything inside a typed
element that sets its own colour or font is not reached by (3) even when its parent is.

## Findings (baseline, Nov 9 2026)

### Fixed in s1: banner badges

The `badge` target named only `.fx-badge`; banner badges render `.fx-banner__badge` (`BannerBadge`, every badge asset
and the plugin badges: Claude, VPS, axHub, AmberX, usage). A skin's badge parts (the Windows skin's `radius: sm`)
never reached them. The target now names both.

### target: 0

Every style-target root and item class is rendered by framework code.

### shadowed: 71 rules in 14 types

Elements inside a typed element with their own colour / font / radius / border, so the type's parts stop at them:

| Type | Elements |
|---|---|
| banner | `__logo`, `__more`, `__dot`, `__pop`, `__side` |
| toolbar | `__widgets`, `.fx-toolbtn__badge` |
| nav-menu | `__header`, `__label`, `__badge`, `__chev`, `__sub`, `__sheet` |
| tab-group | `.fx-tab__badge`, `.fx-tab__close`, `.fx-tabs__pick` |
| dialog | `__head` |
| container | `.fx-card__head` |
| search-bar | `__clear`, `__hit`, `__detail`, `__kind`, `__empty` |
| counter, status, progress, avatar | numbers, labels, dots, bars, initials |
| slider, gauge, meter | heads, values, tracks, fills, cells, ticks |

### untyped: 75 components

No asset type owns them, so only the theme tokens restyle them. Largest: `.fx-menu` (19 rules: the dropdown and
context-menu list), `.fx-idcard`, `.fx-dcard`, `.fx-agent-avatar`, `.fx-chip`, `.fx-window`, `.fx-field`, `.fx-seg`,
`.fx-terminal`, `.fx-choice`, `.fx-switch`, `.fx-input`, `.fx-toast`, `.fx-table`, `.fx-note`, `.fx-md`, `.fx-status`,
`.fx-kbd`, `.fx-code`. Tables, inputs, toasts, chips, switches and scrollbars are in this group.

### literal: 99 in framework CSS, 184 in plugin and console CSS

Look values written in, which no theme, asset or part changes:

- `font-weight: 400…800` (41 in axf.css, 2 in framework TSX): written as numbers instead of the typography asset's
  `--fx-type-weights-{body,medium,strong}`, so a skin's typography couldn't make text lighter or heavier.
- `border-radius: 999px | 50%` (44): pill and circle shapes, allowed by check-theme as shapes; parts can still override
  them on typed roots.
- `outline: 2px …` (12): focus rings at a fixed width instead of the border width.
- Plugin and console CSS, most first: `console.css` 30, `plugin-manager` 13, `console-terminal` 10, `plan-studio` 9,
  `systems-check` 8, `crew-live` 8, `push-banner` 7, `approvals` 6, `claude-handoff` 6, `build-manager` 6.

## Plan

- **s3, batch 1 (shell, banner, toolbars, menus, dialogs)**: shadowed banner / toolbar / nav / tab / dialog children
  inherit the type's text (`color` / `font-family` from the root, tone colours stay on tokens); `.fx-menu` joins the
  menu style targets so app-menu and context-menu parts reach dropdown lists; focus rings read `--fx-border-w`.
- **s4, batch 2 (tables, forms, charts, plugin screens)**: same for card / search / widget / slider / gauge / meter
  children; plugin CSS literals moved onto tokens (`scale-adopt.mjs`); table, input and chip rules checked against the
  theme tokens.
- **Fable (s6)**: explicit `skin` entries in `asset-types.json`, and an optional `text` selector list on customize
  targets (engine change in `customizeCss`: a type's text parts also set the elements that carry its text, such as
  `.fx-banner__logo`, `.fx-nav__header`, `.fx-card__head`). Shadowed text children wait for that: making them
  `inherit` in CSS would change the default look.
- **s5**: the screenshot gate (each skin vs the default, fail on unchanged elements) after s6 lands.

## Done

- **s1**: badge target reaches `.fx-banner__badge`.
- **s3**: every `font-weight` in axf.css and the framework TSX reads the typography weights (same values by default:
  700 = `calc(var(--fx-type-weights-strong) + 100)`); every focus ring and outline reads `--fx-border-w`; the app-menu
  target's items include the dropdown's `.fx-menu__item`; the badge target includes the count badges on tool buttons,
  nav items, tabs and menu items; the popup target includes the banner's pop-up bubble. Literals left in axf.css:
  44 pill / circle radii (shapes; parts override them on typed roots).
- **s4**: the same for every plugin, library and app stylesheet (console plugins, framework libraries with their
  console copies, molly, walkthrough-studio): 124 `font-weight` numbers now read the typography weights. Focus rings,
  outlines and SVG chart / graph strokes (gauge ticks and needle, plugin graph edges, recorder, avatars) read
  `--fx-border-w` with a floor (`max(calc(var(--fx-border-w) * 2), 2px)`), so a skin with heavier borders thickens
  them and a look token that sets the border width to 0 can't hide focus rings or chart lines. Same values by default.
- **Still theme-only (no asset type)**: tables (`.fx-table`, datagrid), inputs and fields, chips, switches, toasts,
  scrollbars, terminal, cards that aren't containers (`.fx-idcard`, `.fx-dcard`). They follow the skin's colour, style,
  typography, density and sizing assets; a skin can't give them their own parts until they get asset types (Fable).
