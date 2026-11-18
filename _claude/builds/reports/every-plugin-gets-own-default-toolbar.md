# Every plugin gets its own default toolbar; toolbars are generic or screen-specific

Build `every-plugin-gets-own-default-toolbar` (Opus, phase 1). Brett, Nov 18 2026: every plugin gets its own default
toolbar asset (`default-<plugin>-toolbar`), locked by default like the settings interfaces; every toolbar is generic
or built for one screen; a screen's picker lists only generic toolbars plus its own; the override switch changes look
and style only, never the buttons.

## What landed

Contract **toolbar-owner@1**, reference engine `framework/core/engines/toolbar-owner-rules.mjs` (+ `.d.mts`), modelled
on settings-iface@1.

- **Who a toolbar is for** — optional `data.builtFor`: `generic` | `view:<view id>` | `plugin:<name>`. Absent = read
  from `scope` (app → generic). Validated in `core/validate.ts`; documented in `asset-types.json`. Backfilled on all
  160 toolbars in the repo: the shared starters in `framework/assets/toolbar` are generic, plugin page toolbars name
  their screen.
- **A locked default per plugin** — `apps/console-web/plugins/<folder>/assets/toolbar/default-<folder>-toolbar.json`
  for all 75 console plugins. 15 plugins' own main page toolbars were migrated into it (file + id renamed; scope,
  buttons and settings ids kept, so every override and pick still applies). The rest get a placeholder (tag
  `placeholder`, one Settings button → `plugin.settings.open:<folder>`). A placeholder never replaces a page's own
  handwritten bar (`<PageToolbar fallback>` keeps the fallback) and does not count as a page toolbar in
  `check-toolbars` / `check-page-toolbars`.
- **The picker** — `pickPageToolbar` draws the screen's own toolbar (scoped to the view, else the plugin, else the
  plugin's default). The pick (`axf.chrome.toolbar.<settings id>.asset`, absent = locked default) counts only when it
  is generic or built for that screen (`toolbarChoices`, `toolbarPick`, `toolbarPickSet`). Change… on a page toolbar
  opens `PageToolbarPicker`: a *Use another toolbar* switch (off = the screen's own, locked), then only generic +
  this-screen toolbars. The Interface tab's asset select lists the same set.
- **Look only** — a pick lends `TOOLBAR_LOOK_KEYS` (variant, align, density, surface, divider, collapsible, overflow)
  via `layerToolbarLook`; groups, search and widgets stay the screen's own. Per-instance overrides
  (`axf.chrome.toolbar.<id>`) go through `toolbarOverrideOnly` (look keys + showSearch + tapConfirm).
  `toolbar-owner check` fails if a chrome toolbar field or a look key could ever touch buttons.

## How each part is reached (API parity)

| What | Deep link / UI | REST / MCP / voice | CLI |
|---|---|---|---|
| Pick a screen's toolbar | right-click a toolbar → Change… (`chrome.pick:toolbar:<id>`) | console action `toolbar.pick:<id>:<asset\|default>` through `/api/console-control`, the `console_control_*` MCP tools, AmberX voice | `axf console` with the same action |
| Open the picker | `toolbar.choose:<id>` | same | same |
| Read state | `toolbar:<id>` console-control state now carries `lookFrom`, `pick` (`id`, `defaultId`, `locked`) and `choices` | same | `node framework/cli/toolbar-owner.mjs choices <view> [<plugin>]` |
| Inventory | — | — | `toolbar-owner.mjs list`, `check` |
| Defaults / migrate / backfill | — | — | `toolbar-owner.mjs defaults\|migrate\|backfill --write` |

## Tests and CI

- `node framework/spec/check-toolbar-owner.mjs` (fixture `framework/spec/fixtures/toolbar-owner.json`, 22 checks +
  repo check), added to `.github/workflows/android.yml` next to check-settings-iface; the CI template plugin also gets
  its default toolbar (`toolbar-owner.mjs defaults --write`).
- `framework/spec/check-toolbar-actions.mts`: the pick case is now "user pick lends its look (buttons stay)";
  fixtures regenerated (`toolbar-actions.json`, `toolbar-migrate.json` gain builtFor).
- `check-page-toolbar-voice.mts --write` regenerated the voice inventory for the renamed ids.
- Green: check-toolbars, check-chrome-assets, check-page-toolbars (20), check-toolbar-actions (325), settings-iface,
  shared-assets, check-theme, check-controls, check-console-control, chrome-settings, check-tapconfirm,
  check-asset-overrides, check-done-means-merged (all re-run after merging main). Console `tsc --noEmit` was clean
  before the main merge (only the generated `src/control/inventory.json` that a fresh checkout lacks); the
  post-merge run never got a VPS heavy slot in 15 min (2/2 busy), so CI's typecheck covers the merge commit.

## Coordination (s6)

- **settings-fix-part-2-blank-toolbars** (Fable, queued) is the toolbar override wiring: its s3 adds
  `axf.toolbar.<id>.override`; s6–s9 strip page toolbars to a gear. Note left on the build: the switch must go through
  `toolbarOverrideOnly` / `TOOLBAR_OVERRIDE_KEYS` (look only), framework toolbars stay generic, and the gear-only strip
  edits each plugin's `default-<folder>-toolbar.json` instead of adding new assets.
- Same note on `rebuild-every-context-menu-toolbar-nav`, `toolbars-1-5` … `toolbars-5-5`,
  `attach-widgets-to-any-toolbar-banner`: a plugin's toolbar lives in its default file; widgets are not lent by a pick.

## Choices made (nobody to ask)

- `builtFor` is optional on toolbars (unlike settings) so app-own and third-party toolbars keep validating; the
  repo check requires it on every file here.
- A plugin's toolbar that targets one of its views keeps `scope: view:<id>` and gets `builtFor: plugin:<folder>`.
- App-level `src/assets-overrides/toolbar/*` (the console's tuned frame-toolbar copies) still change groups: they are
  app copies of the shared frame toolbar, not a per-screen override switch.
- Re-baking pulled main's earlier framework drift into the baked copies (`rebake apply --force`); the baked
  `framework-drafts.json` / `plugin.schema.json` edits were overwritten by the framework copies (the framework copy
  is the source).

## Deferred

- Kotlin twin (`ToolbarOwnerRules`, `PageToolbarEngine.kt`), recorded in `framework/spec/PORTING.md`.
- UI Review choice options for the picker dialog (no headless capture on the VPS in this session).
