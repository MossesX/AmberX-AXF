# Rebuild fresh on main: hide any asset (toolbars, tab groups, banners) + see what's hidden

Build `rebuild-fresh-main-hide-any-asset`, phase 1 (Fable), branch `claude/rebuild-fresh-main-hide-any-asset`.

## Brett said (verbatim)

> Why can't we hide assets yet? We're supposed to be able to hide toolbars and tab groups and all that and be able to
> see what's hidden. ... You have to rebuild it.

## Prior attempts

Three tries, none on main. Only `git log` / `git diff` against main were used here; nothing was merged or cherry-picked.

| Attempt | Branch | PR | What happened |
| --- | --- | --- | --- |
| 1 (Nov 13) | `claude/assets-menu-hide-any-asset-visible-and-hidden-li` | #573 | closed unmerged Nov 13; branch deleted |
| 2 (Nov 16) | `claude/assets-menu-hide-any-asset-visible` | #583 | built and green, closed unmerged Nov 16; branch deleted in cleanup |
| 3 (Nov 16) | `claude/assets-menu-hide-any-asset-hidden-list` (still on origin, 7 commits over main, 42 files, +1673/-25) | none | cherry-picked #583's four commits onto main, resolved three conflicts, added Settings → Appearance lists, View ▸ Assets…, Hide in the chrome settings dialog. Never opened as a PR (the session had no console token). |

`claude/banner-show-hide-menu` exists locally with no commits over main: nothing to take.

### What attempt 3 built (`page-assets@1`)

- Engine `framework/core/engines/page-assets-rules.mjs` (pure, 139 lines): 8 kinds (toolbar, tab-group, nav-menu, app-menu, banner, widget, grid, container), labels, icons, type colours as colour token names, a slug rule for unnamed strips, `<type>:<instance>` ids, and a hidden list of **strings** `"<page>|<type>:<instance>"` (`*` = every page), capped at 500.
- Storage: the list and the colours lived in look **settings** (`axf.assets.hidden`, `axf.assets.colour.<type>`) under `own.settings` of app-look@1, made appearance keys by adding `axf.assets.` to `APPEARANCE_SETTING_PREFIXES` in `designpackage.ts`.
- Web host `framework/react/components/PageAssets.tsx` (406 lines): scanned the DOM for chrome targets, hid them with a class, lit the right-clicked one, built **Assets ▸ Hide this ‹kind› / Visible (n) / Hidden (n) / Show all** into every context menu, plus `MenuItem.swatch` / `current` fields in `core/types.ts`.
- Settings → Appearance → Assets (`PageAssetsList`, `PageAssetColours`), a Hide button in `ChromeSettingsPanel`, View ▸ Assets… / Hidden assets… menu entries.
- API: console actions `assets.hide | unhide | toggle | unhide-all | open | highlight | colour`, `console_where → here.assets`, CONTROL.md paragraph, inventory rows, `scripts/page-assets.e2e.mjs` (7 checks), `spec/check-page-assets.mjs` (no fixture).
- PORTING.md row for the deferred Android twin.

### Why it is rebuilt instead of reopened

- The hidden list was an untyped string setting folded into `own.settings`. Nothing in the schema, no fixture, no
  migration path, and `normalizeAppLook` did not know it existed; a Restore to default wiped it along with every other
  look setting. Brett's rule is that everything is an asset with a contract: the list belongs in app-look@1 itself.
- Per-page scoping (`<page>|…`) doubled every operation (hide here / hide everywhere / unhide drops both) and made the
  "what's hidden" view confusing (the same toolbar listed under several pages). The ask is per app: hide a toolbar,
  see it under Hidden, bring it back.
- The 406-line DOM scanner was the only place the hide was applied: nothing in the runtime knew what was hidden, so
  REST / MCP / CLI callers had to go through a mounted console. The runtime must own the state (`rt.hidden`,
  `rt.hide`, `rt.unhide`, `rt.unhideAll`), with the host only drawing it.
