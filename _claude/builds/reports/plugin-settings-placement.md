# plugin-settings-placement (Current profile; Opus; agent: Reel Rhonda, headless worktree session)

Brett (Nov 3 2026, voice): "Plugins need to open their settings either in them or in a pop-up dialog as well as existing
in the main settings interface. … I click the settings gear in the terminal and it loads the settings in the main page.
That's no good. … it needs one more to open in itself. And whenever it can't open within itself, it will open a pane. A
pane will slide out. You need to be able to configure the animation for each one too." … "if I want terminal settings to
open up in a pane on the left that slides open, I need to select the animation."

Branch `claude/plugin-settings-placement`. Agent: Reel Rhonda (the router isn't on this checkout).

## What changed

**Before:** a plugin's gear / Settings item / `settings.open:<tab>` went to the main Settings page, except when the
plugin's *Opens in* (where its own page opens) was Dialog, which opened the tab in a dialog (PR #278). There was no way
to open settings inside the plugin, no per-plugin choice for settings, and no look or animation.

**After (framework level: every plugin, existing and future, every app on the framework):**

| Piece | Where |
|---|---|
| Contract + engine `settings-placement@1`: placements **inside** (pane L/R/T/B, drop-down, tab, split, inline) / **dialog** / **window** / **main**; fallback; per-placement look | `framework/core/engines/settingsplacement.ts` (exported as `settingsPlacement`) |
| Fallback: inside impossible → slide-out pane (over the plugin when it is open, else over the page); split / drop-down on a phone → pane | `resolveSettingsOpen` |
| Look + animation per placement: slide / fade / scale / drop / push / none, speed (× theme `--fx-motion`), easing, edge, size, position, dim, blur, corners, shadow; all theme tokens; reduced motion → none | `lookStyle` + `framework/ui/axf.css` "Settings placement" |
| `<SettingsHost owner=…>`: a plugin wraps its UI; settings render inside it in the picked mode | `framework/react/settingsHost.tsx` |
| Page-level dialog + fallback pane (slot `app.frame.cover`, above floating windows, under dialogs) | `SettingsPageSurfaces` |
| Picker: placement, mode, look, live replaying preview, Try it, Reset look | `SettingsPlacementPicker` |
| Picker everywhere: top row of every plugin's own settings tab ("Open my settings in…"), right-click inside any plugin → **Settings placement…** (+ "<Plugin> settings"), the gear on every surface, **Settings → Plugins → Settings placement** (every plugin + default for new plugins) | `framework/libs/settings/index.tsx` |
| `settings.open:<tab>` routes by the owner's pick; `settings.open-main:<tab>` forces the page; `settings.placement:<owner>` opens the picker; floating window tab kind `axf-settings-tab` | libs/settings |
| plugin@1 `settingsHost` (true / mode list) + `settingsPlacement` (declared default) | `framework/schemas/plugin.schema.json`, `react/library.ts`, console `App.tsx` / `plugins.ts` |
| Pick order: own → app default (if set) → plugin's declared default → legacy (Opens in = Dialog → dialog) → main | `effectivePick` |
| **Terminal (first proof):** gear opens Terminal settings **inside the Terminal window as a left slide-out pane** by default; all five inside modes work | `console-terminal/web/TerminalHost.tsx`, `plugin.json` |
| Commands once → REST + MCP + CLI: new plugin `settings-placement` keeps picks on the console server (`list`, `get`, `set`, `set-default`, `choices`), the web part syncs (pull on load / focus / every minute, push on change; server copy wins on load) | `apps/console-web/plugins/settings-placement/` |

Main Settings: unchanged; every plugin's settings still live there (the settings page itself never redirects).

## Tests

| Check | Before | After |
|---|---|---|
| `npx -y tsx framework/spec/check-settings-placement.mts` (new, CI): fixture replay (45 resolve cases, normalize, effective, host modes, looks, describe), every console plugin with settings opens as pane + dialog + main with its host open and closed, declared hosts render `<SettingsHost>`, look values are tokens only | n/a | 1504 checks, 54 plugins |
| `python3 apps/console-web/plugins/settings-placement/test.py` (new, CI glob) | n/a | 12 checks |
| `plugin-commands.mjs check` settings-placement / console-terminal | n/a / 13+10 | 5 reads + 3 commands / 13+10 |
| `plugin-lifecycle.mjs check settings-placement` | n/a | clean |
| `check-theme.mjs`, `check-controls.mjs` | pass | pass (940 files) |
| `help-coverage.mjs --check` | 100% | 100% (18 new framework entries) |
| `menu-reach.mts` | ok | ok (346 checks) |
| `build-defaults.mjs`, console `tsc --noEmit` | pass | pass |
| Live console (headless Chromium): Terminal gear → left pane, split, drop-down, tab, dialog; phone pane; context menu; global page | gear → main page | see shots |

## Screenshots

`_claude/builds/reports/plugin-settings-placement/shots/` (desktop 1366×860, phone 412×915).

## Gaps / notes

- Kotlin twin deferred (Android on hold): recorded in `framework/spec/PORTING.md`.
- Look presets are values in the pick (theme tokens), not a new asset type; a `settings-placement` asset type with shared
  presets would let the look travel through axHub's appearance doc. Worth a Fable pass on the contract (the policy wants
  a Fable review of Opus-built foundation work).
- Exit animations: panels animate in; closing is instant.
- Only Terminal hosts settings inside itself so far; every other plugin's "inside" slides a pane over the page until it
  wraps its UI in `<SettingsHost>` (one line + `"settingsHost": true`).
- `TerminalHost.tsx` is also being changed by the running `terminal-sessions-nav` build; this build's change there is
  two lines (wrap the body), so a merge is trivial.
