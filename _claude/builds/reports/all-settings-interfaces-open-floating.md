# all-settings-interfaces-open-floating (Opus, phase 1)

## What Brett said (verbatim, Nov 13 2026)

> I want by default all settings interfaces, whether they're built already or not built, to default to open in a dialogue

Branch `claude/all-settings-interfaces-open-floating`.

## What changed

| Piece | Where |
|---|---|
| Engine: where an opening lands. Dialog by default (whole interface → `axf.settings.all`, one tab → `axf.settings.tab`); per-user `axf.settings.opensAs` = page keeps the page; `settings.page` forces it; the host taking settings (embed@1) and the Settings page already open keep the page; a plugin's own Opens in = Dialog still wins for its tab. `isSettingsDialog` / `dialogSurface`: every settings dialog gets the glass surface. Spoken words parse ("as a page", "in a dialog", "floating") | `framework/core/engines/settingsopen.ts` |
| `app.settings` and `settings.open[:tab]` route through the engine; new actions `settings.page[:tab]` (the dialog's **Open as page** button) and `settings.opensas[:dialog/page/words]`; setting **Appearance → Display → Settings open in** (user scope) | `framework/libs/settings/index.tsx` |
| Dialog host: `surface: 'glass'` (`--fx-opacity-glass`, `--fx-blur`) and `size: 'wide'`; any dialog that is a settings interface (chrome, banner, window, plugin settings, any added later) gets glass without asking | `framework/react/components/Overlays.tsx`, `framework/ui/axf.css` |
| console-control@1: `view:settings` opens through `app.settings`, so REST, MCP, CLI and voice land in the dialog like a click; the state names the open dialog (`state.dialog`) | `framework/react/controlTargets.ts` |
| Plugin "Opens in" wording updated (settings follow Settings open in; Dialog still forces the dialog) | `framework/react/library.ts` |
| Apps' baked framework copies patched (console, axHub web, Molly, AmberX web) | `apps/*/src/axf` |
| Templates say: open settings with `settings.open:<tab>` / `app.settings`, never `navigate('settings')` | `framework/templates/{react-ts,next-ts}/README.md` |
| Help entries (`app.settings`, `settings.open`, `settings.page`, `settings.opensas`), status `cx.settings.opendialog`, Kotlin twin as a deferred gap | `framework/assets/help/framework.json`, `framework/catalog/status.json`, `framework/spec/PORTING.md` |

Already built: no plugin ships its own settings page (every plugin's settings are a Settings tab), and chrome, banner,
window and plugin settings were dialogs already; they now share the glass surface. Not built yet: a new settings tab
opens in the dialog because every opener goes through `settings.open`; a new settings dialog is glass by its id/title;
the CI check fails code that navigates to the Settings page or registers a settings page of its own.

## How each piece is reached without the UI

| What | REST / MCP / CLI / voice (console actions, console-control@1) |
|---|---|
| Open Settings (dialog) | `console_open "settings"` / `view:settings` open / action `app.settings` |
| Open a tab (dialog) | `settings.open:<tab>` / `view:settings/tab:settings.tabs=<tab>` open |
| Open as page | `settings.page[:<tab>]` |
| Read / change the option | `setting:axf.settings.opensAs` get / set, `settings.set:axf.settings.opensAs:page`, `settings.opensas:as a page` |
| What is open | console-control `state` → `dialog: axf.settings.all / axf.settings.tab`, `screen` |

## Tests

| Check | Result |
|---|---|
| `npx -y tsx framework/spec/check-settings-open.mts` (new, in CI) | 52 checks (engine, library wiring, dialog host, glass tokens, console-control, source guard; negative probe caught both bad patterns) |
| `apps/console-web/scripts/settings-open.e2e.mjs` (new, Playwright on vite preview) | 13 checks, desktop + phone |
| `apps/console-web/scripts/window-handles-check.mts` | 40 (updated: main pick → dialog; page pick → page; Dialog pick wins; Open as page) |
| `console-control.e2e.mjs` | assertion updated to the dialog (not run here) |
| check-theme, check-controls, check-toolbars, check-chrome-assets, check-embed (429), check-console-commands (101), check-settings-ui (55), check-toolbars spec (608) | green |
| tsc: console-web, axhub-web, amberx-droid | clean (Molly has no node_modules in this worktree) |
| `axf.mjs validate --framework` (light PR check) | green after s3: help ids are lower-case only, so the action is `settings.opensas` (the setting key stays `axf.settings.opensAs`) |

## Open

- UI Review: desktop + phone shots of the whole-interface dialog and a tab dialog submitted (see the PR).
- Kotlin twin deferred (PORTING.md). Expenses (vendored core) not changed.

## s4 (Nov 16 2026): the choice is gone

Brett, Nov 16: remove the setting that picks where settings screens open (page / pane / floating), everywhere. Every
settings interface always opens as a floating popup.

| Removed | Where |
|---|---|
| Per-user **Settings open in** (`axf.settings.opensAs`, Appearance → Display) and its engine exports (`SETTINGS_OPENS_AS*`, `parseSettingsOpensAs`, `normalizeSettingsOpensAs`, `settingsOpensAsOptions`) | `framework/core/engines/settingsopen.ts`, `framework/libs/settings/index.tsx` |
| Actions `settings.opensas` (voice / CLI / MCP / REST) and `settings.page`, the dialogs' **Open as page** button | settings library, help packs, control inventory |
| A plugin's **Opens in** pulling its settings onto the page (it now moves only the plugin's own UI; the wording says its settings always open in a dialog) | `framework/react/library.ts` |
| Baked copies (console, axHub web, AmberX, Molly), help (framework + walkthrough-studio packs), status `cx.settings.opendialog`, PORTING | |

The page / pane placement build (`settings-placement@1`, `settingsPlacement`, `opensIn`) never landed, so no app,
plugin or asset carries it; nothing else to remove.

Migration: saved `axf.settings.opensAs` values are cleared on load (`RETIRED_SETTINGS_OPEN_KEYS`). Old links still work:
`view:settings` and `settings.open:<tab>` open the popup; only an embedding host that takes settings (embed@1) or the
Settings view already being up keep it in place.

No-comeback CI: `framework/spec/check-settings-open.mts` now scans code, schemas, assets, help, CLI, server and docs
(`.ts/.tsx/.mjs/.mts/.json/.py/.md/.kt/.java`) and the console-control inventory, and fails on the retired key or
actions, a `settingsPlacement` / `opensIn` field, a "Settings open(s) in" / "Open as page" / "Pops up in" option or
help entry, or the pop-out button. Negative probe (a plugin with all of them) failed 5 ways as expected.

| Check | Result |
|---|---|
| check-settings-open | 42 |
| window-handles-check | 38 (every plugin Opens in pick still opens its settings in the dialog; actions gone) |
| settings-open.e2e | updated (no Open as page, retired setting gone, still a popup); not run here |
| check-embed 429, check-theme, check-controls, check-console-control, inventory --check, validate --framework | green |
| tsc console-web | clean (axHub web / AmberX show errors in untouched files: Overlays, HubSkinLock) |
