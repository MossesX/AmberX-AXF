# Rebuild: assets-menu-hide-any-asset-hidden-list (replaces assets-menu-hide-any-asset-visible, PR #583)

The version it replaces was never merged (PR #583 closed Nov 16 2026, branch deleted). Its four code commits were recovered
from `pull/583/head` and cherry-picked onto main, so nothing of it is lost.

- **Removed:** nothing.
- **Kept:** page-assets@1 engine and API (ids `<type>:<instance>`, `axf.assets.hidden`, `axf.assets.colour.*`, actions
  `assets.hide|unhide|toggle|unhide-all|highlight|colour|open|list`), the context menu Assets ▸ Visible / Hidden, the
  right-click highlight, Settings → Appearance colours, the chrome audit fixes, `check-page-assets.mjs`.
- **Changed:** `axf.assets.*` is now an appearance setting (designpackage.ts prefix): it is saved in the app's app-look@1
  document on axHub, per app, instead of only in the local settings. `assets.unhide` takes an optional page.
- **Added:** View ▸ Assets… / Hidden assets…; Settings → Appearance → Assets (Visible + Hidden lists, Show all); Hide in
  each chrome settings dialog; `apps/console-web/scripts/page-assets.e2e.mjs`.
- **Contract / fixture:** no schema, asset type or fixture change. Setting keys are the same, so nothing needs migrating.
  A local hidden list from the old branch (never shipped) would be pushed to the look on the next change.
- **Tests before → after:** check-page-assets (same + prefix assertion); new e2e 7 checks; all chrome / skin / look checks pass.
- **Gaps:** Android twin deferred; other apps need a re-bake for the framework copy.

Report: `_claude/builds/reports/assets-menu-hide-any-asset-hidden-list.md`.
