# Professional skins that rebuild the whole app (professional-skins-rebuild-whole-app)

Built Nov 13 2026 on Fable (phase 1, every step), branch `claude/professional-skins-rebuild-whole-app`, PR [#557](https://github.com/MossesX/AmberX-AXF/pull/557). UI Review: one choice set of the four skins (desktop + phone shots of settings, home, builds, a dialog and a context menu under each), waiting for Brett's pick in priority order.

Brett: "each skin is a complete restyle AND rebehave of the entire console UI. Every asset (theme, layout, toolbars, tab
groups and where tabs go, buttons and how they behave, context menus, nav menu, app menus, dialogs, tables, …)."

## What a skin is now: skin@2
- A skin carries its look (themes, every slot asset, icon pack, style parts) **and a behaviour pick per asset type**.
  Behaviour axes are declared on the type's registry entry (`schemas/asset-types.json` → `behaviour`), never in a list:
  nine types declare 23 axes today (tab-group position / overflow / style / display, toolbar placement / tapConfirm /
  labels, button press / confirm / confirmBy / holdMs, context-menu form / submenus, nav-menu mode / side, app-menu
  form, dialog presentation / panelSide, table form / density / rowActions / stickyHeader, banner placement).
- Every axis compiles to `--fx-bhv-<type>-<axis>`, `data-fx-bhv-<type>-<axis>` on the root and each SkinScope, and
  `axf.behaviour.<type>.<axis>` the controls read. Precedence: a row's own override (`axf.chrome.*`) > a behaviour
  override on the nearest skin level (plugin → screen → app → hub) > the skin's behaviour > the asset's field > today.
- A skin@1 reads as a skin@2 with today's behaviour: nothing changed on screen when it landed (pinned by the fixture).
- Engine `framework/core/engines/skin-behaviour.mjs`; coverage in `skin-coverage.mjs` (`skinCoversTable`,
  `skinUncoveredBy`); per-level overrides in `skin-rules.mjs`; resolver and tokens in `skin.ts` + the runtime.
- New asset type **table** (table@1): form grid / cards / terminal, density, row actions, sticky header, zebra,
  dividers, header case. Every `fx-table` and lib-datagrid follows it. `table: standard` is the default everywhere.

## The console follows the skin
- Shell: `rt.shellLayout()` moves the nav (sidebar, rail, drawer over the page, bottom tabs, top bar; the layout gained
  `nav: bottom`), the toolbar (top / bottom), the banner (top / bottom) and swaps the menu bar for one Menu button that
  opens every menu as a menu, a searchable palette (Ctrl / Cmd+K) or a bottom sheet.
- Controls: TabGroup, Toolbar, Button (press feedback; confirm by dialog, inline Confirm / Cancel, press-and-hold, tap
  twice), the context-menu host (menu, sheet, palette; flyout or inline sub menus), the dialog host (modal, sheet, side
  panel either side, full screen), DataGrid and fx-table (form, density, row actions, sticky header), tap to confirm.

## The four skins (framework/assets/skin/)
| skin | rebuilds | own assets |
| --- | --- | --- |
| Studio Pro | dense IDE desktop: rail nav, top underline tabs, full menu bar, side-panel dialogs, compact sticky tables | layout, colour theme, style theme, table |
| Executive | minimal: top bar nav, pill tabs with More, one Menu button, roomy upper-case tables, centred modals | layout, colour theme, table |
| Field | phone-first: bottom tabs, thumb toolbar with tap to confirm, bottom sheets everywhere, card tables, tap-twice buttons | layout, colour theme, style theme, table |
| Command | keyboard-first: command palette, hidden drawer, bottom tabs, inline confirm, palette menus, terminal tables | layout, colour theme, table |

Every one (and the migrated Windows skin) covers every registered type on look and behaviour; CI fails otherwise.
All five are baked into the Dev Console, axHub web, AmberX and Molly.

## How each feature is reached (API parity)
| feature | UI | deep link | REST (theme-manager) | MCP | CLI | voice / actions |
| --- | --- | --- | --- | --- | --- | --- |
| Skin gallery (preview cards, what it changes, where, use, back, off, restore, undo) | Settings → Appearance → Skin gallery… | `console_show settings/appearance/skin/<id>` | `POST skins/{app}/gallery {skin}` | the same routes as plugin commands | `skins.mjs gallery <app> [<skin>]` | `skin.gallery[:<id>]` |
| Use / off / inherit / follow / hub-wide | gallery Where + Use skin | – | `skins/{app}/use` `off` `inherit` `follow`, `skins/global` | ✓ | `skins.mjs use | off | inherit | follow | global` | `skin.use`, `skin.off`, `skin.scope`, `skin.inherit`, `skin.global` |
| Preview without saving | tap a card | – | `POST skins/{app}/preview {skin}` | ✓ | `skins.mjs preview <app> <skin>|off` | `skin.preview:<id|off>` |
| State: skin per scope, resolved look + behaviour | gallery, Appearance → Where | – | `GET skins/{app}/at?scope=`, `GET skins/{app}/behaviour` | ✓ | `skins.mjs at`, `behaviour` | – |
| Behaviour override per axis / back to skin | Appearance → Behaviour row, gallery Back to skin | – | `POST skins/{app}/behaviour {type, axis, value, scope?}`, `behaviour/reset` | ✓ | `skins.mjs behaviour <app> <type> <axis> <value>|default` | `skin.behaviour:<type>:<axis>:<value>`, `skin.behaviour.reset` |
| Axes, compare, coverage | gallery What this skin changes | – | `GET skins/axes`, `skins/compare/{a}/{b}`, `skins/coverage`, `skins/covers/{skin}` | ✓ | `skins.mjs axes | compare | coverage | covers` | – |
| Navigation drawer (skin mode drawer) | Menu button | – | – | – | – | `nav.drawer:open|close|toggle` |

## CI and tests
`check-skin.mts` (behaviour fixture block + runtime), `check-skin-coverage.mjs` (strict on shipped skins),
`check-chrome-assets.mjs` (no hand-written behaviour attributes), `theme-swap.mjs` (every skin switched live; fails on a
colour, size or behaviour that does not follow), `check-layout-tokens.mts`, `check-theme`, `check-controls`,
`check-toolbars`, `validate --framework`, framework typecheck, console typecheck + build.

## Deferred
- Kotlin twin of skin@2 (Android on hold): `spec/PORTING.md` → "Deferred: skin@2 behaviour".
- PR #547 (skin-config@1): once both land its categories gain a `behaviour` group per type from `behaviourAxes`.

## Session note
The dispatcher launched three Fable sessions on this build in the same worktree (06:14, 06:15, 06:30). The first
(this one) stopped the second at 06:30; the third stood down on its own at 06:42 after documenting the root cause in
two build notes (pipeline:launch fired twice with no live-session check). Fix for a follow-up build: `launch()` must
refuse when `pipeline.session` is alive.
