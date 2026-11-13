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

Deep links: `axf-console://open/<console-control address>` (e.g. `axf-console://open/settings.plugins`),
`axf-console://search/<words>`, and any `https://console.amberxai.com/…` link.

Build: `gradle :app:testDebugUnitTest :app:assembleDebug` (CI job "Gradle — framework modules…"; the APK joins the app
catalog bundle as `console-droid.apk`).
