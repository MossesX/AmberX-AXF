# xLayout (Molly plugin)

Molly as ONE app (Brett, Nov 2 2026). Asset `xlayout@1` (`apps/molly/src/assets/xlayout/molly.json`) says which apps
Molly frames and how each kind of chrome is handled; this plugin carries it out.

- **One chrome** (`web/host.ts`, chrome@1 + embed@1): each app's frame opens with the embed@1 marker from `guestUrl`
  (banner, app menu, navigation, context menu and toolbar hidden; those functions taken). The app sends them as data
  (`chrome` messages) and Molly shows one menu bar (a top-level menu per app), one navigation (a section per app; each
  entry is a Molly view `<app>/<item>`), one context menu (a right-click inside an app arrives as a `context`
  message) and the app's toolbars. Picks go back as `run`; the app runs them. Standalone, the apps are unchanged.
- **IDE mode** (`web/workspace.tsx`, dock@1): apps as tabs in draggable, resizable, dockable panes; open in the main
  area, a floating window or a pane; the pane limit holds; the layout picker previews the preset before applying.
- **Toolbars** (`web/toolbars.tsx`): xLayout's three slots (show / hide, edge, items) plus `declareToolbars` for any
  Molly plugin (three per plugin and screen). Customize opens the Toolbar designer through `axf.toolbar-designer@1`.
- Settings: Settings → Plugins → xLayout. Keys `xlayout.*` (last save wins, per key).

```bash
node apps/molly/plugins/xlayout/install.mjs
node apps/molly/plugins/xlayout/uninstall.mjs --all
AXF_PLUGINS_DIR=apps/molly/plugins node framework/cli/plugin-lifecycle.mjs check xlayout
```
