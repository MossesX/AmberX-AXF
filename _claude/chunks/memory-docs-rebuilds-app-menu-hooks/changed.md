<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/app-menu-hooks.md tokens=372 -->
## Changed

- `framework/core/types.ts`: `MenuItem` gained optional `provider`, `badge`, `checked`, `order`, `before`, `after`;
  `AppMenuData.menus[].order`.
- `framework/schemas/asset-types.json`: new top-level `menuItems` block (optional fields, `checkedKinds`
  `setting|counter|slot|hidden`, `maxDepth` 4, `providerMax` 12, `defaultOrder` 100) — the single source for the
  engine and the validators; `app-menu.optional_fields` lists them. JSON schemas regenerated: `app-menu` and
  `context-menu` schemas now carry a recursive `$defs.menuItem`.
- Validators (`core/validate.ts` = `cli/build-engine.mjs`): menu items in `app-menu` menus and `context-menu`
  targets are checked (non-empty strings, a parsable `checked` binding, numeric `order`, no `provider` + `items`
  together, depth ≤ 4, lists of objects). The Kotlin `AssetValidator` is spec-driven and ignores the new fields, so
  Android validation keeps passing (verified: every app validates).
- `MenuBar` now draws `rt.appMenu()` (asset + contributions, gated) through the new `AppMenuDropdown`.
- `slot.hide:<type>:on|off` also takes `toggle` (the chrome toggles use it).
- Search: `SEARCH_KIND_LABELS.menu = 'Menu'`; new built-in provider `axf.app-menu`.
- `InstalledLibrary.ui.appMenuItems` (count) for the Plugin Manager.
- Icons: `more`, `hammer` added to the React icon set.
- Console: a disabled plugin's app-menu items are removed with its nav / context / settings / attachments
  (`apps/console-web/src/App.tsx`).
