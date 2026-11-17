# Rebuild: hide any asset + see what's hidden (`rebuild-fresh-main-hide-any-asset`)

Replaces attempt 3, `claude/assets-menu-hide-any-asset-hidden-list` (never a PR; `page-assets@1`), and attempt 2, PR #583 (closed).

## Removed (not carried over)

- `page-assets@1`'s string list (`"<page>|<type>:<id>"`) in look **settings** (`axf.assets.hidden`) and `axf.assets.` as an appearance settings prefix.
- Per-page hiding (`*` = every page) and its double unhide.
- The 406-line DOM scanner `PageAssets.tsx` as the owner of the state; `MenuItem.swatch` / `current`; type colours.
- Kinds `grid` and `container` (not chrome; not asked for).

## Kept (same idea, rebuilt)

- Right-click → Hide on chrome pieces, an Assets menu, a list of what's hidden in Settings → Appearance, Unhide / Unhide all.
- The instance id rule (the one the chrome context menu gives a piece), the 500-entry cap, the PORTING.md row.

## Changed

| Then | Now |
| --- | --- |
| state in an untyped look setting | `own.hiddenAssets` in app-look@1 (schema, fixture, migration: no list = nothing hidden; rides with pick / Restore / undo) |
| hidden by a DOM scanner adding a class | runtime owns it (`rt.hidden / hide / unhide / unhideAll`); components draw nothing; app-wide chrome leaves the layout grid; hand-drawn strips get one DOM pass |
| actions `assets.hide | unhide | toggle | unhide-all | open | highlight | colour` | `chrome.hide | chrome.unhide | chrome.unhideAll | chrome.hidden` (beside the other `chrome.*` actions of the same context block) |
| API only through a mounted console | REST `/api/hidden-assets`, MCP `hidden_assets_*`, `axf hidden`, voice phrases (console + AmberX), all writing the same document |

## Added

- `framework/core/engines/hidden-assets.ts` (+ rules, fixture, `check-hidden-assets.mts`), `framework/react/hidden.tsx`, `framework/libs/settings/HiddenAssetsPanel.tsx`, dialog `axf.hidden-assets`, `Toast.act` (Undo), the `hidden-assets.count` counter, `#anchor` deep links in the console executor, `framework/cli/hidden-assets.mjs`, `server/hidden_assets.py`, `scripts/hidden-assets.e2e.mjs`.

## Contract / API / asset / fixture changes

- app-look@1: optional `own.hiddenAssets` (also on `default`, `undo`, `backups[].own`); `schemas/json/app-look.schema.json` new.
- Fixtures: `hidden-assets.json` new; `console-control-voice.json` gains the hide / unhide / hidden / unhide-all phrases.
- CONSOLE-CONTROL.md: `#anchor` and `view:settings/tab:<tab>`.
- Help: five entries; catalog `cx.hidden-assets`.

## Migration / compatibility

- Apps on an older baked framework ignore `own.hiddenAssets` (unknown field, kept by writers that normalise through the new rules). A re-bake picks everything up; the console, axHub web and AmberX are re-baked in this PR.
- Nothing from attempt 3 was ever on main, so there is no data to migrate.

## Tests before vs after

- Before: none on main (attempt 3 had `check-page-assets.mjs` without a fixture and a 7-check e2e, never merged).
- After: `check-hidden-assets.mts` 94 + 183, `test_hidden_assets.py` 5, MCP pins, voice fixture rows (JS + Python), `hidden-assets.e2e.mjs` 24 on desktop + phone.

## Known gaps

See the build report: UI Review item local only (no console token in the session), window tab groups hidden by the DOM pass, Kotlin twin deferred.
