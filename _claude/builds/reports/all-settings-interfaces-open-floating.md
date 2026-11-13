# all-settings-interfaces-open-floating (Opus, phase 1)

## What Brett said (verbatim, Nov 13 2026)

> I want by default all settings interfaces, whether they're built already or not built, to default to open in a dialogue

Branch `claude/all-settings-interfaces-open-floating`.

## What changed

| Piece | Where |
|---|---|
| Engine: where an opening lands. Dialog by default (whole interface → `axf.settings.all`, one tab → `axf.settings.tab`); per-user `axf.settings.opensAs` = page keeps the page; `settings.page` forces it; the host taking settings (embed@1) and the Settings page already open keep the page; a plugin's own Opens in = Dialog still wins for its tab. `isSettingsDialog` / `dialogSurface`: every settings dialog gets the glass surface. Spoken words parse ("as a page", "in a dialog", "floating") | `framework/core/engines/settingsopen.ts` |
| `app.settings` and `settings.open[:tab]` route through the engine; new actions `settings.page[:tab]` (the dialog's **Open as page** button) and `settings.opensAs[:dialog/page/words]`; setting **Appearance → Display → Settings open in** (user scope) | `framework/libs/settings/index.tsx` |
| Dialog host: `surface: 'glass'` (`--fx-opacity-glass`, `--fx-blur`) and `size: 'wide'`; any dialog that is a settings interface (chrome, banner, window, plugin settings, any added later) gets glass without asking | `framework/react/components/Overlays.tsx`, `framework/ui/axf.css` |
| console-control@1: `view:settings` opens through `app.settings`, so REST, MCP, CLI and voice land in the dialog like a click; the state names the open dialog (`state.dialog`) | `framework/react/controlTargets.ts` |
| Plugin "Opens in" wording updated (settings follow Settings open in; Dialog still forces the dialog) | `framework/react/library.ts` |
| Apps' baked framework copies patched (console, axHub web, Molly, AmberX web) | `apps/*/src/axf` |
| Templates say: open settings with `settings.open:<tab>` / `app.settings`, never `navigate('settings')` | `framework/templates/{react-ts,next-ts}/README.md` |
| Help entries (`app.settings`, `settings.open`, `settings.page`, `settings.opensAs`), status `cx.settings.opendialog`, Kotlin twin as a deferred gap | `framework/assets/help/framework.json`, `framework/catalog/status.json`, `framework/spec/PORTING.md` |

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
| Read / change the option | `setting:axf.settings.opensAs` get / set, `settings.set:axf.settings.opensAs:page`, `settings.opensAs:as a page` |
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

## Open

- UI Review: desktop + phone shots of the whole-interface dialog and a tab dialog submitted (see the PR).
- Kotlin twin deferred (PORTING.md). Expenses (vendored core) not changed.
