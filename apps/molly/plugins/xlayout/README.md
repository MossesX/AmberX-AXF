# xLayout (Molly plugin)

Molly as ONE app (Brett, Nov 2 2026). Asset `xlayout@1` (`apps/molly/src/assets/xlayout/molly.json`) holds the layout
(mode, IDE presets, pane limit, toolbars); this plugin carries it out. Every app mounts natively in Molly
(`src/molly/native.tsx`, molly-one-shell s7/s8/s11): no frames, so the old embed@1 chrome take-over is gone and
`web/host.ts` only runs an app's own items in that app.

- **IDE mode** (`web/workspace.tsx`, dock@1): apps' screens as tabs in draggable, resizable, dockable panes; open in
  the main area, a floating window or a pane; the pane limit holds; the layout picker previews the preset before
  applying. Drag an item from Go to anything onto a pane: an app's screen opens there (a new tab when the pane is a tab
  group, alone otherwise); anything else runs. Each pane can be a tab group (right-click its tabs → Tab group on / off;
  `xlayout.ide.containers`). Actions `xlayout.container.tabs[:on|off][:<pane>]` and `xlayout.drop:<pane>:<ref>` do the
  same without the mouse.
- **Toolbars** (`web/toolbars.tsx`): xLayout's three slots (show / hide, edge, items) plus `declareToolbars` for any
  Molly plugin (three per plugin and screen). Customize opens the Toolbar designer through `axf.toolbar-designer@1`.
- Settings: Settings → Plugins → xLayout. Keys `xlayout.*` (last save wins, per key).

```bash
node apps/molly/plugins/xlayout/install.mjs
node apps/molly/plugins/xlayout/uninstall.mjs --all
AXF_PLUGINS_DIR=apps/molly/plugins node framework/cli/plugin-lifecycle.mjs check xlayout
```
