# AmberX design language — the quality bar

Brett, Oct 27 2026: the framework and the apps built on it have to read as professional, enterprise-grade work,
never amateur. This file is the bar every asset, chrome piece, plugin page and generated brand asset is held to
from the `enterprise-branding` build on. It describes **rules**, not one look: a design package picks the values,
this file says what values are allowed and how pieces relate. Fixture-pinned checks (`check-design-language.mts`,
step s12 of the build) enforce the numeric rules on every starter asset.

## 1. One system, many looks

- A look is a **design package** (style theme + colour theme + layout + behaviour theme) plus a **branding
  package** (marks, animated marks, icon pack, decorations). Swapping either restyles every app, plugin and
  library at once: nothing visible is allowed to sit outside the engines.
- Every rule below is written against tokens (`--fx-*`), never literal values, so a package can be tight or
  roomy, flat or glassy, and still pass.
- A package that fails the ratios below is not "a different taste": it's rejected by the checker.

## 2. Type ramp

One family for UI text, one display family for headings (may equal the UI family), one monospace. Sizes are
ratios of `--fx-font-size` (the style theme's base, 13–16 px):

| Role | Size | Weight | Tracking | Line height |
| --- | --- | --- | --- | --- |
| Page title (`h1`) | 1.75× | headingWeight | tracking × 1.5 | 1.2 |
| Section (`h2`) | 1.25× | headingWeight | tracking | 1.3 |
| Group (`h3`) | 1× | 600 | tracking | 1.4 |
| Body | 1× | 400 | 0 | 1.5 |
| Secondary (`fx-small`) | 13/14× (≈ 0.93×) | 400 | 0 | 1.45 |
| Caption / badge | 12/14× | 500 | +0.01 em | 1.3 |
| Eyebrow | 11/14× | 600 | +0.08 em, uppercase | 1.3 |
| Code (`fx-mono`) | 13/14× | 400 | 0 | 1.5 |

Rules: never a size below 11/14× of the base; never more than two weights on one row; uppercase only for
eyebrows and tiny badges; numbers in tables use tabular figures.

## 3. Spacing scale

Everything is a multiple of `--fx-space` (the style theme's unit, 6–12 px). Allowed multipliers: 0.25, 0.5,
0.75, 1, 1.5, 2, 3, 4, 6. Rules:

- Inside a control: 0.5–1× horizontally, 0.25–0.5× vertically.
- Between controls in a row: 1×. Between rows: 1×. Between groups: 2×. Between sections: 3×.
- Card padding: 2× (compact 1.5×). Page gutter: 2× on phones, 3× from 720 px.
- The Spacing choice (Super tight / Compact / Regular) scales the unit; it never changes the multipliers.

## 4. Elevation

Four levels, always from `--fx-shadow-*` and `--fx-surface*`, never a literal shadow:

| Level | Surface | Shadow | Used for |
| --- | --- | --- | --- |
| 0 flat | `--fx-bg` | none | page background |
| 1 raised | `--fx-surface` | `--fx-shadow-sm` | cards, rows, toolbars |
| 2 floating | `--fx-surface` | `--fx-shadow-md` | menus, popovers, pop-ups |
| 3 modal | `--fx-surface` + scrim | `--fx-shadow-lg` | dialogs, floating windows, drawers |

A glass surface is the same level with `--fx-opacity-glass` and `--fx-blur`; glass never below level 2.

## 5. Radii

Three radii from the style theme (`sm` ≤ `md` ≤ `lg`, each 0–24 px): `sm` on controls and chips, `md` on cards,
menus and inputs, `lg` on dialogs, windows and sheets. Pills are `999px`; avatars `50%`. A nested element never
has a radius larger than its container's minus the padding.

## 6. Colour

- Colour tokens carry meaning: `accent` = the one action that matters on screen, `success` / `warning` / `danger`
  / `info` = status, nothing else is coloured. One accent per screen region; a second accent is a brand decision
  recorded in the branding package, never in a page.
- Contrast: text on its surface ≥ 4.5:1, large text and icons ≥ 3:1, hairline borders ≥ 1.25:1 against the surface (a border that is the only boundary of a control ≥ 3:1).
  The theme checker (`check-design-language.mts`) measures every starter colour theme.
- Translucency always comes from a transparency token (`--fx-opacity-*`), see THEMING.md.
- Dark themes are not inverted light themes: surfaces step up in lightness with elevation (bg < surface <
  surface2 < surface3), accents are lightened for contrast, shadows are near-black with higher opacity.

## 7. Motion

From the behaviour theme and the style theme's `motion` (80–320 ms base):

| Kind | Duration | Easing |
| --- | --- | --- |
| Micro (hover, press, toggle) | 0.5× base | `--fx-ease` standard |
| Enter (menu, popover, toast) | 1× base | decelerate |
| Exit | 0.75× base | accelerate |
| Modal / window | 1.5× base | standard |
| Attention (badge pulse, logo animation) | ≥ 4× base, looping | ease-in-out |

Reduced motion (system or behaviour theme) keeps every state change but removes movement: opacity only, and
animated logos show their still frame.

## 8. Density

Three densities (compact / comfortable / roomy) map to `--fx-row-h` (minimum 22 px) and `--fx-density-k`. Touch
targets never shrink below 40 px on a coarse pointer whatever the density; the hit area grows around a small
visual control instead.

## 9. Iconography

- Icons come from the active **icon pack** (icon-pack@1); the framework glyph set is the fallback for any name
  the pack lacks. Packs are 24-unit grids, 1.5–2 stroke (outline packs) or filled, optically centred.
- Icon size = 16/14× of the font size inline, 20/14× in toolbars and nav, 24/14× standalone. Icon colour =
  the text colour of its context, never a decorative colour except status dots.
- Every icon-only control has an accessible name.

## 10. Logos and brand marks

- Three mark forms per brand: **wordmark**, **mark** (square, works at 16 px), **lockup** (mark + wordmark).
  An **animated mark** is the mark with a motion preset (see §7 attention timing) and a still frame.
- Placement: banner left = lockup at the banner's height minus 2× padding; window and dialog title bars =
  mark at the title's cap height, before the title; floating windows and containers = mark only when the
  branding package's `decorations` says so, never in a running row of cards; toolbars = none unless the
  toolbar asset places a `logo` widget; tab groups = mark on the active tab only when the tab is an app.
- Marks are SVG path data through the sanitiser (no script, no external refs, ≤ 24 KB); colours are tokens
  (`currentColor`, `--fx-accent`, the brand palette), so a mark follows the theme.
- Clear space around a mark = the mark's height × 0.25; minimum size 16 px (mark), 80 px (wordmark).

## 11. Chrome rules

- **Banner**: one line, 24–40 px, holds lockup · search · status widgets; nothing else.
- **Application menu**: every reachable page and action; labels are verbs or nouns, never both; ≤ 9 top menus.
- **Toolbar**: ≤ 12 items visible; overflow collapses; icon + label at roomy density, icon only at compact.
- **Navigation**: one level visible, groups by section eyebrow, active item marked by the nav asset's indicator.
- **Context menus**: ≤ 12 items at the first level, destructive actions last and separated.
- **Dialogs**: title, one paragraph, primary action right-most; destructive primary is `danger` tone.
- **Windows**: title bar = mark · title · controls; tab bars inside windows follow the tab-group asset.
- **Containers / cards**: title, optional eyebrow, optional actions right; collapsible per the style theme.
- **Banners (plugin banners)**: one line collapsed, each with its icon, tone from the banner's own settings.
- **Empty states**: an icon, one sentence, one action. **Loading**: skeletons, never spinners for lists.

## 12. Plugins

Every plugin page (`apps/console-web/plugins/*`, `apps/amberx-droid/src/plugins/*`) uses: `fx-pagehead` with
eyebrow + title + one-sentence description; sections as `Container` cards; framework controls only
(THEMING.md); tables through the framework DataGrid; no page-level colour. The refactor phase of the
`enterprise-branding` build brings every in-scope plugin to this.

## 13. Scope of the first refactor (Brett, Oct 27 2026)

Only: the Dev Console (shown as **GizmoX**), the AmberX app (amberx.amberxai.com), the console plugins
**installed and switched on in Plugin switches** at the time the refactor phase starts (read live through axHub
by the session doing it), and every banner plugin. Everything else keeps its current UI until asked.

Read live on Oct 27 2026 (axHub `vps.run`, approval 72afb5a6): the console has no `.axf-console/plugins.json`,
so nothing has been switched off and every installed plugin runs — all 32 (`activity`, `agent-manager`,
`ai-assistant`, `ai-keys`, `alerts-bell`, `approvals-banner`, `build-manager`, `build-orchestrator`,
`changes-grid`, `claude-badge`, `claude-handoff`, `codebase-changes`, `console-terminal`, `container-access`,
`context-menu-designer`, `fable-rebuilds`, `feature-assist`, `hub-sync`, `main-build-status`, `mcp-client`,
`plugin-manager`, `plugin-switches`, `plugin-update`, `plugins-menu`, `project-wizard`, `push-banner`,
`session-checkin`, `snapshot-manager`, `systems-check`, `theme-manager`, `todo-manager`, `voice-notes`) are in
scope; the seven banner plugins (`activity`, `approvals-banner`, `build-manager`, `claude-handoff`,
`codebase-changes`, `push-banner`, `systems-check`) are among them.

## 14. What a checker verifies

`framework/spec/check-design-language.mts` (added with the generators, step s12): every starter colour theme's
contrast pairs (§6), every style theme's radii order and base-size range (§2, §5), every behaviour theme's
durations against the motion table (§7), every logo / animated logo / icon pack asset against size, grid and
sanitiser limits (§9, §10), and every banner / toolbar / context-menu starter against the item limits (§11).
