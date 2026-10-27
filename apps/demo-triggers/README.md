# AXF Demo — triggers

Demo app for **lib-triggers** (`framework/android/lib-triggers`), with lib-voice and lib-speech: a
**voice + triggers + speech walkthrough**. Created with `axf new-demo triggers` and `axf install voice|speech|triggers`.

1. **Say it**: `triggers.voiceBridge(context = { "demo.walkthrough" }, log = …)` on lib-voice's engine
   (`bridge.start(scope)`, `engine.start(voice.engineOptions())`), or type a phrase: `bridge.process(VoiceResult(…))`
   feeds the same bridge without a microphone.
2. **Trigger decisions**: every `TriggerLogEntry` (heard, confidence, drop reason or each trigger's outcome).
3. **The app speaks**: `bridge.commands` → `AxfTriggers.run(cmd)` → action bus → `AppModule`'s actions answer with
   `AxfSpeech.say(…)`. "toggle reading" is a `SettingVoiceBinding` that flips Settings → Speech → Read aloud.

`AppModule` registers the permanent triggers (`TriggerHosting.voiceCommand`, `store.registerPermanent`) and a context;
**Edit triggers** opens lib-triggers' `TriggersScreen` (route `triggers`: switch, threshold, add your own).
The Vosk model is fetched by the `fetchVoskModel` task (see demo-voice); `app/src/main/assets/model-en-us` is gitignored.

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
