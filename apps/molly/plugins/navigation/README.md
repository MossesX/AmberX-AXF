# Navigation (Molly plugin)

Brett, Nov 3 2026: "I want Molly to have the console's navigation menu slide open, like when you click console, have a
sub menu slide open, show its menu, and same thing for AXHub and AmberX … give the navigation menu its own settings
interface to control everything."

- **Sub menus:** Molly's nav-menu asset opts in (`navStyle: true`), so the framework nav (`NavTree`) draws items with
  children as sub menus that slide open. xLayout hangs each app's live navigation (chrome@1, sent by the app itself)
  under that app's entry; an app's labelled sections become nested groups. Tap a page = it opens inside the app's frame.
  On a phone the bottom strip opens a sheet that slides up (swipe up / down).
- **Look and behaviour:** the nav-style@1 asset in force (`framework/assets/nav-style`: standard, glide, accordion,
  soft-fade, push, still) with the changes made in the settings on top. A change is a control@1 token override
  (`tokens.nav`, key `axf.tokens.nav`), so it rides the axHub look and REST / MCP / CLI read and set the same values:
  `axf token nav set animation.kind push`.
- **Settings:** Settings → Plugins → Navigation (a panel per group: presets + live preview, colours, font, icons,
  density, width, animation, behaviour, items), right-click the navigation → Navigation settings, View → Navigation
  settings. Reset puts the preset back.
- Commands (plugin.json `commands`): `navigation.get`, `navigation.set`, `navigation.reset`, `navigation.preset`,
  `navigation.open`, `navigation.settings`, `navigation.collapse`.

```bash
node apps/molly/plugins/navigation/install.mjs
node apps/molly/plugins/navigation/uninstall.mjs --all
AXF_PLUGINS_DIR=apps/molly/plugins node framework/cli/plugin-lifecycle.mjs check navigation
```
