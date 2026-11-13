# AXF Console for Android (`console-droid`)

Brett, Nov 13 2026: "make the console an Android app, just a wrapper for the web app, keep it floating on top;
AmberX's banner was behind the camera, the clock and the notification panel".

A thin native shell that runs the live web console (https://console.amberxai.com/) in a WebView. It replaces AmberX.
It is **not** a native rewrite: every screen, setting and action is the web console, so a console deploy updates the
app and the shell rarely needs a rebuild.

Native code exists only where Android requires it:

| Native piece | Class |
| --- | --- |
| WebView host, deep links, outside links to the browser, offline page | `ConsoleActivity`, `ShellRules` |
| Floating toolbar over every app (draw-over-apps): expands to the full-screen console with the toolbar docked top-left, approval bar with an "Open approvals" link | `OverlayService`, `OverlayRules` |
| Safe area: status bar, display cutout, navigation bar and keyboard from WindowInsets, set on the page as `--fx-safe-*` | `Insets`, `InsetsCss` |
| `window.axfNativeHost` bridge (the console wraps it as `window.axfNative` and `native.*` actions) | `NativeBridge` |
| Notifications, permissions (mic, notifications, overlay), wake, native look from the console's `--fx-*` tokens | `Notifier`, `Perms`, `Wake`, `ShellTheme` |
| Web content updates: a newer console deploy reloads the page off screen, or shows the console's reload bar on screen (`native.update:<check\|reload\|state>`) | `ContentUpdate`, `UpdateRules` |
| axHub's `amberx` device service: `amberx.open_url` (`browser.open`, `open-url@1`) over AXPP, with the WebView's hub sign-in; `?axf-overlay=expand\|collapse` verbs, pages open in the expanded overlay (overlay off: the app) | `DeviceLink`, `DeviceRules` |

Deep links: `axf-console://open/<console-control address>` (e.g. `axf-console://open/settings.plugins`),
`axf-console://search/<words>`, and any `https://console.amberxai.com/…` link.

Build: `gradle :app:testDebugUnitTest :app:assembleDebug` (CI job "Gradle — framework modules…"; the APK joins the app
catalog bundle as `console-droid.apk`).

## Moved from AmberX

- **Done:** the AXPP device link and `amberx.open_url` (console wake, MCP, CLI and voice open console pages here).
- **Not yet:** the Audio Output Recorder (`amberx.recorder_start|stop|status`, `recorder@1`). Its capture service
  (MediaProjection, upload queue, consent activity, about 1,400 lines tied to Capacitor) still lives in AmberX, and
  AmberX keeps answering those calls. The console app doesn't announce `recorder@1`, so the hub never sends it a
  recorder call it can't run. Moving it needs a session with a Java toolchain to compile and test the port.
