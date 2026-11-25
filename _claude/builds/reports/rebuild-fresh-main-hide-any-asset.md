# Rebuild fresh on main: hide any asset (toolbars, tab groups, banners) + see what's hidden

Build `rebuild-fresh-main-hide-any-asset` (Pipeline 2.0, 16 steps, one branch per step, the lander merges them into one PR).
This file is a draft: s1 wrote 'Prior attempts' and 'Help, glossary and status'; s15 finishes it.

## Brett said (verbatim)

> Why can't we hide assets yet? We're supposed to be able to hide toolbars and tab groups and all that and be able to
> see what's hidden. ... You have to rebuild it.

## Prior attempts

Four tries, none on main (checked Nov 25 2026: `git grep` for `hidden-assets` / `hiddenAssets` / `page-assets` on main finds
only build-store rows). Only `git log` / `git diff` against main were used; nothing was merged or cherry-picked.

| # | Branch | PR | State on Nov 25 | What it was |
| --- | --- | --- | --- | --- |
| 1 | `claude/assets-menu-hide-any-asset-visible-and-hidden-li` | #573 | closed unmerged Nov 13; branch deleted | first page-assets@1 try |
| 2 | `claude/assets-menu-hide-any-asset-visible` | #583 | closed unmerged Nov 16; branch deleted, commits only at `refs/pull/583/head` | page-assets@1, built and green |
| 3 | `claude/assets-menu-hide-any-asset-hidden-list` | none | on origin, 7 commits ahead, 4,665 behind main; 42 files, +1,673 / -25 | #583 cherry-picked onto main plus Settings lists, View ▸ Assets…, Hide in the chrome settings dialog. Its report exists only on that branch (`_claude/builds/reports/assets-menu-hide-any-asset-hidden-list.md`); there is no `assets-menu-hide-any-asset*` report on main |
| 4 | `claude/rebuild-fresh-main-hide-any-asset` (the first run of this same build, Nov 17) | #824, still open | 21 commits ahead, 245 behind main; 305 files, +30,907 / -847 (mostly re-bakes) | hidden-assets@1: the design this rebuild keeps. Finished all 16 steps, stalled in landing for 4 days, the merge-queue entry was removed; this run starts again from main |

### Attempts 2 and 3: page-assets@1 (not kept)

- Engine `framework/core/engines/page-assets-rules.mjs`: 8 kinds (toolbar, tab-group, nav-menu, app-menu, banner, widget, grid,
  container) in its own hardcoded list, a hidden list of **strings** `"<page>|<type>:<instance>"` (`*` = every page), cap 500.
- Stored as look **settings** (`axf.assets.hidden`, `axf.assets.colour.<type>`) by adding `axf.assets.` to the appearance
  setting prefixes: no schema, no fixture, unknown to `normalizeAppLook`, wiped by Restore to default.
- `framework/react/components/PageAssets.tsx` (406 lines) scanned the DOM and was the only owner of the state, so REST / MCP /
  CLI had to go through a mounted console (`assets.hide | unhide | toggle | unhide-all | open` console actions, `here.assets`).
- Per-page scoping doubled every operation and listed the same toolbar under several pages in the Hidden list.

Why not reopened: the list was not a contract (Brett: everything is an asset with a contract), the state lived in a DOM
scanner instead of the runtime, the ask is per app and not per page, and its kind list duplicated `CHROME_TYPES`.

### Attempt 4: hidden-assets@1 (the design to rebuild)

What its branch holds, step by step (`git log main..origin/claude/rebuild-fresh-main-hide-any-asset`):

