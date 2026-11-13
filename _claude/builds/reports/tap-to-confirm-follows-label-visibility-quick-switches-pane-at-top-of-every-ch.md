# Tap-to-confirm follows label visibility + quick-switches pane

Build `tap-to-confirm-follows-label-visibility-quick-switches-pane-at-top-of-every-ch`, Phase 1 (Opus), Nov 13 2026.

## What changed

**s1: default link to labels.** Tap-to-confirm now follows label visibility on every toolbar, tab group, navigation
menu and application menu bar. Where the labels are hidden (icons only) it is on; where they show, it is off.

- Engine `framework/core/engines/tapconfirm.ts`: `tapConfig(get, toolbarId, scope)` takes the scope (chrome type,
  instance, `labelsHidden`) and returns `source`. Manual settings win, most specific first:
  1. the toolbar override `axf.toolbar.<id>.tapConfirm` (Settings → Plugins → Toolbars): on / off
  2. the chrome instance field `tapConfirm` in `axf.chrome.<type>.<instance>` (its settings dialog): auto / on / off
  3. the global mode `axf.toolbars.tapConfirm`: labels (default) / on / off (older `true` / `false` read as on / off)
  4. otherwise: on exactly when the labels are hidden (`chromeLabelsHidden`).
- Web host `framework/react/tapConfirm.ts` now reaches `role="tablist"`, `role="menubar"` (its open `role="menu"`
  drop-downs run on the first tap) and `nav[data-axf-nav]`, as well as `role="toolbar"`. It reads
  `data-axf-labels="hidden|shown"`; an unmarked scope counts as hidden when none of its buttons has text. A nav inside
  a region folded to icons (`data-fx-navs-collapsed="on"`) counts as hidden.
- Renderers mark `data-axf-labels`: app toolbar (variant `icons`), asset toolbars, `TabGroup` (display `icons`),
  `NavMenu` / `NavTree` (new nav-menu field `showLabels`, CSS hides `.fx-nav__text` when off), menu bar (always shown).
- chrome-settings@1: `tapConfirm` (auto / on / off) on toolbar, tab-group, nav-menu, app-menu; `showLabels` on
  nav-menu. Both are optional fields in `framework/schemas/asset-types.json` (additive).
- Toolbars plugin: the global switch is now a choice, Follow labels / Always / Never; the All toolbars list says
  why each toolbar is on or off.

**s2: quick-switches pane.** Every toolbar, tab group, nav menu and app menu settings dialog opens with a collapsible
**Quick switches** pane: the fields marked `quick` in CHROME_FIELDS (label visibility + tap to confirm), a line with
what tap to confirm does there now and which setting decided, and a **Follow labels** button when a manual choice is
set. The quick fields leave the Look / Behaviour tabs while the pane shows (a settings asset can hide the pane with
`hide: ["quick"]`). The fold is the setting `axf.chrome.quick.<type>`. `Container` gained optional controlled
`open` / `onOpenChange`.

## API (all four the same: console REST action, MCP `console_action`, CLI `axf console action`, voice)

| What | How |
|---|---|
| Open a dialog (deep link) | `chrome.settings:<type>:<instance>` (e.g. `chrome.settings:tab-group:settings`); `axf console dialog axf.chrome.settings` |
| Tap to confirm for one instance | `chrome.set:<type>:<instance>:tapConfirm:<auto\|on\|off>` |
| Labels | `chrome.set:nav-menu:app:showLabels:<on\|off>`, `chrome.set:tab-group:<id>:display:icons`, `chrome.set:toolbar:app:variant:icons` |
| Global mode | setting `axf.toolbars.tapConfirm` = `labels` / `on` / `off` (settings API, control@1) |
| Quick pane fold | `chrome.quick:<type>:<open\|fold\|toggle>`; setting `axf.chrome.quick.<type>` |
| State readable | settings `axf.chrome.<type>.<instance>`, `axf.toolbars.tapConfirm`, `axf.toolbar.<id>.tapConfirm`; React `chromeTapState(rt, type, instance)` returns `{ enabled, source, labelsHidden }` |

## Checks

- `npx tsx framework/spec/check-tapconfirm.mts`: 69/69 (precedence, label linking, every scope kind in the host,
  menu drop-downs, quick fields).
- `npx tsx framework/spec/check-chrome-settings.mts`: 280 checks; fixture `chrome-settings.json` regenerated.
- console-web `tsc --noEmit` with the changed framework files copied in: clean.
- check-theme, check-controls, check-toolbars, check-chrome-assets: pass.

## Gaps

- Kotlin twin deferred (Android on hold): recorded in `framework/spec/PORTING.md`.
- Toolbar and nav instance overrides other than `showLabels` still don't change how the app toolbar / nav draw (an
  older gap: only tab groups apply `axf.chrome.<type>.<instance>` overrides when rendering).
- Baked app copies (`apps/*/src/axf`) are not rebaked in this PR; console-web's rebake is blocked by unrelated edited
  baked files (`core/build-hook.mjs`, `core/engines/appearance.ts`, `assets/help/framework-drafts.json`).
