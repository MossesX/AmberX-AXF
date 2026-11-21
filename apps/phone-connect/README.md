# Phone Connect

The small Android companion of the Dev Console (contract `framework/spec/PHONE-CONNECT.md`, phone-connect@1; console
side `apps/console-web/plugins/phone-connect`). It pairs with a one-time code from Settings → Plugins → Phone Connect
(claimed with Brett's own axHub sign-in), keeps the link open in a foreground service, and runs what the console sends:
open a page, show a notification, show an approval, record the audio output, say a line or listen once. Nothing else:
it replaces the AmberX app.

- **Approvals** arrive as a high-priority notification with Approve and Deny on it (Shelve on a countdown that offers
  it). A tap on an action is the decision: it needs the phone unlocked and goes to the console as Brett's own tap
  (personOnly); the app never decides by itself. A tap on the body opens that approval in the console.
- **Pages** open straight away, no tap: a console page in the AXF Console app (its floating overlay, or the app in
  front), anything else in Chrome (or the default browser). Android blocks an app in the background from starting an
  activity unless Brett allowed it to "display over other apps" (a button on the app's screen; the console app's own
  permission counts too). The high-priority tap-to-open notification is only the fallback, when no app holds the
  permission or the start did not come up, and the result says so (`how: notification`, `why`).
- **A refused key is never retried.** When the console no longer accepts the device token (revoked, forgotten, replaced)
  the link stops, and the app says "Disconnected: tap to re-pair" in a notification and on its screen.

Initialized by the **AmberX AXF 0.2.0** build engine (`android-compose` template).

Open this folder in Android Studio, or:

```bash
./gradlew :app:assembleDebug
```

The framework is pulled in as a composite build from `../../framework/android` (see `settings.gradle.kts`), so
framework changes are picked up immediately. To depend on a published framework instead, remove the
`includeBuild` line and the same `ai.amberx.axf:<module>:<version>` coordinates resolve from Maven.

| Path | Purpose |
| --- | --- |
| `axf.manifest.json` | App identity, framework version, targets, default asset per slot |
| `app/src/main/assets/axf/` | Copy of the manifest + every hot-swappable asset, shipped in the APK |
| `app/src/main/kotlin/app/App.kt` | Builds and starts the kernel (`AxfApplication`) |
| `app/src/main/kotlin/app/MainActivity.kt` | Single activity: `AxfRoot` + `AppShell` + views |
| `app/src/main/kotlin/app/AppModule.kt` | Routes, actions, settings, dialogs for this app |
| `lib-settings` + `axf-devtools` (`PluginManagerModule`) | The settings interface every app ships (`settings` view: Appearance, General, **Plugins** with every module's health, About) and the Plugin Manager (`plugin-manager` view, long-press menu). Plugins add settings groups under Settings → Plugins, never a screen of their own |

Validate conformance at any time: `node ../../framework/cli/axf.mjs validate .`
