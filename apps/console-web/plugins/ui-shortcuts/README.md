# UI shortcuts

Open anything in the UI by name or by voice. Brett, Nov 6 2026: *"All the UIs need to be in a registry. Every single
dialog, pop-up, settings interface, main plugin screen, every UI element has to be an asset … from a button to a pop-up
to a link to a menu to a menu entry … That needs to be visible to the API. Create a registry so I can open them with my
voice."*

## What it is

- **The registry** is the framework contract **ui-registry@1** (`framework/core/engines/ui-registry-rules.mjs`, spec in
  `framework/spec/PORTING.md`): one asset per app, `apps/<app>/src/assets/ui-registry/<app>.json`, listing every screen,
  dialog, pop-up, settings interface and setting, menu and menu entry, navigation item, toolbar and button, link, tab,
  banner, widget, action, window and card of the app and its plugins. Each item: a stable id `<kind>:<key>`, a label,
  aliases, the app and owner (`app`, `framework`, `plugin:<folder>`, `library:<id>`) and exactly one way to open it.
- **The scanner** `node framework/cli/ui-registry.mjs` (also `axf ui …`) fills it from plugin manifests, web code, menu
  contributions, the active menu and toolbar assets, and each plugin's `ui-registry.json`. `generate` writes the asset,
  `check` fails CI when new UI isn't registered; items with `source: declared` or `authored` (aliases a person added)
  survive regeneration.
- **This plugin** finds the item for what you typed or said and opens it.

## Using it

| Where | How |
|---|---|
| Console | Plugins ▸ **UI shortcuts…** (or action `ui-shortcuts.dialog`): type or tap **Speak**. Enter opens the best match; the list shows the rest. |
| Any menu, toolbar, hook | action **`ui.open:<item id>`** (navigate), e.g. `ui.open:screen:plan-studio`, `ui.open:button:plan-studio/new-plan`. |
| Voice (Gizmo, Molly, Amber) | MCP tool `ui-shortcuts_say` with `{text}`; the answer carries `say` ("Opening Plan Studio."). `GET /voice` gives the voice-command@1 commands (`open {item}` + every shortcut) for the Voice commands plugin. |
| REST | `POST /api/plugins/ui-shortcuts/say {text, to?, app?, open?}` · `POST …/open {id, to?, arg?}` · `GET …/items?q=&kind=&app=` · `GET …/item?id=` · `GET/POST/DELETE …/shortcuts` · `GET …/registry`, `/coverage`, `/voice`, `/recent`. Also `/api/control/ui-shortcuts/<command>` (plugin-commands@1). |
| CLI | `axf ui say "open the plan studio"` · `axf ui open "ui review settings"` (needs `AXF_CONSOLE_URL` + `AXF_TOKEN`) · `axf ui search plan` · `axf ui list console-web --kind dialog` · `axf ui get screen:plan-studio` · `axf ui coverage`. |
| Settings → Plugins → UI shortcuts | **Your shortcuts** (a phrase → an item, aliases, a spoken answer; matched first), **Voice** (mic button, spoken answers), **The registry** (items per app, live items, *Report this console*). |

Matching order: your shortcut (exact phrase or alias) → the item id → an exact label → an exact alias → the best fuzzy
match (word prefixes, one or two letter slips: "orkestrator" → Build orchestrator). Open verbs and fillers are dropped
("take me to the builds menu" → kind *menu*, name *builds*); a kind word picks the kind. When several items share a
name, the destination wins over the entries that point at it (the screen before its nav item and menu entry).

Opening is a control@1 console command through **console-commands@1**: screens, dialogs, settings tabs and element items
run with the navigate grant alone (never a veto); an action that changes data runs under the caller's own grants. An
element item (a button, link, tab, menu entry, banner, widget, card) is opened by the `ui.open` action in the console:
go where it lives, find it by `data-axf-ui="<id>"` (else its help id), scroll, flash, click when the item says so.

## Registering UI

- Screens, dialogs, settings tabs, nav items and actions a plugin declares in `web/index.tsx` are found by the scanner;
  so are `plugin.json` `provides`, `web/menu.ts` entries and the app's menu / toolbar assets.
- A button or link is registered when it carries **`data-axf-ui="<kind>:<key>"`** or a **`data-help`** id (help@1):
  `button:<plugin>/<help id>`.
- Aliases and anything the scanner can't see go in **`plugins/<folder>/ui-registry.json`** (`{ "items": [ { "id", "label",
  "aliases", "open" } ] }`, see this plugin's own file) or the app's `src/ui-registry.json`.
- Then `node framework/cli/ui-registry.mjs generate <app>`; CI runs `ui-registry.mjs check`.

## Files

`server/__init__.py` (routes, the capability `ui-registry@1`; matching through the CLI so every surface agrees),
`web/index.tsx` (dialog, actions, live report, settings panels), `web/menu.ts`, `help.json`, `ui-registry.json`,
`test.py`. Data (plugin-lifecycle@1): `.axf-console/plugins/ui-shortcuts/` — `shortcuts.json`, `live.json`.
