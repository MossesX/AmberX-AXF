# Overlay opens pages: the floating toolbar expands into a full browser window

Build `overlay-opens-pages-the-floating-toolbar-expands`, phase 1 (Opus). Branch `claude/overlay-opens-pages-the-floating-toolbar-expands`.

## Brett said (verbatim, Nov 13 2026 11:27)

> I want it to pop up a full browser window if I want to, if I go to a page. But I want it to be just a floating toolbar unless you call it to open something. When you close the browser, it's just a floating toolbar again.

## What was built

- **s1, full browser window.** AmberX's floating approval toolbar (Java `ApprovalOverlay`) turns into a full-screen browser
  window when a page is opened. The toolbar becomes its title bar (page title, back, reload, Chrome, close). Because
  the window draws over other apps, it opens from the background. AXPP `browser.open` (what `amberx.open_url` and a
  `console_show` with no Dev Console open send to the phone) now goes to this window. It falls back to Chrome when the
  overlay is off, lacks "Display over other apps", watching is off, the call says `where: "browser"`, or Brett set
  pages to Chrome. Only Brett's own sites (`OpenUrlRules`: https, `amberxai.com` and its subdomains) load inside. Other
  links open in Chrome.
- **s2, a toolbar unless called.** The overlay stays a plain floating toolbar until something opens a page. New setting
  `approvals-banner.overlay.pages` (`overlay` by default, or `browser` for Chrome) is in Settings → Plugins →
  Approvals banner → Approval overlay. New actions: `approvals.overlay:page[:<url>]` opens the window, with no URL it
  opens the last page or the console. `approvals.overlay:close` closes it.
- **s3, closing makes it a toolbar again.** The window closes with ✕, with the back key once there is no history left,
  with the `close-page` command, or when the WebView renderer dies (it no longer takes the app down). Then it is just
  the floating toolbar again, in its saved place and size. It remembers the last page for the Page button.

## How each part is reached (API rule)

| What | Console API (REST) / MCP / CLI | Voice (AmberX) | Native |
|---|---|---|---|
| Open a page in the window | `amberx.open_url` / `console_show` (axHub → AXPP `browser.open`, optional `where: overlay\|browser`); console action `approvals.overlay:page:<url>` | "overlay page", same action | `approvalOverlayCommand({command:'page', url})` |
| Close back to the toolbar | console action `approvals.overlay:close` | "overlay close" | `approvalOverlayCommand({command:'close-page'})` |
| Where pages go | `settings.set:approvals-banner.overlay.pages:<overlay\|browser>` (control@1 `console.settings`); `approvals.overlay:pages:chrome` | "overlay pages chrome" | `approvalOverlaySet({pages})` |
| State | `approvalOverlayState()` → `page: {open, url, title, last}`; `settings.pages` | | same |

Deep link: Settings → Plugins → Approvals banner (`console_show` on the `approvals-banner` settings tab).

## Tests

- Plain JUnit, run in a JDK 21 container (`OverlayPageRulesTest`, `ApprovalOverlayRulesTest`, `OpenUrlRulesTest`): 18
  tests OK. The full gradle `:app:testDebugUnitTest :app:assembleDebug` runs in CI (no Android SDK on the VPS).
- `approvals-banner/test.mts` (Node 22): 25 checks passed.
- `check-theme`, `check-controls`, `check-toolbars`: pass. `plugin-lifecycle check approvals-banner` was failing on the
  overlay's own THREADS row. Fixed by listing `_claude/THREADS.md` in the plugin's `lifecycle.mentions`.

## Open

- Phone screenshots (toolbar → browser window → toolbar) go to UI Review once a new AmberX APK with this branch is on
  the phone. The window is native Java, not a console screen, so the VPS can't capture it.
- With "Show the toolbar when nothing waits" off, closing the window hides the overlay until an approval arrives. That
  is Brett's idle setting, kept as is.
- Native Java in AmberX only (an app feature, not a framework engine), so there is no cross-port twin.
