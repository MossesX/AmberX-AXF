# Toolbar designer (Molly plugin)

Its own plugin (Brett, Nov 2 2026). A dialog to pick what each of xLayout's three toolbars holds — Molly's pages and
actions, and every app's navigation, menus and toolbars as merged by xLayout — and where each item opens (main area,
floating window, or a pane while IDE mode is on). Opened from Settings → Plugins → Toolbar designer, View → Toolbar
designer, xLayout's Customize buttons, and right-click on any toolbar → Customize toolbar.

Cross-plugin only through capabilities: it provides `axf.toolbar-designer@1` (`open({ plugin, screen, slot })`) and
uses xLayout's `axf.xlayout@1` (`layout`, `chrome`, `saveSlot`, `run`); either plugin can be removed on its own.

```bash
node apps/molly/plugins/toolbar-designer/install.mjs
node apps/molly/plugins/toolbar-designer/uninstall.mjs --all
AXF_PLUGINS_DIR=apps/molly/plugins node framework/cli/plugin-lifecycle.mjs check toolbar-designer
```
