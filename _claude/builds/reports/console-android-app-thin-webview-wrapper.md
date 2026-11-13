# Console Android app: thin WebView wrapper (console-android-app-thin-webview-wrapper)

Built Nov 13 2026 on Opus, branch `claude/console-android-app-thin-webview-wrapper`, app `apps/console-droid`.

Brett (Nov 13 2026): "make the console an Android app, just a wrapper for the web app, keep it floating on top;
AmberX's banner was behind the camera, the clock and the notification panel"

## What it is
A native shell (`ai.amberx.consoleapp`, plain Java, no Capacitor) that runs the live console
(https://console.amberxai.com/) in one WebView. Every screen and setting is the web console. Native code covers only
what Android requires:

| Step | What | Where |
| --- | --- | --- |
| s1 | WebView host, deep links (`axf-console://open/<address>`, `axf-console://search/<words>`, console URLs), outside links to the browser, offline page | `ConsoleActivity`, `ShellRules`, `WebHost` |
| s2 | Draw-over-apps floating toolbar, notifications, mic, open_url, wake, permissions | `OverlayService`, `Notifier`, `Perms`, `Wake` |
| s3 | Safe area: WindowInsets (status bar, cutout, nav bar, IME) → `--fx-safe-*` on `<html>`; `framework/ui/axf.css` pads the frame (every top bar, banner, toolbar, side rail), the phone bottom nav, sheets and toasts; `viewport-fit=cover` | `Insets`, `InsetsCss`, `axf.css` |
| s4 | Toolbar expands to the full-screen console with the toolbar docked top-left, stays in front; approval bar with "Open approvals" | `OverlayService`, `OverlayRules` |
| s5 | `window.axfNative` bridge, `native.*` console actions, `panel:phone-app` state | `NativeBridge`, `apps/console-web/src/native` |
| s6 | Web content follows the live console: a newer entry bundle reloads the page after a minute off screen; on screen the console's "Reload for the new version" bar shows | `ContentUpdate`, `UpdateRules` |
| s7 | axHub's `amberx` device service moved from AmberX: AXPP hello/next/answer, `browser.open` (`amberx.open_url`) | `DeviceLink`, `DeviceRules`, `wake.py` |
| s8 | Help for every `native.*` action; JUnit + node tests | `console.json` help |

## How each feature is reached (API parity)
All four channels hit the same console action or control:
- **REST:** `POST /api/console/action` with `native.overlay:expand`, `native.update:check`, … ; state via `/api/console-control`, `state panel:phone-app`.
- **MCP:** `console_action native.…`, `console_control` state `panel:phone-app`.
- **CLI:** `axf console action native.overlay:expand`, `axf console control state panel:phone-app`.
- **Voice:** the same action ids through the voice command router.
- **Deep link:** `axf-console://open/<console-control address>` or `?axf-open=<address|action>` on any console URL.
- **axHub:** `amberx.open_url` (with `?axf-overlay=expand|collapse` verbs) reaches the console app over AXPP.

Actions: `native.overlay:<expand|collapse|toggle|approvals|dismiss>`, `native.permission:<mic|notifications|overlay>`,
`native.notify:<title>:<text>`, `native.open:<url>|app|overlay|browser`, `native.wake`, `native.update:<check|reload|state>`,
`native.state`, `native.recorder` (answers that the app can't record yet).

## Tests
- `node apps/console-web/src/native/nativeRules.test.mjs`: 7 checks pass (actions, deep links, Java/CSS token parity, bridge methods incl. `update`).
- `python3 apps/console-web/plugins/console-commands/server/test_console_commands.py`: 120 checks pass (new: the console app's `where: app` wake answer).
- console-web `tsc --noEmit`: passes.
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `help-coverage --check`: pass.
- JUnit (`ShellRulesTest`, `OverlayRulesTest`, `InsetsCssTest`, `UpdateRulesTest`, `DeviceRulesTest`): **not run here** (no Java on this server). CI's Gradle job (`apps/console-droid`, `gradle :app:testDebugUnitTest :app:assembleDebug`) is the first compile of s6/s7.
- Safe area screenshots (Playwright, 412×915 phone and 915×412 landscape with punch-hole insets): before, the first card sits under the clock and camera; after, it starts at 44 px (portrait) and 44 px from the cutout edge (landscape). The preview can't reach axHub, so the shots show the "Waiting for axHub" screen inside the same frame, not the full console.

## Known gaps / needs Brett
- **Recorder not moved.** AmberX's Audio Output Recorder (`amberx.recorder_start|stop|status`) still runs in AmberX. Its capture service (MediaProjection, upload queue, consent activity; ~1,400 lines tied to Capacitor) needs a session with a Java toolchain to port and test. The console app doesn't announce `recorder@1`, so axHub keeps sending recorder calls to AmberX. Keep AmberX installed for recording until then.
- **Sign in to axHub inside the app once.** The device link uses the WebView's axhub.amberxai.com session; signed out, it waits and retries every minute (`native.state` → `device.status`).
- **The hub may file the device under `app: console-droid`.** If axHub only accepts `amberx-droid` hellos, `amberx.open_url` stays on AmberX until the hub accepts it (check `device.status` = `linked`).
- **Not tested on a real phone.** Cutout, punch-hole, landscape and keyboard behaviour is verified in CSS and JUnit only; it needs a phone run with the CI APK.
- **Two sessions ran on this build at once** earlier today (dispatcher double-booking); s4/s5 commits from both are on the branch and consistent.
