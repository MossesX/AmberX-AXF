<!-- memory-chunk@1 source=_claude/memory/docs/console-menu.md tokens=198 -->
## Reachability check

`npx -y tsx apps/console-web/scripts/menu-reach.mts` (CI, web tests block) merges and compiles the menu like the
runtime (asset + console + every plugin's `menu.ts`, every plugin on) and fails when a nav entry (console nav asset,
plugin nav sections, library pages), any item of any console toolbar, or any page in `src/App.tsx` isn't reachable,
a `nav:` target is unknown, a live list isn't registered, two modules use one id, a plugin with UI has no entry, the
manifest stops hiding toolbar + nav, or a layout hides the menu bar. Framework stand-ins the console gives no handler
(`file.new/open/export`, `edit.*`, `run.deploy`) count as reached through View › Toolbar items. Last run: 167 checks,
7 menus, 141 static items, 17 live lists, 35 contributions, 28 pages.
