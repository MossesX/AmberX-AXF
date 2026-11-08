<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/plugin-manager.md tokens=344 -->
## Kept
- Plugin id `ai.amberx.axf.console.plugin-manager`, folder `plugin-manager`, actions `plugin-manager.open[:<folder>]`, <!-- axf-plugin:plugin-manager -->
  `plugin-manager.window`, `plugin-manager.layout:<id>`, `plugin-manager.view:<id>`, settings keys
  `plugin-manager.layout|view|filter|sort|selected`, settings sub-tab under Plugins, the default context-menu link
  (runtime contribution, never written into an asset), the `plugin-manager.row` context target.
- All five views (Cards, Table, Detail with Overview/Dependencies/UI & settings/Logs/Files/Install, Dependencies graph,
  Install from the plugin catalog) and all four layouts (Studio, Mission control, Terminal with its command line,
  Catalog with hero + shelves); the UI-editor rule (`usePrefs` → `useEditorSync`, per-key saves).
- Server routes `GET /inventory`, `/plugin/{folder}`, `/logs/{folder}` with every guard (folder pattern, level whitelist,
  no symlinks in file lists / sizes, env reported as set/unset only, read-only), console token on every method, 404 when
  disabled, never on the console MCP. Enable/disable and install/uninstall still go through the console's own routes.
- `hooks.mjs` checks (data folder, "menu link not baked into a context-menu asset"), `install.mjs`, `uninstall.mjs`,
  lifecycle block and the three marked doc mentions (CLAUDE.md, plugins README, decisions).
