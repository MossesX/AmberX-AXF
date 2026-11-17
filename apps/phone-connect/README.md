# Phone Connect

The small Android companion of the Dev Console (contract `framework/spec/PHONE-CONNECT.md`, phone-connect@1; console
side `apps/console-web/plugins/phone-connect`). It pairs with a one-time code from Settings → Plugins → Phone Connect
(claimed with Brett's own axHub sign-in), keeps the link open in a foreground service, and runs what the console sends:
open a page, show a notification, show an approval (decided only by Brett's tap, on the hub's own page), record the
audio output, say a line or listen once. Nothing else: it replaces the AmberX app.

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
