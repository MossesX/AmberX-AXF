# One shell (Molly plugin)

Molly as the one shell for every app (build `molly-one-shell`; Brett, Nov 8 2026: "Molly becomes the single shell for
every app and plugin … Do NOT embed other apps").

- **One menu over every app.** Each app's surface (shell-surface@1, `framework/core/engines/shell-surface.ts`) goes into
  one index (menu-index@1, `framework/core/engines/menu-index.ts`): Favorites, Recent, then one group per app → its
  categories → items. Levels never get longer than the setting (default 12); longer ones fold into `A–F` sub menus.
  - **Go** in the application menu: the index as nested sub menus, built when it opens.
  - **Go to anything** (`Ctrl+K`, the Go menu, right-click anywhere): search every app at once, slide through groups,
    star favorites, open in the main area, a pane or a floating window.
- **Where surfaces come from:** native app mounts register through capability `axf.shell@1` (`register(surface,
  opener)`); Molly's own surface is its live search index (every view, action, settings tab, setting, dialog and menu
  item, plugins' too), so a new plugin appears with no menu edit. Until the apps' native mounts land (molly-one-shell
  s7/s8) their items come from the chrome xLayout already receives and open through xLayout; that stopgap goes with
  Molly's frames (s11).
- **Layout modes and named layouts:** one at a time, tabs, side by side or IDE (docked panes), through xLayout's
  capability (`axf.xlayout@1` → `mode` / `setMode` / `snapshot` / `restore`); named layouts keep the mode, the pane
  layout and the dock arrangement.
- **Control:** every part is an action (`shell.go`, `shell.find`, `shell.open`, `shell.favorite`, `shell.mode`,
  `shell.layout.save|switch|remove`, `shell.list`, `shell.surfaces`) and a plugin command (MCP / CLI / voice).
- **Settings:** Settings → Plugins → One shell (Layout, Named layouts, Menus, Favorites and recent, Apps in Molly,
  Install & uninstall).

```bash
node apps/molly/plugins/shell/install.mjs
node apps/molly/plugins/shell/uninstall.mjs --all
```
