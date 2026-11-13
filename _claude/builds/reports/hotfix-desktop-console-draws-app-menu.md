# HOTFIX: desktop console draws app menu, banners and nav twice

Build `hotfix-desktop-console-draws-app-menu` · branch `claude/hotfix-desktop-console-draws-app-menu` · Phase 1 (Opus), Nov 13 2026.

Brett said (2026-11-13 20:53): "there's two app menus, two banners, two navigation menus; I don't want to lose the toolbar settings"

## Result

Not reproduced, so nothing was changed in the chrome. The per-toolbar / per-instance settings feature is untouched (no revert).
This branch adds a regression test that fails if any of the three chrome pieces is drawn twice.

## What was checked

1. **The landing's code delta** (`e5639b79f..ec579ee23`, main before and after per-toolbar-settings-fix-failing-chrome).
   It only changes `ChromeContext.tsx` (the instance settings-interface picker inside the chrome settings *dialog*,
   `chrome.instance-interface` action), `Overlays.tsx` (one slug helper), `libs/toolbars` (a Settings… button and a
   column in the All toolbars panel) and `chrome-settings-rules.mjs`. None of them renders the app menu, banner or
   nav. `AppShell.tsx` (the only place `<Banner/>`, `<MenuBar/>` and `<NavMenu/>` are drawn) is unchanged. The baked
   copies in `apps/console-web/src/axf` match the framework.
2. **Commit 237a293af** (the accidental revert): it only touches builds-live data (`_claude/THREADS.md` +24 old log
   lines, `orchestrator.json`, the test-sandbox profile). No code, so it can't cause this. Left in place: reverting
   it would write stale data over the live `orchestrator.json`.
3. **This checkout in a browser** (Vite, Playwright, axHub off) at 1366×860 and 412×915, standalone and embedded
   (`?axf-embed=axhub`): one `.fx-frame`, one shell, one menubar, one banner, one nav (once the nav slot is on), also
   after per-instance settings were set and with the chrome settings dialog open.
4. **The deployed console** (container `axf-console`): at default settings, one of each on desktop and phone. Its image
   was built at **17:23 UTC** and its bundle doesn't have the per-instance picker yet, so the console Brett saw at
   20:53 was **not running the 20:44 landing**. The duplicates come from something else.

## Likely causes left (need Brett's screen)

- Settings saved only for his desktop (axHub look or this browser's local settings), e.g. a layout or chrome asset
  picked for the desktop form factor. They can't be read from here: the hub needs his session.
- A second console on the page: a Watch live window (floating on desktop, full-screen sheet on phone, so the phone
  looks fine) or a host app that embeds the console with its own chrome.

What's needed: a desktop screenshot, and the URL he had open.

## Test

`apps/console-web/scripts/chrome-once.e2e.mjs`: desktop + phone, standalone + embedded. It counts application menus
(`[role=menubar]`), banners (`[role=banner]`) and nav menus (`nav[data-axf-nav=app]`), which must be exactly 1 each:
first with the nav switched on (`slot.hide:nav-menu:off`), then after per-instance settings
(`chrome.instance-interface`, `chrome.set …:tapConfirm:on`), then with `chrome.settings:app-menu:app` open.
29 checks pass against this checkout. `CHROME_E2E_URL=<console>` runs it against any running console.

```
CHROME_E2E_URL=http://127.0.0.1:7461/ node apps/console-web/scripts/chrome-once.e2e.mjs
✓ desktop / desktop embedded / phone / phone embedded: one application menu, one banner, one navigation menu
chrome-once e2e: 29 checks passed
```

## API

No UI was added or changed. The test drives everything through the console-control executor
(`window.axfConsoleControl`, the one REST / MCP / CLI / voice use): `function:slot.hide`,
`function:chrome.instance-interface`, `function:chrome.set`, `function:chrome.settings`.

## Not done

- No chrome fix, because no defect was found in code; not landed, not redeployed. Redeploying now would ship the
  20:44 landing to the console for the first time, which fixes nothing.
- s2 / s3 not ticked; the build goes back to Pending with a note asking Brett for the screenshot and URL.
