# ui-registry-shortcuts: every UI item is a registered asset, opened by voice

Build `ui-registry-shortcuts` (Current profile), Nov 6 2026, Fable, branch `claude/ui-registry-shortcuts`, headless worktree.

## What Brett said (verbatim)

> "Let's go with a UI shortcuts plugin. All the UIs need to be in a registry. Every single dialog, pop-up, settings interface, main plugin screen, every UI element has to be an asset. Every single asset in the whole app and all its plugins, from a button to a pop-up to a link to a menu to a menu entry, every thing needs to be an asset. That needs to be visible to the API." "Create a registry so I can open them with my voice."

## The audit (s1): what was already an asset, and the gap

Already there, reused rather than rebuilt:

| Contract | What it covers | Reused for |
|---|---|---|
| asset@1 look types (dialog, popup, button, link, app-menu, context-menu, nav-menu, toolbar, tab-group, banner, settings) | the *look* of each kind | untouched: the registry points at instances, not styles |
| chrome-settings@1 / tab-group@1 (build tab-group-assets) | tab groups, toolbars, banners, navs carry settings ids + right-click Settings… | toolbar / banner ids become registry items |
| console-catalog@1 + console-command@1 (console-commands) | the open console's screens, dialogs, settings tabs, actions; opening them from MCP / REST / CLI | **every open goes through it** (`uiOpenCommand` = a control@1 console command) |
| plugin-commands@1 | every plugin's routes and actions as commands | the plugin's own API/MCP/CLI surface (`ui-shortcuts_say` …) |
| help@1 | stable help ids on controls | element items are found by `data-help` when they carry no `data-axf-ui` |
| ref@1 | mentions in text → targets | id grammar (`<kind>:<key>`) kept compatible |
| voice-command@1 (PR #323, not on main yet) | per-app spoken commands | `uiVoiceCommands()` produces commands in that shape (`GET /voice`), nothing duplicated |

The gap: no static registry per app (only what an open console reported, four kinds, never AmberX / Molly / axHub web
without their UI open); menu entries, nav items, toolbar buttons, page buttons, links, single settings, tabs, widgets
not addressable by one id; no aliases, no fuzzy voice match, no user shortcuts, no CI check that new UI is registered.

## What changed

### ui-registry@1, the contract (s2, Fable)
- `framework/core/engines/ui-registry-rules.mjs` (+ `.d.mts`, typed face `ui-registry.ts` with `uiRegistryFromRuntime`): 20 kinds
  (open list), ids `<kind>:<key>`, one `open` per item (`view | dialog | settings(+anchor) | action | url | element(+click) | menu`),
  normalizer, **one validator** (core/validate.ts and the build engine), `mergeUiItems` (declared › authored › live › scanned,
  aliases unioned), items from console catalogs / search entries / menu + toolbar assets / plugin manifests, `searchUiItems`
  + `resolveUiItem` (open verbs and fillers dropped, kind words pick the kind, aliases, word prefixes, one or two letter slips,
  the destination outranks the entries pointing at it), `uiOpenCommand` (→ control@1 console command; element items run the
  framework action `ui.open:<id>`), `uiOpenPlan`, user shortcuts (`normalizeUiShortcut`, `matchUiShortcut`, `uiSay`),
  `uiVoiceCommands` (voice-command@1 shape), `uiRegistryCoverage`, `uiRegistrySchemaProperties`.
- New asset type **`ui-registry`** (asset-types.json, `schemas/json/ui-registry.schema.json`, types.ts, validate.ts,
  build-engine.mjs, index.ts; roll / appearance fixtures regenerated). Not drawn, no slot, one per app.
- Fixture `framework/spec/fixtures/ui-registry.json` + `framework/spec/check-ui-registry.mjs` (43 checks; `--write`
  regenerates the expected outputs from the inputs). `PORTING.md`: Android twin deferred (`UiRegistryRules.kt`, `ui.open`
  by `testTag`).

### The scanner (s3, Fable)
- `framework/cli/ui-registry.mjs` (`axf ui …`): `scan | generate | check | registry | list | search | get | say | open |
  coverage | voice | apps`. Reads plugin manifests (`provides`), web code (`views`, `dialogs`, `settingsTabs`, `nav`,
  `rt.actions.register`, `openDialog`, every `<Button>/<a>/<Link>` with `data-axf-ui` or `data-help`), `web/menu.ts`
  contributions, the app's active app-menu / context-menu / nav-menu / toolbar assets, and declared `ui-registry.json`
  files (plugin or app). Declared and authored items survive regeneration. Finds the console plugin that serves the
  registry by capability (`service:ui-registry@1`), never by folder.
- Registries written: console **676**, AmberX **118**, axHub web **113**, Molly **50** items
  (`apps/<app>/src/assets/ui-registry/<app>.json`). Four apps re-baked so their validators know the type.
- CI (`android.yml`): `check-ui-registry.mjs` and `ui-registry.mjs check` (new UI that isn't registered fails with the
  `generate` line to run). `plugin-lifecycle.mjs`: the generated registry assets are not stale references, and
  `uninstall --all` regenerates the console's registry.

### The UI shortcuts plugin (s4 server, s5 web; Fable)
`apps/console-web/plugins/ui-shortcuts/`:
- **Server** (`server/__init__.py`, 45 checks in `test.py`): `GET registry | items | item | shortcuts | voice | coverage |
  recent`, `POST open | say | shortcuts | live`, `DELETE shortcuts`; capability **`ui-registry@1`** (`say`, `open`, `items`,
  `shortcuts`, `voice`). Matching runs the one rules file through the CLI (`say --json`), so console, CLI, MCP and Molly
  agree. Opening = console-commands@1 with the **navigate grant alone** for screens, dialogs, settings and element items
  (never a veto); a data-changing action runs under the caller's own grants. Live items the open consoles report
  (`POST /live`) fill in and win over the disk copy for 15 minutes. Shortcuts are settled to an item id when added
  (by words or id), owner only.
- **MCP / REST / CLI** through plugin-commands@1, no extra wiring: `ui-shortcuts_say`, `ui-shortcuts_open`,
  `ui-shortcuts_items`, `ui-shortcuts_item`, `ui-shortcuts_shortcuts` … (Gizmo and every Claude session call these);
  `/api/control/ui-shortcuts/<command>`; `axf ui open "<words>"` (console URL + token) and `axf ui say|search|get|list`.
- **Web** (`web/index.tsx`): the quick-open dialog `ui-shortcuts` (type or **Speak**; kind chips; Enter opens the best
  match, the list shows the rest); the framework action **`ui.open:<item id>`** (view / dialog / settings + anchor /
  action / URL / element: go where it lives, find it by `data-axf-ui` or help id, scroll, flash, click); actions
  `ui-shortcuts.dialog`, `ui-shortcuts.say:<words>`; this console's live registry posted to the server every 5 min;
  Settings → Plugins → **UI shortcuts**: *Your shortcuts* (add by phrase + item words, Try, Remove), *Voice* (mic button,
  spoken answers), *The registry* (items per app, live count, *Report this console*), Install & uninstall.
- `help.json` (20 entries + an intro), `ui-registry.json` (the plugin's own aliases: "quick open", "open anything", …),
  `README.md`, plugin.json commands block, lifecycle files. CLAUDE.md convention line, THREADS.md row.

## Numbers

| Check | Result |
|---|---|
| `node framework/spec/check-ui-registry.mjs` | 43 checks |
| `node framework/cli/ui-registry.mjs check` | console 676, AmberX 118, axHub web 113, Molly 50 items |
| `python3 apps/console-web/plugins/ui-shortcuts/test.py` | 45 checks |
| console `tsc --noEmit`, `vite build` | clean |
| check-theme, check-controls, check-plugin-pages, check-toolbars, check-chrome-assets, help-coverage --check, check-help.mts, check-plugin-commands, menu-reach, check-conform, shared-assets, chrome-settings | green |
| `plugin-lifecycle.mjs check ui-shortcuts`, `plugin-commands.mjs check ui-shortcuts` | clean (9 reads, 6 commands) |

`plugins.mjs --check` fails the same way on main (asset-designer / asset-browser plan items), unrelated.

## Screenshots

UI Review (approve / reject queue), group `ui-registry-shortcuts - Nov 6 6:35 PM`: the quick-open dialog (desktop +
phone, "plan" typed) and Settings → Plugins → UI shortcuts (desktop + phone). Files:
`_claude/builds/reports/ui-registry-shortcuts/shots/`. PR [#369](https://github.com/MossesX/AmberX-AXF/pull/369), in
the merge queue (held until the review is approved).

## Known gaps / follow-ups
- voice-command@1 (PR #323) is not on main: `GET /voice` already answers in its shape; once #323 lands, its generator
  can take these commands in (`ui.open` + every shortcut) with no change here.
- Element items need `data-axf-ui` or a `data-help` id to be found on the page; buttons without either are not
  registered (the scan is the source of truth, so adding the attribute registers them on the next `generate`).
- Molly's and AmberX's web parts don't register the `ui.open` action yet (the console does); their items still open
  through console-commands when the console hosts them, and by `view` / `dialog` / `settings` in their own runtime.
- Android twin deferred (PORTING.md).
