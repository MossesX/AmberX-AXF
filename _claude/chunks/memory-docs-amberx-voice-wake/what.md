<!-- memory-chunk@1 source=_claude/memory/docs/amberx-voice-wake.md tokens=649 -->
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
