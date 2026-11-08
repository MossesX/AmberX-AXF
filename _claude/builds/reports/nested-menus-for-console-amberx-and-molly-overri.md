# Nested menus for console, AmberX and Molly (nested-menus-for-console-amberx-and-molly-overri)

Built Nov 8 2026 on Fable, branch `claude/nested-menus-for-console-amberx-and-molly-overri`, phase 1 (s1).

Brett: "You can optimize navigation and application menu for console with subcategories. That's just way too long…
generate new menus for AmberX, for Molly, for console, and actually generate new nested menus the same exact way and
override the shared."

## What changed
- **One generator, nested-menu@1** (`framework/core/engines/menugen.mjs`, pure, fixture `framework/spec/fixtures/nested-menu.json`,
  check `framework/spec/check-nested-menu.mjs`, 87 checks). Input: an app's UI registry (every page, dialog, settings tab,
  menu action, live list, the plugin that brought it). Output: categories → sub categories → items with at most 12 rows on
  any level (setting, 4–30), Favourites and Recent on top, a flat index for search / jump-to, and both assets: the
  `app-menu` (menu bar: Start + one menu per category) and the `nav-menu` (nav-style@1 sub menus that slide open; one
  row per category closed). Twelve categories: Start, Work, Builds, AI & agents, Plugins, Framework, Look & layout, Apps,
  System, Account, Help, More. An entry's words pick its category; a plugin may declare its own (`menu: { category,
  subcategory, keywords }` in plugin.json / `AxfWebLibrary.menu`). Over the cap: settings tabs fold into one Settings
  sub menu, a plugin with 3+ entries becomes its own sub menu, kinds group when that alone fits, then alphabetical
  sub menus (A–F, G–M…), then More…; never deeper than the app-menu engine allows.
- **Runtime library** (`framework/react/generatedMenus.tsx`): reads the live registry (search index + the shared
  app-menu merged with every library's contributions + the shared nav and library sections), registers
  `<app>-generated` assets, and while the override setting is on (default) swaps them in place of the shared menus;
  regenerates (debounced) whenever the registry or a menu setting changes, so a newly installed plugin appears by
  itself. Recents follow pages shown and dialogs opened. Jump to… dialog (Ctrl+Shift+K, favourites and recents first).
  Context items: pin / unpin on a nav item, menu settings and regenerate on the menu bar. Settings → Plugins → Menus:
  General, Categories, Favourites, Recent, Preview, each a collapsible section.
- **Three apps, the same exact way:** console plugin `apps/console-web/plugins/nested-menus` (loads at start),
  Molly plugin `apps/molly/plugins/nested-menus` (adds its framed apps as Apps entries), AmberX plugin
  `apps/amberx-droid/src/plugins/nested-menus`. Each is a thin wrapper over the library under its own id.
- **Control everywhere:** actions `menus.jump`, `menus.open`, `menus.favorite`, `menus.override`, `menus.set`,
  `menus.get`, `menus.outline`, `menus.generate`, `menus.recents.clear`, `menus.favorites.clear`, `menus.settings`, declared
  as plugin-commands@1 items → REST `/api/control/nested-menus/<cmd>`, MCP `nested-menus_<cmd>`, CLI `axf nested-menus <cmd>`;
  voice reads the same actions bus (AmberX voice plugin). Every setting is a field of `menus.set`.
- **New asset field `contributions: false`** on `app-menu` and `nav-menu` data (the context-menu asset already had it):
  the runtime then merges no library contributions into that menu and the nav appends no library sections. The
  generated assets set it, because they already hold every contribution; without it the first screenshots showed a
  16-menu bar (the generated menus plus every contributed menu) and duplicate rows.
- **Offline twin:** `node framework/cli/menu-gen.mjs <appDir> [--outline|--nav] [--style list|rail|pills] [--out dir]`
  generates the same menus from the files (manifests' `provides` + the shared assets). Used for the UI Review options,
  the tests and this report.

## What the console looks like now (from its files)
206 entries → 12 categories, 17 sub menus, widest level 12, deepest 3, nothing left out. Before: a 7-menu bar with
up to 17 rows per menu and ~70 live-list rows behind "More…"; a nav with 16 flat rows.

| Menu | Rows | Inside |
| --- | --- | --- |
| Start | 9 | Favourites ▸, Recent ▸, Jump to…, Home, Settings, Alerts, Reload, Save, Search |
| Builds | 12 | Build queue, Pending builds, Plan, Tracker, 5 actions/lists, B–F ▸, F–W ▸, Settings ▸ |
| AI & agents | 4 | A–C ▸, C–T ▸, Glossary ▸, Settings ▸ (51 entries) |
| Plugins / Framework / Look & layout / System | ≤ 12 | own pages flat, plugins in sub menus |

Molly: 18 entries → Start, Look & layout, Apps (AmberX, axHub, Console, Expenses), Account. AmberX: 45 entries → 8 categories.

## UI Review
Three navigation options (nav-menu assets in `apps/console-web/plugins/nested-menus/assets/nav-menu/`): **list**
(sub menus slide open, the default), **rail** (icon rail, categories open as sub menus), **pills**. Desktop + phone
shots of the Builds menu, the Start menu, Jump to…, the Menus settings and each nav option. Waiting in UI Review.

## Tests and checks
`check-nested-menu.mjs` 87 · plugin `test.mjs` 45 · check-theme, check-controls, check-toolbars, check-chrome-assets,
check-plugin-commands, plugin-lifecycle check (console + Molly), console `tsc --noEmit` green. `menu-reach.mts` reports
4 unknown pages (shipped-features, glossary-index, demo-designer, book-builder) with or without this plugin: pre-existing,
not from this build.

## Gaps
- menu-index@1 from molly-one-shell has not landed; nested-menu@1 is its own contract (the index here is `tree.index`).
- Kotlin twin deferred (spec/PORTING.md).
- The static CLI reads plugin manifests, not `web/menu.ts` (Node 20 has no TypeScript loader); the running app reads
  everything, so the live menus hold more than the CLI's.
