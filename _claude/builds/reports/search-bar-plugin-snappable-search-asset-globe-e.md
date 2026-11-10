# Search bar plugin (search-bar-plugin-snappable-search-asset-globe-e)

Built Nov 10 2026 on Opus, branch `claude/search-bar-plugin-snappable-search-asset-globe-e`.

## What Brett asked (Nov 10 2026, 15:33)
"I want to make a plugin that is a search bar. Multiple types of views, you can have multiple of them, an asset. Globe
searches everywhere, the whole program, every plugin, every setting; gear only searches settings. Regular expressions;
unless there's a Llama connection and AI assistant use enabled, it uses its own logic. Letter by letter the possibilities
come up. Drop menu with categories column on the left, tree of matches. Select one, it goes to it. Right click spawns a
sub-menu with the options for that switch, quick select with no confirmation except the little check mark notification.
Embeddable widget that snaps into toolbars and banners. Remove the other search everywhere."

## What was built
New console plugin `apps/console-web/plugins/search-bar` (Settings → Plugins → Search bar).

| Ask | How |
| --- | --- |
| A plugin, an asset, a widget that snaps into toolbars and banners | It draws the framework's `search-bar` widget type (`registerWidgetRenderer`), so it goes anywhere a widget goes: banner sides, toolbar start/end, Arrange mode drag-and-snap, the banner's Widgets picker. Four built-in assets: `globe-bar`, `gear-bar`, `globe-compact`, `globe-icon`. |
| Multiple views, multiple of them | Views `bar`, `compact`, `icon` (asset data `view`). Settings → Search bar → Bars adds any number to the banner or a toolbar, each with its own view and scope; Remove takes one off. |
| Globe = everything, gear = settings only | The button at the start of each bar flips the scope, remembered per bar. Globe searches the whole index: pages, every plugin, every setting (tabs, groups, single settings, panels), actions and menu items, dialogs, windows, assets, plan features, tracker items, pending builds, words on pages. Gear keeps settings only. |
| Regular expressions; own logic unless Llama + AI on | `web/match.mjs`: Words / Word starts / Exact / Regular expression, case-sensitive, match details too, per-category and total caps. Chips in the drop-down footer switch mode in one tap (`.*` = regex, `Aa` = case); bad regex says why. AI ranking runs only when an Ollama profile exists behind `axf.llm@1` **and** "Use AI assistance" is on; otherwise nothing is sent anywhere. |
| Letter by letter | Results recompute on every key. |
| Categories column left, tree of matches | Left: All + Settings, Plugins, Pages, Actions & menus, Windows & dialogs, Looks & assets, Plan & builds, On the page, Other, with counts, ordered by best match. Right: each category as a tree built from where the result lives (Settings › Appearance › Text). |
| Select one, it goes to it | Click / Enter uses the framework focuser (navigate, open the settings tab, scroll and flash the setting). |
| Right-click → sub-menu with the switch's options, no confirm, check mark | Right-click (or →) a result: a menu opens right or left, whichever fits. A toggle shows On / Off, a choice its options, a multi-choice ticks; a settings group lists each of its settings, a settings tab nests its groups as a sub-menu tree. A pick sets the value at once and shows a small ✓ in place. Locked (UAC) settings say so instead. |
| Remove the other search everywhere | The framework's own `LiveSearch` box is no longer drawn anywhere in the console while the plugin is on: the banner's `search-bar/everything`, the toolbar's search slot and the console's "Search everything" dialog (Ctrl+K with no bar on screen) all draw this plugin's bar. Switched off or uninstalled, the framework's plain box comes back (the plugin stays removable). |

## API (all four the same: console actions → REST `/api/control/search-bar/<cmd>`, MCP `search-bar_<cmd>`, CLI `axf search-bar <cmd>`, voice through the action bus)
- `search-bar.open[:<query>]` deep link: focus the main bar, type the query, show the drop-down.
- `search-bar.scope:<everything|settings>[:<bar id>]`, `search-bar.mode:<words|prefix|exact|regex>`,
  `search-bar.option:<caseSensitive|details>=<on|off>`, `search-bar.ai:<on|off>`.
- `search-bar.go:<result id>` (e.g. `setting:axf.display.fontScale`), `search-bar.set:<setting key>=<value>`.
- `search-bar.add:<banner|toolbar>[:<view>[:<scope>]]`, `search-bar.remove:<bar id>`, `search-bar.settings`.
- Reads: `GET /api/plugins/search-bar/state` (every open bar: host, view, scope, query, open, result counts per
  category), `GET /config`, `GET /ai` (capability, ollama, profile, enabled, active). Writes: `PUT /config`.

## Framework changes (generic, no plugin named)
- `WidgetView` and the toolbar redraw when a widget renderer is registered or replaced (`useWidgetRenderers`): before,
  a module loaded after the first paint could not take over a widget already on screen.
- The toolbar's `showSearch` slot draws a replaced `search-bar` renderer instead of its own box.
- `globe` icon.
- Kotlin twins recorded as deferred in `framework/spec/PORTING.md`.

Also fixed on the way: `shipped-features` was missing from `KNOWN_BANNERS` (lazy-loader check failed on main).

## Tests
- `node apps/console-web/plugins/search-bar/test.mjs`: 7 pass (letter-by-letter, scopes, regex/exact/prefix/case/details,
  category tree, quick options + value parsing, sub-menu side, AI gate).
- `python3 apps/console-web/plugins/search-bar/test.py`: 16 checks (config validation, AI gate needs Ollama + switch,
  ranking ids filtered, state report).
- `tsc --noEmit` clean; check-theme, check-controls, check-toolbars, check-chrome-assets, check-widgets, check-toolbars.mts,
  lazy-loader-check, plugin-commands (6 reads, 13 commands) pass.
- Pre-existing, not from this build: `menu-reach.mts` (4 unknown pages: shipped-features, glossary-index, demo-designer,
  book-builder) and `help-coverage` (claude-accounts help.json entry kind).

## Screenshots
Desktop + phone, captured headless with `AXF_APPEARANCE_HUB=off`: globe search "dark", gear search with the quick menu
(nested sub-menu opening left), regex search across categories. In UI Review (group below).

## Gaps
- AI ranking was tested against a fake `axf.llm@1`; no Ollama runs on the VPS to try it live.
- The plugin loads a few seconds after first paint on a cold dev server; the old box shows until then (the swap is in place).
