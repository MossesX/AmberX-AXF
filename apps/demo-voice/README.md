# AXF Demo — voice

Demo app for **lib-voice 0.3.1** (`framework/android/lib-voice`), created with `axf new-demo voice` and `axf install voice`.

- **Dictation** (home): `engine.dictate(voice.engineOptions().copy(sensitivity = …), voice.endPhrases)` → live preview,
  kept segments with their confidence, utterances dropped below the `VoiceSensitivity` floor, the end reason. The slider
  shows `VoiceSensitivity.confidenceFloor`.
- **Hands-free** (`hands-free`): `engine.results.armedBy(VoiceArming(voice.armingConfig()), voice.sensitivity)` →
  `voice.commands.match(...)` for three `VoiceCommand`s registered in `AppModule` (hello, what time is it, clear).
  "Always armed" flips `arming.config` for the screen. Phrases are editable in **Voice triggers** (`VoiceTriggersScreen`).

**Vosk model:** `app/build.gradle.kts` has lib-voice's `fetchVoskModel` task (runs before `preBuild`, once) that unpacks
`vosk-model-small-en-us-0.15` into `app/src/main/assets/model-en-us`. That folder is gitignored; never commit it.

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