| Old step | Commit | Files worth reading (`git show <commit>:<path>`, never merge) |
| --- | --- | --- |
| schema | `e822131a6` | `framework/schemas/asset-types.json` (+12), `framework/schemas/json/app-look.schema.json` |
| engine | `951565482` | `framework/core/engines/hidden-assets.ts`, `hidden-assets-rules.mjs` + `.d.mts`, `core/index.ts` |
| fixture + check | `cbad8ba31` | `framework/spec/fixtures/hidden-assets.json`, `spec/check-hidden-assets.mts`, `gen-fixtures.mts`, PORTING.md row |
| runtime | `d647f4dc2` | `framework/core/runtime.ts` (+125), `framework/react/hubAppLook.ts` (`refresh()`) |
| React | `c812e7b91` | `framework/react/hidden.tsx`, `TabGroup.tsx`, `Chrome.tsx`, `axf.css` (+4) |
| right-click Hide | `fa8149b96` | `framework/react/components/ChromeContext.tsx` (+105), `Overlays.tsx` (toast Undo) |
| Hidden list | `016a2a59b` | `framework/libs/settings/HiddenAssetsPanel.tsx`, `libs/settings/index.tsx` |
| Assets menu | `bde359b34` | menu contribution, console-control targets, `framework/spec/CONSOLE-CONTROL.md` |
| REST | `48f8046eb` | `apps/console-web/server/hidden_assets.py`, `tests/test_hidden_assets.py`, `framework/cli/hidden-assets.mjs` |
| MCP + actions | `50622372e` | `server/mcp_server.py`, `server/console_control.py`, `src/control/executor.ts` |
| CLI + voice | `e1ead30d1` | `framework/cli/axf.mjs`, `core/engines/console-control-voice.mjs` + fixture |
| help + catalog | `d684bfe30` | redone on current main by this step, see below |
| e2e + review | `38f5ca6e8` | `apps/console-web/scripts/hidden-assets.e2e.mjs` (24 checks, desktop + phone) |
| late fixes | `8c70ead3d`, `52fe876ff` | read-only look reads, DOM-shim safe pass; the AmberX Android assertion dropped |

It is 245 commits behind main and touches files main has since changed (`runtime.ts`, `ChromeContext.tsx`, `Overlays.tsx`,
`axf.css`, `gen-fixtures.mts`, every `axf.lock.json`), so each step re-applies its part by hand on current main.

### Decisions for this rebuild

1. **Contract:** hidden-assets@1 is a field of app-look@1: `own.hiddenAssets: [{ kind, id, assetRef?, hiddenAt, by }]`. A
   document without the list reads as nothing hidden. The list rides with the look (pick, Restore, undo, backups).
2. **Per app, not per page.** One entry per piece; each app keeps its own list on axHub.
3. **Kinds are derived**, never listed twice: the chrome-settings@1 kinds that have a region on the page (tab-group, toolbar,
   banner, nav-menu, app-menu) plus `widget`. A context menu has no region and is refused. No app is named in the engine.
4. **The runtime owns the state:** `rt.hidden()`, `rt.hide()`, `rt.unhide()`, `rt.unhideAll()`, saved through the look writer,
   refreshed on focus. React, REST, MCP, CLI and voice are all callers of those four; nothing scans the DOM for state.
5. **Engine rules:** pure; an unknown kind or a bad id returns the same document; hiding twice keeps the first entry; ids match
   `/^[a-z0-9][a-z0-9._:/-]{0,119}$/` and equal the chrome context menu's id (`axf.chrome.<kind>.<id>`); cap 500, oldest dropped.
6. **Names, fixed here so every step and the help agree:**
   - console actions `chrome.hide:<kind>:<id>`, `chrome.unhide:<kind>:<id>`, `chrome.unhideAll`, `chrome.hidden`
   - REST `GET /api/hidden-assets?app=`, `POST /api/hidden-assets/hide | unhide | unhide-all`
   - MCP `hidden_assets_list | hidden_assets_hide | hidden_assets_unhide | hidden_assets_unhide_all`
   - CLI `axf hidden list | hide <kind> <id> | unhide <kind> <id> | unhide-all [--app]`
   - dialog asset `axf.hidden-assets`; Settings → Appearance → **Hidden** (anchor `#hidden`)
   - labels: **Hide ‹kind›**, **Unhide**, **Unhide all**, **Hidden items…**, tab **Hidden**
7. **AmberX:** `apps/amberx-droid` was removed from main (`ba07bfa0b`). The baked web apps on main are the console, axHub web
   and Molly. Steps that name AmberX (s12 voice, s13 re-bake) apply to the apps that exist; the Android twin stays a
   PORTING.md row.

