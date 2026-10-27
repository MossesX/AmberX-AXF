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

## Plugins (build `ax-notes`, steps s14 / s16 / s23)

Plugins live in `plugins/<folder>/` (plugin@1 `plugin.json`, `src/main/kotlin`, `assets`, `src/test/kotlin`, `install.mjs`, `uninstall.mjs`). The installed set is `app/src/main/assets/axnotes/plugins.json` (`axnotes-plugins@1`): Gradle compiles only the plugins listed there, and the app's plugin host (`pluginhost/`) creates their entry modules from it. Each plugin has its own sub-tab under Settings → Plugins, hooks into the application menu and the nav menu, and lists its dependencies for the Plugin Manager. With no plugins installed the app builds and runs the same.

| Path | What |
| --- | --- |
| `pluginhost/` | `PluginHost` (loads plugins.json), `PluginKit` (store, AI through the kernel ai-modes@1 contract, own data folder, settings, menus, triggers@1, purge), `PluginHostModule` (records each plugin's footprint; purges a removed plugin's data, settings, generated lists and triggers on the next launch), `AiAsk` (one question → one answer over `AiSessionClient`), `ReplyJson`. Tests: `app/src/test/.../pluginhost`. |
| `plugins/manage.mjs` | `list`, `install <folder>`, `uninstall <folder> [--all]`, `check <folder> [--after-uninstall]`, `check --all`. |
| `plugins/note-sorter/` | Note sorter: AI sorting (category, tags, title, summary, action items → to-dos), learning from re-categorizations, daily / weekly digest. <!-- axf-plugin:note-sorter --> |
| `plugins/ai-codebase-reader/` | AI codebase reader: read-only repos via axHub (mode ai.read-codebase) → notes with code links, per-repo TODO/FIXME lists, voice "note on <file>" / "ask about <file>". <!-- axf-plugin:ai-codebase-reader --> |
