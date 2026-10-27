# AXF Demo — onboarding

Demo app for **lib-onboarding** (`framework/android/lib-onboarding`), created with `axf new-demo onboarding` and
`axf install onboarding`. `DemoOnboarding.spec` (`OnboardingSpec`) asks for the microphone (required), notifications and
draw-over-apps (optional) and battery (last step); the manifest declares those permissions. `MainActivity` wraps the
shell in `OnboardingGate(spec) { … }`, so the flow runs first. The home screen shows the live grants
(`rememberGrants`), the `RecoveryState` (`rememberRecoveryState`) with a `RecoveryBanner` (plus a preview switch),
**Run setup again** (`OnboardingService.reset()`) and lib-onboarding's `onboarding-status` page.

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