### Reused (by hand)

- From attempt 4: everything in the table above, as the reference implementation for each step.
- From attempt 3: the instance id and slug rule, the 500 cap, the Hide button placement in the chrome settings dialog, the
  PORTING.md wording, the e2e script shape.

### Not reused

- `axf.assets.` settings prefix and the string-encoded list; per-page entries; the DOM scanner as owner of the state;
  `MenuItem.swatch` / `current` and the type colour settings (not asked for).
- Attempt 4's re-bake commits (`6fc06ea4d` and the merges): every app's baked copy has moved on main.

### Known gaps carried over from attempt 4 (still to solve or to list again)

- Window tab groups (WindowHost) were hidden by a DOM pass, so the window kept its frame.
- On a phone, Unhide all sat next to the count instead of at the far right.
- The UI Review item was saved in the worktree's local store because the session had no console token.

## Help, glossary and status (s1)

- **Help** (`framework/assets/help/framework.json`, the pack every app ships): new entries `action:chrome.hide` (Hide),
  `action:chrome.unhide` (Unhide), `unhide-all`, `action:chrome.hidden` (Hidden items: the dialog and the list),
  `hidden-items` (the Assets menu entry and its count badge), `hidden` (the Settings → Appearance tab). The existing `unhide`
  entry said "Brings this banner back": it now covers every hidden piece. `menu:assets` got a line on the new entries.
  The brief names `apps/console-web/src/help/`, which does not exist: framework chrome help lives in the framework pack,
  console-only help in `apps/console-web/src/assets/help/console.json`.
- **Copies kept in step** (check-help compares them byte for byte): `apps/{console-web,axhub-web,molly}/src/axf/assets/help/framework.json`
  with the one matching hash line in each `axf.lock.json`, and `apps/walkthrough-studio/src/assets/help/framework.json`
  (`help-coverage --sync`). No other baked file was touched. s13's re-bake rewrites the same lock line: if the lander sees a
  conflict there, take the re-baked file.
- **Fixed in passing:** `help-coverage --check` was red on main (console-web 1758/1759): the new-version notice's
  "Hide this notice" button had no help. Entry added to `console.json`; coverage is back to 100%.
- **Catalog + status:** item `cx.hidden-assets` in `framework/catalog/catalog.json` (a status row needs a catalog item, or the
  tracker never shows it) and its row in `framework/catalog/status.json`, status `built`. The row lands with the whole build
  in one PR; if a surface is cut, s15 sets it to `partial` and trims the notes. `tracker.json` and `framework/plan/plan.json`
  regenerated from the repo files (they were stale on main, so the diff also carries nine older items).
- **Live data:** the hub's live `status.json` (`/projects/amberx-axf/_data`) already has a `cx.hidden-assets: built` row from
  the Nov 17 run. It was left alone; the live tracker was regenerated from main's catalog, so it does not list the feature
  until this build lands.
- **Descriptions for the files other steps own** (the glossary counts items with no description of their own; the ratchet
  has 3 left: 381 of 384). Use these as written:
  - dialog `framework/assets/dialog/axf.hidden-assets.json` (s8) `description`: "The Hidden list: everything hidden in this
    app (tab groups, toolbars, banners, navigation, menu bar, widgets), grouped by kind, with Unhide on each row and Unhide all."
  - Assets menu contribution (s9) `description`: "Hidden items… (with a count), Unhide all, and Hide ▸ for every tab group,
    toolbar, banner, navigation menu, menu bar and widget on screen."
  - `framework/cli/hidden-assets.mjs` (s12) header, first line: "hidden-assets: list, hide and unhide the pieces of an app's
    chrome (tab groups, toolbars, banners, navigation, menu bar, widgets), saved in the app's look on axHub."
- **Checks run:** `tracker.mjs --check` (repo files) green · glossary `catalog.mjs --check` complete, 4,136 entries, 381
  without their own description (ratchet 384) · `check-help.mts` 283 checks · `help-coverage --check` 100 / 100 / 100 ·
  `shared-assets check` green. `framework/cli/catalog.mjs` does not exist; "catalog.mjs --check" is the glossary plugin's.
