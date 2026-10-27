# lib-speech (0.1.0) — AmberX speaks

The speaking side of **speech@1** (kernel `ai.amberx.axf.kernel.speech`, web reference `framework/core/speech.ts`). Listening stays in **lib-voice**; lib-voice's `Speaker` now runs on this library, so Voice Vault's prompts use the same engine with the same API.

```kotlin
// App.kt
override fun modules() = listOf(/* … */ SpeechModule(this), AppModule())

// in a module
val speech = ctx.require(AxfSpeech::class)
speech.read("Your note was saved.")          // queued; only when Settings → Speech → Read aloud is on
speech.say("Locked.")                         // now, interrupts, always
speech.player.pause(); speech.player.faster() // or any SpeechQueueEvent: speech.player.dispatch(…)
speech.handle(triggerCommand)                 // a fired "pause" / "skip" / … from the trigger host
speech.player.state                           // StateFlow<SpeechQueueState> for UI
```

- **AndroidTtsProvider** (`axf.speech`, id `android-tts`): `SpeechProvider` over `TextToSpeech`. Lazy start (a failed start is retried), voice / rate / pitch / language per utterance, `voices()` (installed voices, `kind` = local | network), `speak` resolves from utterance callbacks (done / failed / stopped), `onEvent` sees every callback as a `SpeechQueueEvent`, `stopNow()`, `shutdown()`.
- **SpeechPlayer**: runs the kernel `SpeechQueue.reduce` and only carries out its effects. `enqueue(text, opts, next)`, `say`, `pause`, `resume`, `skip`, `back`, `faster`, `slower`, `again` (repeat), `setRate`, `setRepeat`, `stop` (clear), `dispatch(event)`, `state`, `lastOutcome`. Stale completions (a stopped or replaced utterance) never move the queue; a stop always finishes before the next speak; an engine that fails every item clears the queue instead of looping.
- **Audio focus + ducking**: `AndroidAudioFocus` asks for transient focus while there is something to say (others duck, or pause when ducking is off) and gives it back when the queue is over. `FocusPolicy` (pure): any loss pauses; a transient loss resumes by itself on gain; a permanent loss waits for the user.
- **Settings group "Speech"** (`speech`): `axf.speech.readAloud`, `.voice`, `.rate`, `.pitch`, `.language`, `.duck`. `SpeechSettings.from(lookup)` is pure and falls back to defaults.
- **Spoken controls as data**: `SpeechCommands` (`speech.pause`, `speech.resume`, `speech.skip`, `speech.faster`, `speech.slower`, `speech.repeat`, `speech.stop`) are ActionBus actions and permanent voice triggers (`SpeechTriggers.all(module, worksIn)`, triggers@1, 80 %, no arming) registered in the kernel `TriggerRegistry`. Phrases: "pause", "resume", "skip", "faster", "slower", "repeat", "stop reading" (+ a longer form each). Plus `speech.say:<text>`.
- **HqSpeechProvider**: typed placeholder for high-quality voices (`axf.speech.hq`, NotImplemented). A real one is passed as `SpeechModule(this, provider = { MyHqProvider(it) })`.
- **Versions**: lib-speech 0.1.0 (semver, `SpeechModule.VERSION`), kernel API level 1 (`SpeechModule.API_LEVEL`).

Tests (`:lib-speech:testDebugUnitTest`, pure, fake provider): `SpeechPlayerTest`, `SpeechPartsTest`. Written without a compiler: CI compiles it.

Web: `framework/core/speech-web.ts` — `WebSpeechProvider` (SpeechSynthesis, guarded when it is missing), `createSpeechProvider()`, `SpeechPlayer`, `SPEECH_COMMANDS` / `speechCommandEvent`.
