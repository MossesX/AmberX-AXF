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
| Floating toolbar over every app (draw-over-apps): expands to the full-screen console with the toolbar docked top-left, approval bar with an "Open approvals" link; its names (states, verbs, settings, events, the four API ways in) are the `overlay@1` contract, [OVERLAY.md](OVERLAY.md) | `OverlayService`, `OverlayRules`, `OverlayContract` |
| Safe area: status bar, display cutout, navigation bar and keyboard from WindowInsets, set on the page as `--fx-safe-*` | `Insets`, `InsetsCss` |
| `window.axfNativeHost` bridge (the console wraps it as `window.axfNative` and `native.*` actions) | `NativeBridge` |
| The page's own questions (`alert()`, `confirm()`, `prompt()`): the WebView draws them only in an activity, so in the expanded overlay the shell draws them in an overlay window; bridge feature `dialogs` (0.2.0) | `JsDialogs`, `DialogRules` |
| Notifications, permissions (mic, notifications, overlay), wake, native look from the console's `--fx-*` tokens | `Notifier`, `Perms`, `Wake`, `ShellTheme` |
| Web content updates: a newer console deploy reloads the page off screen, or shows the console's reload bar on screen (`native.update:<check\|reload\|state>`) | `ContentUpdate`, `UpdateRules` |
| Tabs: a small strip under the page (+ to add, tap to switch, x to close); each tab is its own console WebView, so it keeps its own screen and scroll; bridge feature `tabs` | `TabRules`, `TabStrip`, `WebHost` |
| axHub's `amberx` device service: `amberx.open_url` (`browser.open`, `open-url@1`) over AXPP, with the WebView's hub sign-in; `?axf-overlay=expand\|collapse` verbs, pages open in the expanded overlay (overlay off: the app) | `DeviceLink`, `DeviceRules` |

## Tabs

Brett, Nov 25 2026: "small tab strip with + to add, tap to switch, x to close". The strip sits under the page, in the
app and in the expanded overlay (the floating toolbar docks top-left, so the two never overlap). Rules (`TabRules`,
tested in `TabRulesTest`): + opens a new tab on the console's start screen and shows it (at most 8, each is a live
page); tapping a tab shows it and the others keep running; x closes a tab, the one on screen hands over to its
neighbour, and closing the last one leaves one fresh start-screen tab. A tab's label is its screen's name. Colours and
sizes are the console's tokens (`ShellTheme`). The strip keeps itself clear of the navigation bar and the keyboard;
the page above it gets `--fx-safe-bottom: 0`.

Every action has the same four ways in as the rest of the console (the console action `native.tabs`, so REST and MCP
`console_control`, the CLI `axf console`, and voice):

| What | Action | Bridge (`window.axfNativeHost`) | Deep link |
| --- | --- | --- | --- |
| Read the tabs (id, title, url, link, which is on screen) | `native.tabs:state` (also in `native.state`) | `tabs("state", "")` | |
| New tab (start screen, or a console link) | `native.tabs:new[:<link>]` | `tabs("new", link)` | `axf-console://tab/new` |
| Switch to a tab | `native.tabs:switch:<id>` | `tabs("switch", id)` | `axf-console://tab/<id>` |
| Close a tab | `native.tabs:close:<id>` | `tabs("close", id)` | |

The page on screen gets a `tabs` event (`axf-native`, the state above) after every change.

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
- **Not yet:** the wake listener's on-device backend. The console's `wake-listener` plugin looks for `listener.start`,
  `listener.stop` and `listener.status` in the bridge's `tools` list and a `listener` event (`plugins/wake-listener/web/engine.ts`).
  `NativeBridge` doesn't carry them, so the plugin reports no native backend and stays on Web Speech. The bridge reads
  both call styles (answer at once or a promise), so adding the tools needs no console change.

## Four slots at the same time

Brett, Nov 13 2026: "split the console wrapper so it runs on four slots at the same time". The console app is four
builds that run side by side, each on its own branch and session, and land in any order:

| Part | Build | Owns | PR |
| --- | --- | --- | --- |
| 1 | `console-android-app-thin-webview-wrapper` | The shell: `ConsoleActivity`, `WebHost`, `ShellRules`, `NativeBridge`, `Perms`, `Insets`, `ContentUpdate`, `DeviceLink`, the console's `src/native/` | #637, carried by part 2 |
| 2 | `console-app-part-2-native-floating` | The floating toolbar and approvals bar (`overlay@1`): `OverlayContract`, `OverlayRules`, `OverlayService`, `OverlayPermission`, `SafeArea`; the approvals banner's `overlayItems` | this build (part 1 merged in) |
| 3 | `console-app-part-3-native-bridge-mic` | The native bridge for the mic and the wake listener | #791 (land) |
| 4 | `console-app-part-4-console-side-safe` | The console side: `--fx-safe-*` in `framework/ui/axf.css`, the server's app routes, wrapper support in the console | #792 (land) |

Kept apart on purpose: parts 1–2 are the Java module plus the bridge glue, part 3 the mic path, part 4 the console's
own CSS and server. A trial merge of this branch with parts 3 and 4 (Nov 17 2026) merges every source file cleanly;
the only overlaps are generated or synced data (`src/control/inventory.json`, `framework/catalog/*.json`,
`framework/plan/plan.json`, `tracker.json`), which the lander regenerates. Whichever lands first, the others merge
main and land after it with nothing to redo.
