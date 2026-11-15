# Phone Connect — removal list (inventory before anything is deleted)

Build `phone-connect-small-android-companion`, step s4. Every piece of AmberX and of the two console plugins this
build retires or moves, with what happens to it. Nothing here is deleted until the retirement gate (s32) passes.

Verdicts:
- **KEEP → phone** — ported into `apps/phone-connect-droid` (native Kotlin, overlay only, no app screens).
- **KEEP → plugin** — ported into the console plugin `apps/console-web/plugins/phone-connect`.
- **MERGE → assistant** — carried into the console AI Assistant (`apps/console-web/plugins/ai-assistant`), or noted as already covered there.
- **DROP** — removed with AmberX, not replaced.

## apps/amberx-droid — web plugins (`src/plugins/`)

| Piece | What it is | Verdict | Where it goes |
|---|---|---|---|
| `approvals` (+ `src/views/Approvals.tsx`, `src/axf/libs/approvals/`) | veto@1 terminal: held calls, countdown, Approve / Deny / Shelve | **KEEP → phone** | Approval popups in the overlay, act in place (s19) |
| `monitor` | Screen-off axHub watch: approval alerts, auto-approval, wake phrase | **KEEP → phone** (wake phrase part **DROP**) | `WatchService` foreground service (s20); rules on the server (s10) |
| `voice` (speech, handsfree, wake, wakeflow, speechgate) | Voice commands and hands-free wake phrase | **DROP** | Brett: "Voice commands get rid of it, it's buggy" |
| `commands` (voice command library, wizards, runner) | Hundreds of voice commands and chains | **DROP** | Goes with voice |
| `listeners` | Control panel for background listeners (listener@1) | **DROP** | No listeners left on the phone |
| `notes`, `tasks` | Notes, todos and tasks on axHub | **DROP** | Brett: "Notes … gone"; notes stay in the console (notes-tasks) |
| `dictation` | Turn-by-turn dictated notes | **DROP** | Brett: "dictation … gone" |
| `web` | In-app web tabs, bookmarks, clipping | **DROP** | Brett: "web tabs … gone"; open-page on the phone is kept as a command (open_url) |
| `ai` (AI connection through AmberX's server) | Provider keys and switching on the AmberX server | **DROP** | Brett: "AI connection gone"; the console holds keys (ai-keys) |
| `companion` (Gizmo chat, mirror, talk, keys, agent picker) | Phone AI assistant + agent manager | **MERGE → assistant** | s26 carries anything the console assistant lacks |
| `walkthrough` (+ `apps/amberx-droid/walkthrough/`) | Narrated walkthrough video and its recorder | **DROP** | Brett: "Walkthrough video kill it" |
| `_template` | Plugin starter | **DROP** | |

## apps/amberx-droid — shell, server, deploy

| Piece | Verdict | Notes |
|---|---|---|
| Capacitor shell (`capacitor.config.json`, `android/`, `index.html`, `src/App.tsx`, `main.tsx`, `windows/`, `dialogs.tsx`, `console/`) | **DROP** | Phone Connect is native Kotlin with no app screens |
| Hub sign-in (`src/hub/useHub.ts`, `HubRules.java`, `HubWebActivity.java`, `securescreen.ts`, `SecureScreen.java`) | **KEEP → phone** | One-time sign-in page and session storage (s18) |
| `ApprovalOverlay.java`, `ApprovalOverlayRules.java`, `OverlayPageRules.java`, `VetoAlerts.java`, `VetoAlarm.java` | **KEEP → phone** | Overlay popups for approvals and alerts (s17, s19) |
| `WatchService.java`, `BootReceiver.java`, `Quiet.java` | **KEEP → phone** | Monitor (s20) |
| `OpenUrlRules.java` | **KEEP → phone** | open_url filter, amberxai.com https only (s21) |
| `OutputRecorderPlugin.java`, `OutputRecordService.java`, `OutputRecordQueue.java`, `OutputRecordUploader.java`, `OutputRecordStartActivity.java`, `OutputRecordTile.java`, `RecorderControl.java`, `TwoTrack.java` | **KEEP → phone** | Whole Audio Output Recorder (s23) |
| `WakeListener.java`, `WakeRules.java`, `SpeechTuning.java`, `TalkService.java`, `MicTile.java`, `MicGuard.java`, `MicRules.java`, `AudioFocusGuard.java`, `ListenerRegistry.java`, `ListenerRules.java`, `FocusRules.java`, `DetectionOverlay.java`, `src/mic.tsx`, `micguard.ts`, `miclease.ts`, `listeners.ts`, `sound.tsx` | **DROP** | Wake word and voice |
| `ScreenRecordService.java` | **DROP** | Walkthrough capture |
| `AudioExtractPlugin.java`, `AudioExtractor.java` | **DROP** | Console audio-extract plugin covers it |
| `AmberxNativePlugin.java`, `AxppLink.java`, `MainActivity.java`, `native.ts`, `hosted.ts`, `actions.ts` | **DROP** | Capacitor bridge |
| Unit tests (`android/app/src/test/…`) | `OpenUrlRulesTest`, `ApprovalOverlayRulesTest`, `HubRulesTest`, `RecorderControlTest`, `TwoTrackTest` **KEEP → phone** as Kotlin tests (s29); the rest **DROP** | |
| AmberX server (`server/main.py`, `router.py`, `intent.py`, `axf_framework.py`) | **DROP** | AI keys/provider switching and voice intent; console covers both |
| Assets (`src/assets/…`: toolbar, nav-menu, app-menu, context-menu, status/amberx-mic, chrome settings, design packages) | **DROP** | Phone themes from the console skin live (Axf tokens) |
| `project.manifest.json`, `axf.manifest.json`, `axf.lock.json`, `package*.json`, `Dockerfile`, `vite.config.ts`, `tsconfig.json`, `test.mjs`, `README.md`, `_claude/` | **DROP** | Replaced by `apps/phone-connect-droid` |
| Deploy `apps/amberx-droid/deploy/install.sh` → **amberx.amberxai.com** (Coolify app, cron, DNS A record) | **DROP** | Veto call with reason at s33; DNS removal logged in the DNS log |
| CI APK job in `.github/workflows/android.yml` (AmberX APK) | **DROP** | Replaced by `phone-connect-debug.apk` (s25) |
| `framework/schemas/shared-assets.json` amberx-droid entry, rules lines naming AmberX | **DROP / reword** | s25, s33 |

## Console plugins

| Plugin | Verdict | Where it goes |
|---|---|---|
| `output-recorder` (server transcripts + whisper job, web store/bridge/menu, help, hooks) | **KEEP → plugin** then removed | Session start/stop/status, 30-minute parts, upload intake, transcription hook, mic opt-in move into phone-connect (s8–s9); emptied plugin uninstalled (s28), only aliases remain |
| `wake-listener` (always-on wake mic, catalog, listener, claude intent/tools) | **DROP** | Brett: "Wake word listener kill it"; uninstalled and deleted (s27) |
| `amberx-listeners` | **DROP** with AmberX | Listener panel for AmberX; removed at retirement (s33) |
| `agent-manager` (console) | **stays** | Brett's "agent manager kill it" is the AmberX one; the console's agent manager is untouched |
| `ai-assistant` (console) | **receives the merge** | s26 |

## axHub

| Piece | Verdict | Notes |
|---|---|---|
| `amberx` device record | **KEEP → migrated** | `migrate.mjs` turns it into a `phone-device@1` (same id, `migratedFrom`); the old device is removed at s33 as a veto call |
| `amberx.open_url`, `amberx.recorder_*` tools | **KEEP as aliases** | `phone.*` tools added (s12); `amberx.*` kept as aliases with the same policies |

## Kept features and how they are reached (summary)

Approvals, Monitor, open page on the phone, notifications, Audio Output Recorder. Everything else on the AmberX list
is dropped or merged into the console AI Assistant.

## AmberX assistant and agent manager → console AI Assistant (s26)

Gizmo's brains already were the console AI Assistant (agent Gizmo, reached through AmberX's server), so nothing of
its intelligence moves; what AmberX drew on the phone is checked against the console assistant:

