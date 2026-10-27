# AXF Demo — overlay

Demo app for **lib-overlay** (`framework/android/lib-overlay`), created with `axf new-demo overlay` and
`axf install notifications|overlay`. One screen drives the whole `OverlayHost` API:

1. **Permission**: `canDraw()` / `requestPermission()` (Display over other apps).
2. **Show the pill**: `show()`, `hide()`, `resetGeometry()`; `state` drives the labels.
3. **Status chips**: `setChips(...)` once, `setChip(id, on)` from switches.
4. **Log panel**: `log.add(line, confidence, tag, ref)`, `log.clear()`; `log.onTap` opens a card with `setCard { dismiss -> }`.
5. **Mini screen**: `setMiniContent { MiniCounter() }`, `openMini`, `toggleMini`.

The manifest repeats `OverlayService` with `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`; `res/drawable/ic_notification.xml` is the
ongoing notification's icon. Settings → Overlay holds the user's overlay settings (opacity, strip, mini size …).

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
