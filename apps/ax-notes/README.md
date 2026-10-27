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
| `capture/` | `CaptureController` (voice → transcript → note / command) and the app-local seams `NoteCapture`, `Speaker`, `TriggerSink`, `NoteAi` (`Interfaces.kt`, with their stand-ins) plus the library-backed ones (s13): `VoiceLoop` (lib-voice), `SpeechSpeaker`, `StoreTriggerSink`, `HubNoteAi` (`Wired.kt`), `TriggerData` (app trigger data ⇄ triggers@1). |
| `app/src/main/assets/axnotes/triggers.json` | Voice phrases as data (`axnotes-triggers@1`), same set as `NoteTriggers.DEFAULTS`. |
| `views/` | Notes, Note editor, Speak, Lists, List, To-do item. |

## Wiring (build `ax-notes`, step s13)

`App.kt` installs lib-notifications, lib-voice, lib-speech, lib-triggers, lib-ai, lib-onboarding and lib-overlay (added with
`axf install <lib>`; parameters in `axf.manifest.json → libraries` and `axf/*Setup.kt`). `AppModule` gives each seam its
library when the module is there and keeps the stand-in when it isn't, so removing a library line still builds a working app.

| Seam | Library | How |
| --- | --- | --- |
| `NoteCapture` | lib-voice | `capture/VoiceLoop.kt`: one engine (Vosk), shared by holders `capture` (Listen button), `hands-free` (Settings → AX Notes → Listen hands-free, the mini screen's Listen) and `dictation`. A dictation runs on `VoiceEngine.dictate` (sensitivity floor, the user's stop phrases + “end note”); everything else goes to the trigger host. |
| — | — | `service/MicService.kt`: `microphone` foreground service, on while anyone holds the mic, so listening survives the app going to the background. |
| `Speaker` | lib-speech | `SpeechSpeaker`: read-backs queue on `AxfSpeech.read` (Settings → Speech → Read aloud). Dictated words are dropped while it speaks; while it reads only `speech.*` triggers act (no echo loops). |
| `TriggerSink` | lib-triggers + kernel `TriggerRegistry` | `assets/axnotes/triggers.json` → permanent triggers@1 records (`TriggerData`: ids `axnotes.<kebab id>`, `{slot}` → `<slot>`, optional end slot → two phrases, action `axnotes.voice`). speech@1 controls are registered in the store too so their thresholds persist. A `VoiceTriggerBridge` matches against the whole kernel registry (app + speech + plugin triggers), context = the current route (or `<ctx>` while the overlay shows a plugin's `<ctx>.mini` screen). Unmatched speech goes to action `<context>.say` when it exists (ai-chat's chat mode). |
| `NoteAi` | lib-ai | `HubNoteAi`: “summarize …” runs in mode `ai.chat` in one live session on axHub (id kept in KV `axnotes.ai.session`); the last reply shows in the mini screen. |
| `NotesHubSync` | — | stays `UnwiredHubSync` (no lib-hub data client yet). Settings → AX Notes says **sync is off** and how many changes wait on the phone. |

**Overlay** (`overlay/NotesOverlay.kt`, asset `overlay/ax-notes`): chips ARMED / MIC / AI; every utterance the trigger host
decided on goes into the pill's log with its confidence and outcome; tapping a line opens a card under the pill that writes
that trigger's threshold (store override; plugin triggers only for the session). Mini screen: live transcript, last note,
AI reply, Note (dictation) and Listen (hands-free) buttons, plus one tab per plugin mini screen (`axnotes.mini-screens`;
the first one shows by default). Quick action = start / stop dictation (action `axnotes.dictation`). Show it from
Settings → AX Notes → Show the AX Notes overlay (`axnotes.overlay`).

**Onboarding**: `MainActivity` wraps the shell in `OnboardingGate(AppModule.ONBOARDING)`: microphone (required),
notifications, overlay, battery (optional).

**Settings** (`views/SettingsView.kt`, route `settings`): tabs AX Notes (app group + sync status), Voice (voice, voice
listening, speech, triggers link), Overlay, AI, Setup (onboarding), Plugins (every listed plugin with its load state, and
one sub-tab per plugin with its own settings groups), All settings (lib-settings' full screen, Appearance included).

**Vosk model**: `./gradlew :app:assembleDebug` runs `fetchVoskModel` once (into `app/src/main/assets/model-en-us`,
git-ignored; `AXF_SKIP_VOSK_MODEL=1` skips it). Without the model voice input is off and the typed box still works.

## Plugins

`apps/ax-notes/plugins/<folder>/` (plugin@1, kind `module`): each is a Gradle module its `install.mjs` wires in
(`settings.gradle.kts` include, `app/build.gradle.kts` dependency, a row in `assets/axnotes/plugins.json`) and its
`uninstall.mjs` removes. `host/PluginHost.kt` loads every listed `entry` class by name and skips what's missing, so the app
runs as plain voice notes with every plugin removed. Hooks a plugin can use (no plugin is named in app code):

- kernel extension points (routes, views, actions, menus, settings groups with their own `tab` → a sub-tab under
  Settings → Plugins, triggers in the kernel `TriggerRegistry`);
- `axnotes.mini-screens` (`PluginHost.MINI_SCREENS`): a `ViewContribution` for the overlay's mini screen;
- action `axnotes.notes.save` (payload `{title?, text, tags?, category?, source?}`) and `axnotes.notes.saved` (dispatched
  after every new note with the note JSON);
- free speech: `<context>.say` with `{text}` when nothing matched.

Data: a plugin keeps its device data under its `dataPrefix`. On start the app clears KV keys and saved settings under the
prefix of every plugin that was listed before and isn't any more (saved settings are blanked, see below).

Not hosted yet: `axf.workers` contributions (ai-automations' `AutomationsWorker`). lib-work takes its poll jobs as
`PollJob`s when `WorkModule` is constructed in `App.modules()`, before plugins register, and the worker type lives in the
plugin, so hosting it needs a generic worker contract in the kernel (or a `PollJobs.register` call from the plugin itself).
