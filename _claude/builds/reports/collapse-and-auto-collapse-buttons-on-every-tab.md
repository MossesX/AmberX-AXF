# Collapse and auto-collapse buttons on every tab group, toolbar, nav menu and app menu

Build `collapse-and-auto-collapse-buttons-on-every-tab`, Phase 1 (Opus). Branch `claude/collapse-and-auto-collapse-buttons-on-every-tab`.

## Brett said (Nov 12 2026, 18:40)
> All tab groups and toolbars and nav menus and application menus need a, auto collapse button or, and a collapsible button.

## What was built
Every tab group, toolbar, navigation menu and application menu, in every app on the framework (console, Molly,
axHub web, AmberX, new apps through `axf init`), now has:

- **A collapse / expand button** (chrome field `collapsible`, now **on by default** for all four; an asset or a
  person can turn it off). Folding is remembered per device.
  - Tab group: folds to its active tab (`axf.tabs.<id>.folded`). Fixed a CSS bug where the folded row also hid its own
    expand button.
  - App toolbar: folds to a thin handle (`axf.toolbar.collapsed`). Page toolbars (`AssetToolbar`) fold too
    (`axf.toolbar.<asset>.collapsed`).
  - Every other toolbar (plugin and library `role="toolbar"` rows): gets the same button from one framework installer
    (`framework/react/toolbarFolds.tsx`, mounted by `<AxfProvider>`, the way tap-to-confirm reaches every toolbar),
    keyed by the toolbar's settings id. Opt-out in code: `data-axf-no-fold="<why>"`.
  - Nav menu: folds to its icons (`axf.nav.collapsed`), the nav-style tree and the plain nav alike (vertical, not on a phone).
  - Application menu (menu bar): folds to one Menu button (`axf.app-menu.collapsed`).
- **An auto-collapse switch** (chrome field `autoCollapse`, off by default): on, the piece folds itself again after
  it is used: a tab picked, a tool used, a page opened from the nav, a menu command run.

Both are fields of each piece's settings dialog (right-click → `<Type> settings…` → Behaviour, level Simple), and the
right-click menu has **Collapse / Expand** and **Auto-collapse ✓** entries.

## API (all four the same: console REST, MCP `console_action`, CLI, voice through AmberX)
- Fold: action `chrome.fold:<type>:<instance>:<fold|unfold|toggle>` (also `collapse` / `expand`).
  Types `tab-group | toolbar | nav-menu | app-menu`; instance = the tab group id, the toolbar's settings id, else `app`.
- Settings: `chrome.set:<type>:<instance>:collapsible:on|off` and `chrome.set:<type>:<instance>:autoCollapse:on|off`.
- Deep link to its settings: `chrome.settings:<type>:<instance>`.
- State: each piece carries `data-axf-folded="on|off"`; the fold and the fields are device settings
  (`axf.chrome.<type>.<instance>`, the fold keys above); runtime `rt.chromeFold(type, instance)` returns
  `{ collapsible, autoCollapse, folded }`.

## Engine / contract
`core/engines/chrome-settings-rules.mjs`: `CHROME_FOLD_TYPES`, `CHROME_FOLD_KEY`, `CHROME_FOLD_LABELS`, `CHROME_FOLD_USE`,
`CHROME_FOLD_EVENTS`, `chromeFoldSettings`, `chromeFolded`, `chromeFoldNext`; new `collapsible` / `autoCollapse` fields
in `CHROME_FIELDS`. `TAB_GROUP_DEFAULT.collapsible` is now true and gained `autoCollapse`; the toolbar attribute
`data-fx-toolbar-collapsible` is `on` unless the asset says false. asset-types.json documents the fields on all four
types. Fixtures regenerated (`chrome-settings.json` → `fold`, `components.json`). Kotlin twin recorded as deferred in
`framework/spec/PORTING.md`.

Note on model: this touched a contract file (chrome-settings@1 rules + asset-types fields). The change is additive
(two optional fields, one helper block), so it ran on Opus as pinned rather than stopping to raise the step to Fable.

## Tests
- `check-chrome-settings.mts` ✓ 316 checks (new fold block), `check-tab-group.mts` ✓ 446, `check-navstyle.mts` ✓ 98.
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` ✓.
- console-web `tsc --noEmit` ✓ (with the re-synced baked framework copy).
- Full spec sweep: 56/62 pass. The 6 that fail here fail without this change: 4 need `jsdom` / `react` not installed in
  this worktree (approval-expand, approvals-menu, help-mode, windows), `check-help` fails on
  `apps/console-web/plugins/agent-slots/help.json` (an entry kind), `check-headless-tabs` on its memory meter case.

## Baked copies
Changed framework files were copied into `apps/{console-web,molly,axhub-web,amberx-droid}/src/axf` where the app copy
matched the framework; `types.ts` and `asset-types.json` (already diverged there) got the same hunks applied.
`apps/demo` and `apps/walkthrough-studio` are older bakes (rebake status: stale) and were left for `rebake.mjs`.

## Gaps
- 25 hand-rolled chrome pieces in 18 files are still on the check-chrome-assets baseline (not the framework TabGroup);
  their toolbars get the fold from the installer, their hand-rolled tab rows do not until they move to TabGroup.
- Screenshots for UI Review were not taken in this headless session (no running console to capture); the PR says so.
- Android (Compose) twin deferred, as recorded in PORTING.md.
