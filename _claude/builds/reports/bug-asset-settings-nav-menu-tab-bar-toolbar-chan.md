# bug-asset-settings-nav-menu-tab-bar-toolbar-chan (P0; Phase 1 Fable, Phase 2 Opus) — PR #503

Brett (Nov 10 2026): "When I click on a navigation menu settings and change it, it changes the settings interface, not
the navigation menu itself. Reset to default only resets that asset, the settings panel. When you right click an asset
like a nav menu, tab bar or toolbar, the settings need to apply to the app, not the settings panel."

## Cause
Right-click → Settings… wrote per-instance overrides (`axf.chrome.<type>.app`) that only `TabGroup` read. The live nav
menu, toolbar, banner, menu bar and context menu drew the raw asset, so a change did nothing on screen. The only part of
the dialog that visibly changed anything was its Interface tab, which restyles the panel itself, and the only "Reset …
to default" in there reset the panel's custom interface.

## Fix
Phase 1 (Fable, commit 72b3d7dd2, chrome-settings@1 `framework/core/engines/chrome-settings-rules.mjs`):
- The piece draws what the dialog sets: `chromeLiveData` = asset + the instance's overrides; runtime `chromeData` /
  `chromeDataOrNull` and React `useChromeData` feed `compileStyles`, `banner()`, `toolbarCollapsed`, `navStyleData`,
  `Toolbar`, `NavMenu`, `NavTree`, `ContextMenuHost`.
- Reset to default resets the piece (`chromeResetPlan`): its overrides and own asset pick; single-instance kinds also go
  back to the app's default asset and drop their layout move. The panel's keys (`CHROME_PANEL_KEYS`) are never touched.
- The right-click dialog no longer shows the panel-scoped Interface tab; picking which settings interface draws a
  kind's dialog moved to Settings → Appearance → Chrome settings interfaces (`axf.chrome.interfaces`).

Phase 2 (Opus, commit d9a02a84f):
- `framework/spec/check-chrome-settings-live.mts` (new, in CI): Brett's flow through a real `AxfRuntime` for every field of
  the nav menu, toolbar, banner, menu bar and context menu: the change reaches the live piece (and the compiled styles for
  styled fields), the asset and the panel's keys stay untouched, reset puts the piece back and leaves the panel alone. A
  tab row's change stays on that row. 210 checks.
- That check found a real bug: `Settings.clear(key)` replaced the in-memory values with what storage held, so in a session
  without storage (blocked localStorage) Reset to default on the nav menu also wiped every other session setting,
  including the settings panel's interface pick. `clear` now merges like `set` already did
  (`framework/core/settings.ts`, mirrored to `apps/console-web/src/axf/core/settings.ts`).

## API
Same through console REST (`console_action`), MCP console actions, the CLI and voice:
- Open: `chrome.settings:<type>:<instance>` (`instance` = `app` for single-instance kinds, the row id for a tab group).
- State: settings `axf.chrome.<type>.<instance>` (overrides), `axf.chrome.<type>.<instance>.asset`, the slot's active asset.
- Change: `chrome.set:<type>:<instance>:<field>:<value>`, `chrome.swap:…`, `chrome.move:…`.
- Reset to default: `chrome.reset:<type>:<instance>`.
- Settings interfaces: `chrome.interfaces[:<type>]`, `chrome.interface:<type>:<default|custom|<id>|reset>`.

## Checks
- `npx -y tsx framework/spec/check-chrome-settings.mts` — 369 checks pass.
- `npx -y tsx framework/spec/check-chrome-settings-live.mts` — 210 checks pass.
- `node framework/cli/check-theme.mjs`, `check-controls.mjs`, `check-toolbars.mjs`, `check-chrome-assets.mjs` pass;
  `tsc --noEmit` in apps/console-web clean.
- Full `framework/spec/check-*.mts` sweep: everything passes except five specs that fail here for environment reasons
  (no `jsdom` / `react` installed in this worktree, `check-headless-tabs` meter case); each fails the same without
  this phase's change.

## Cross-port
Android twin deferred (Android on hold), recorded in `framework/spec/PORTING.md` in Phase 1.

## Waits on
UI Review shots from Phase 1 (nav menu dialog before/after, toolbar dialog, Chrome settings interfaces; desktop + phone),
then the merge queue. Phase 2 changed no UI.