| AmberX (companion, ai) | Console AI Assistant | Verdict |
| --- | --- | --- |
| Full-screen chat, streaming replies, markdown and code with copy | chat.tsx (stream, Markdown, copy) | covered |
| Photos, images and files | attachments in chat.tsx / chatmode.py | covered |
| Stop, regenerate, edit and resend, continue | chat.tsx (stop, regenerate, resend, continue an interrupted reply) | covered |
| Chats: search, pin, rename, delete, export | store.py + chat.tsx list menu | covered |
| Agent picker / agent manager on the phone | chats as an agent through axf.agents@1 (console Agent manager plugin), `ai.chat.start` with agentId | covered |
| Talk mode: push-to-talk, hands-free, spoken replies, talk over to stop | the Agent voice plugin (assistant microphone, agents speak); hands-free wake word dropped with voice | covered / dropped (voice) |
| Reached from the phone | the console in Chrome (hub session through the wall) | **carried over:** an **Assistant** button on the Phone Connect toolbar opens the console on the assistant (search deep link) |
| Text copy of each chat on axHub | chats kept in the console's own store | covered (store moved) |
| AI keys and provider switching on AmberX's server | ai-keys + the shared provider registry | covered |
| Ask my notes | notes are dropped on the phone; the console assistant reads notes through its tools | covered |

Nothing else is carried over; AmberX's companion and ai plugins go with AmberX at retirement.
