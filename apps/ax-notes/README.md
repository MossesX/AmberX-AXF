# AX Notes

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

## AX Notes (build `ax-notes`, steps s11 / s12 / s22)

| Path | What |
| --- | --- |
| `model/` | Pure Kotlin: notes, shared categories, lists (notes / to-do / smart), to-dos, code links; `ListRules` (sorting, smart filters, grouping, manual moves, fuzzy check-off), `NoteTriggers` + `Dictation` + `ReadBack`; JSON in `NotesCodec`. Unit tests in `app/src/test`. |
| `data/` | `NotesStore` (offline-first on axf-data, one outbox per collection) and `NotesHubSync` (axHub `_data` for project `ax-notes`; placeholder until a lib-hub data client exists). |
| `capture/` | `CaptureController` (voice → transcript → note / command) and the app-local seams `NoteCapture`, `Speaker`, `TriggerSink`, `NoteAi` with placeholders (wired to lib-voice, lib-speech, lib-triggers, lib-ai later). |
| `app/src/main/assets/axnotes/triggers.json` | Voice phrases as data (`axnotes-triggers@1`), same set as `NoteTriggers.DEFAULTS`. |
| `views/` | Notes, Note editor, Speak, Lists, List, To-do item. |
