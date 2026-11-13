# per-instance-settings-window-picker

Brett (2026-11-13 17:46): "every tab group and toolbar has its own settings interface, and within it you can select our settings interface"

## What shipped (phase 1, Opus)
- **s1** Every chrome instance (tab group, toolbar, banner, nav menu, menu bar) picks the settings interface its own dialog renders through.
  - Setting `axf.chrome.<type>.<instance>.interface`. Unset = the kind's pick (`axf.chrome.settings.<type>`), else the shared default, so the shared default is preselected.
  - `chromeInstanceSettingsPick` → `{ id, source: instance | type | default }`. A pick whose asset is gone (a skin without it, a removed copy) falls back to the kind's pick, then the default, so the dialog always opens.
  - `chromeInstanceInterfaceList(saved)`: every instance that has its own pick (readable state). `.interface` keys never count as "assets with edits".
  - Dialog: "Settings interface for this one" picker (framework SelectField) at the top of every chrome settings dialog. It always shows, even when the interface hides its header or tabs. Changing it re-renders the dialog at once (settings tick). The header says "interface <id> (its own)". `chrome.reset` also clears it.
  - Action `chrome.instance-interface:<type>:<instance>:<id|default|custom|inherit>`.
- **s2** Every toolbar and tab row really is its own instance.
  - Library toolbars with their own target (`axf-ws-toolbar:<ws>`) now map to the toolbar kind (`CHROME_TARGET_PREFIXES`), so they get Settings / Change / Move too.
  - The context menu and Settings → Plugins → Toolbars → All toolbars share one instance slug (`chromeInstanceSlug`). Each listed toolbar has a **Settings…** button and shows its interface pick.

## How each part is reached (API)
- Deep link: `chrome.settings:<type>:<instance>` opens the dialog (console_action / `console_open` action target).
- Set: `chrome.instance-interface:<type>:<instance>:<id|default|custom|inherit>`; the kind-wide pick stays `chrome.interface:<type>:…`.
- These are registered console actions, so the same id works through:
  - REST: console-command `run`
  - MCP: `console_action`
  - CLI: `axf console` / token-control
  - voice: AmberX `console_action`
  - control@1: `console.actions`
- State: the setting `axf.chrome.<type>.<instance>.interface`. The dialog header shows the interface in force and where it comes from. `chromeInstanceInterfaceList` lists every instance's pick.

## Tests
- `npx tsx framework/spec/check-chrome-settings.mts`: 291 checks. New fixture keys `instancePicks`, `instanceInterfaces`, `prefixTargets`, `instanceSlugs`, `keys.instanceInterface`.
- `node framework/spec/check-asset-overrides.mjs`: ok (`.interface` keys are not edits).
- `check-chrome.mts` 130 ok.
- console-web `tsc --noEmit` ok.
- check-theme, check-controls, check-toolbars, check-chrome-assets: all ok.
- control inventory regenerated and current.
- help-coverage synced.
- Help entry: `settings-interface-for-this-one` (framework help).
- Shipped features: the ledger takes the build from the builds store (build-hook@1); nothing to hand-write.

## Gaps
- **Screenshots.** UI Review shots are not taken. `rebuild-shots.mjs` started the console in this worktree, but the page rendered blank in headless Chromium, and Playwright is not installed in this checkout (it was borrowed from another one). The PR stays a draft until desktop and phone shots of a toolbar dialog and a tab-group dialog with the picker are in UI Review.
- **Baked copies.** `rebake.mjs apply` refuses: the apps have earlier edited baked files. The changed files were copied by hand into console-web, axhub-web, molly and amberx-droid, and their `axf.lock.json` hashes were updated.
- **Kotlin twin.** Deferred (PORTING.md).