- The kind list was its own hardcoded array next to `CHROME_TYPES`; two lists drift.

### Decisions for this rebuild

1. **Schema (s2):** app-look@1 gets `own.hiddenAssets: [{ kind, id, assetRef?, hiddenAt, by }]` (and the same field on
   `default`, `undo`, `backups[].own` through `LookPart`). `kind` = a hideable kind, `id` = the instance id (the same
   slug the chrome context menu gives the piece, `axf.chrome.<kind>.<id>`), `assetRef` = the asset id in force when it
   was hidden (optional, for the Hidden list's label), `hiddenAt` ISO time, `by` = app id or caller. A document with no
   list reads as nothing hidden. Snapshot `framework/schemas/app-look.json` + `schemas/json/app-look.schema.json` from
   `axf schemas`, like skin-config@1.
2. **Kinds (s3):** no list of its own. Hideable kinds = the chrome-settings@1 kinds that have something on the page
   (`CHROME_TYPES` whose `CHROME_TARGETS` is non-empty: tab-group, toolbar, banner, nav-menu, app-menu; a context menu
   has no region) plus `widget` (banner / toolbar widgets, `widgets@1`). No app list anywhere.
3. **Engine (s3):** `framework/core/engines/hidden-assets.ts`, pure: `hide(look, target)`, `unhide(look, target)`,
   `unhideAll(look)`, `isHidden(look, target)`, `listHidden(look)`, `hiddenAssetKinds()`, `normalizeHiddenAssets(raw)`.
   An unknown kind or a bad id is refused (the document comes back unchanged); hiding twice keeps the first entry.
4. **Fixture + check (s4):** `spec/fixtures/hidden-assets.json` from `gen-fixtures.mts`, `spec/check-hidden-assets.mts`
   (hide, unhide, unhide all, unknown kind refused, old document migrates); Kotlin twin as a PORTING.md row.
5. **Runtime (s5):** the list is read from the app's look document (hub store), exposed as `rt.hidden()`, `rt.hide()`,
   `rt.unhide()`, `rt.unhideAll()`, saved through `changeLook` (the look writer, so it survives reloads and reaches the
   hub), refreshed on focus through `useEditorSync` → `refreshFromSaved`.
6. **Not in this phase:** the Assets context-menu entry, the Settings → Appearance Visible / Hidden lists, the Hide
   button in chrome settings, type colours, the console actions and `here.assets`. Later phases of this build add the
   UI and the API on top of the runtime methods.

### Reused from attempt 3 (by hand, not merged)

- The instance id rule (`/^[a-z0-9][a-z0-9._:/-]{0,119}$/`) and the slug rule for unnamed strips, so an id hidden
  through the context menu matches `axf.chrome.<kind>.<id>`.
- The 500-entry cap, oldest dropped first.
- The action names (`assets.hide`, `assets.unhide`, `assets.unhide-all`, `assets.open`) and the e2e script shape, for
  the API phase.
- The Hide button placement in `ChromeSettingsPanel` and the Settings → Appearance Visible / Hidden lists, for the UI
  phase.
- The PORTING.md row wording.

### Not reused

- `axf.assets.` as an appearance settings prefix and the string-encoded list.
- Per-page hidden entries.
- The DOM-scanning host as the owner of the state (it becomes a reader of `rt.hidden()`).
- `MenuItem.swatch` / `current` and the type colour settings (not asked for).

## Clashes checked

Pending list and queue, Nov 17: `every-banner-title-bar-and-toolbar-snappable-ass` and `terminal-toolbar-responsive-overflow-every-item-`
touch toolbars as snappable assets, not hiding; `patches-settings-banner-hide-fable` is the retired Patches app;
`molly-banner-match` hides an embedded app's own banner (embed@1 `forced`, a different mechanism). None overlaps this
build's files. No item merged in.
