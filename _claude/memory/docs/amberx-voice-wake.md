# AmberX silent wake listener (amberx-voice-wake, Oct 29 2026)

Orchestrator group `amberx-voice-wake`, steps refactor-all s87–s89, built on Opus, branch `refactor-all/amberx-voice-wake`.

## Why

Brett (Oct 29 2026, 01:13 EDT): "AmberX voice control constantly triggers tone but ActiveX doesn't — make it like ActiveX."

AmberX's hands-free mode restarted Android's `SpeechRecognizer` every few seconds, and every start plays the system
tone. Muting streams (the Oct 28 voice fix) only helped on some phones and muted notifications for as long as hands-free ran.
ActiveX idles on Vosk instead: offline, continuous, matching text phrases, no tone.

Brett chose the hybrid: a silent offline wake listener runs the whole time, and Google's recognizer runs for one
utterance only after a trigger.

## What

| Piece | Where |
| --- | --- |
| Wake listener: Vosk model download/load, the audio loop, grammar, triggers | `android/.../WakeListener.java` |
| Pure rules: grammar, sensitivity + level gate, level scale | `android/.../WakeRules.java` = `src/plugins/voice/web/wake.ts`, cases `wake-cases.json` (WakeRulesTest + test.mjs) |
| Modes, the one-shot Google utterance, tone muting, status phase | `android/.../WatchService.java` |
| Mute just for the trigger | `SpeechTuning.quietTrigger` / `quietMode` |
| Overlay phases | `DetectionOverlay.setPhase` |
| Settings, phrase list panel, Hands-free card | `src/plugins/voice/web/index.tsx` |

**Flow (wake mode, the default):**
1. Idle: `WakeListener` reads the mic (16 kHz mono `AudioRecord`) and feeds a Vosk `Recognizer`. Its grammar holds only the wake
   phrases, spelled the ways a small model hears them ("amber x", "amber ex", "amber acts"; "ok"/"okay"), plus `[unk]`.
   That keeps CPU low and nothing else gets transcribed. The overlay chip says **IDLE · WAKE**. The mic samples drive the level graph.
2. Trigger: a partial or final result holds a wake phrase (`WakeRules.trigger`: Low = final results only and a peak level of at least 0.3;
   Normal = partials allowed, at least 0.12; High = partials allowed, no level gate). The audio loop lets go of the mic.
3. `WatchService.oneShot`: notification + system streams are muted (also media when "Listening tone" is "Silenced (also media)")
   unless **Play tone on trigger** is on. Then one Google utterance runs with `SpeechTuning.request(..., false)` (partial results on,
   shown live on the overlay and the Voice page). The chip says **LISTENING**. A 15 s guard ends it if nothing arrives.
4. Result: the text goes out as `wake(phrase, "phrase command")`. In the app, the voice plugin's `wake` handler runs it, the same path as Speak.
   With the app closed, it opens AmberX (full-screen alert). If nothing was heard, it goes back to idle quietly and the overlay shows "Didn't catch a command".
   The streams are restored 600 ms after the end, so the stop tone is muted too. Then back to Vosk idle.

**Always armed:** Vosk runs without a grammar (the model's whole vocabulary). Every sentence it hears that is loud enough
for the sensitivity is the command, sent as is. A sentence that is only the wake phrase starts one Google utterance.

**Speak button** in wake mode: one native `listen` (the idle listener pauses through `WatchService.appMic`).

**Classic mode** (Hands-free mode → Classic): the old loop, Google all the time. It is the fallback when the model can't be had.

## The model

- `vosk-model-small-en-us-0.15` (~40 MB zip), from `WakeListener.MODEL_URL` (the only place the address lives).
- Downloaded once on first use into `files/vosk/vosk-model-small-en-us-0.15/` (marked `.ready`) with progress on the overlay
  (**MODEL n%**) and on the Voice page. Then it is loaded once per process. The APK stays small.
- Safety: the download is capped at 200 MB and every zip entry must stay inside the folder.
- If it fails (no network, say), the chip says **NO MODEL** with the reason, and it tries again in 5 minutes.
  Hands-free stays silent until then. Switching to Classic listens without the model (with the tone).
- Gradle: `com.alphacephei:vosk-android:0.3.47@aar` + `net.java.dev.jna:jna:5.13.0@aar` (Maven Central, the way the Vosk Android demo pulls them in).

## Settings (Settings → Plugins → Voice control)

- **Trigger phrases** panel: one dense column, a remove button per phrase, Add, suggested phrases one tap away, **Factory phrases**
  (hey amberx, okay amberx). It is kept as the `amberx.voice.wake` text (the typed field is still there).
- **Hands-free mode** `amberx.voice.mode`: `wake` (default) | `classic`.
- **Wake sensitivity** `amberx.voice.sensitivity`: `low` | `normal` (default) | `high`.
- **Play tone on trigger** `amberx.voice.triggerTone`: off by default.
- The Hands-free card on the Voice page has the same switches, plus a note while the model downloads or is missing.

## How to test on the phone

1. Install the CI APK (`amberx-debug.apk`). Open AmberX → Voice and leave Hands-free on.
2. First run: the overlay shows **MODEL 0% … 100%**, then **LOADING**, then **IDLE · WAKE**. Wi-Fi is best: it's about 40 MB, once.
3. Idle: no tone at all, for minutes. The level graph moves when you talk. Notification sounds still play (nothing is muted while idle).
4. Say "hey amberx": the chip changes to **LISTENING**, with no tone. Say "open approvals": the words show live, the page opens,
   and the reply is spoken. Then the chip goes back to **IDLE · WAKE**.
5. Screen off / another app: say "hey amberx", then "what's waiting". AmberX opens and runs it.
6. Turn on **Play tone on trigger**: the tone plays at step 4 only.
7. Sensitivity: on Low, a quiet "hey amberx" shouldn't trigger. On High, it triggers on the first partial.
8. Always armed: say "open settings" with no wake phrase. It runs as heard by Vosk.
9. Hands-free mode → Classic: the old behaviour (with its tone) comes back.
10. Do Not Disturb on: triggers still work. If Android refuses the mute, it's skipped silently and the tone may play.

## Known gaps

- The Java has only had a parse-level `javac` check here (no Android SDK or Maven access). CI compiles it and runs WakeRulesTest.
  The Vosk API used: `Model(String)`, `Recognizer(Model, float[, String])`, `acceptWaveForm(short[], int)`,
  `getResult` / `getPartialResult`, `close`, `LibVosk.setLogLevel`.
- English model only (other `lang` values still use it for the wake phrase; Google hears the command in the chosen language).
- Wake phrase words the small model doesn't know are skipped by Vosk. "amberx" itself is covered by the spelled-out variants.
- The model download doesn't check for Wi-Fi.
