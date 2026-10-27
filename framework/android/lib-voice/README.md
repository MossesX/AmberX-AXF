# lib-voice (0.3.1)

Voice for any AXF Android app: speech in, spoken prompts out, and voice commands whose trigger phrases the user can change.

```kotlin
// App.kt
override fun modules() = listOf(/* … */ VoiceModule(this), AppModule())

// in a module's register()
val voice = ctx.require<AxfVoice>()
voice.commands.register(VoiceCommand("notes.new", "New note", defaults = listOf("new note", "take a note"), group = "Notes"))

// anywhere in a coroutine
when (val h = voice.ask("What should the note say?")) {
    is Heard.Text -> h.alternatives          // most likely first
    Heard.Silence -> …
    is Heard.Failed -> h.message
}
voice.commands.match(h.alternatives, among = listOf("notes.new"))  // → CommandMatch or null
```

- **AxfVoice** (`axf.voice` service): `commands`, `input` (`SpeechInput`), `speaker` (`Speaker`), `ask(prompt, secret)`, `ensureMic()`.
- **SpeechInput.listen(ListenOptions)**: one utterance, main thread, cancellable. `secret = true` uses the on-device recognizer on API 31+ when present and never asks for partial results.
- **Speaker.say(text)** returns when speech has finished, so the next listen never hears the phone. Since 0.3.1 it runs on lib-speech's `AndroidTtsProvider` (speech@1, `speaker.provider`); reading queues, spoken controls and the Speech settings live in lib-speech.
- **VoiceCommands**: open registry; user phrases persisted in the kernel KV store (`axf.voice.triggers`). A phrase belongs to one command; a command always keeps one phrase.
- **SpokenText**: pure Kotlin field normalisers: `site("Gmail dot com")` = `gmail.com` (drops `www.`), `password` (trimmed, kept as heard), `code` (words only, case and punctuation ignored: use it on both save and check of spoken codes).
- **PhraseMatcher**: pure Kotlin (`normalize`, `triggerScore`, `labelScore`, `best`, `ranked`); "gmail dot com" = "gmail.com" = "gmail".
- **VoiceTriggersScreen()**: route `voice-triggers` (Settings → Voice → Voice triggers): record, type, switch defaults off/on, reset.
- Settings group **Voice**: speak prompts, prefer on-device recognition, speech language.
- Manifest pieces come from the library: `RECORD_AUDIO` and the recognizer/TTS package queries.

## Continuous listening (0.3.0)

Everything above is unchanged (Voice Vault keeps working as is). New: engines that listen until stopped, for dictation and hands-free commands.

```kotlin
val voice = ctx.require<AxfVoice>()

// dictation: runs across pauses until the stop phrase ("end note" by default), then stops the engine
voice.dictate().collect { e ->
    when (e) {
        is DictationEvent.Partial -> show(e.preview)          // transcript + words being spoken
        is DictationEvent.Segment -> save(e.transcript)
        is DictationEvent.Dropped -> {}                       // below the sensitivity floor
        is DictationEvent.Ended -> done(e.transcript, e.reason) // END_PHRASE or FAILED (+ message)
    }
}

// hands-free commands: arming phrase (or always armed) + timeout, then match with the command registry
val engine = voice.engine()
val arming = VoiceArming(voice.armingConfig())
scope.launch {
    engine.results.armedBy(arming, voice.sensitivity).collect { d ->
        if (d is ArmingDecision.Pass) voice.commands.match(listOf(d.text))?.let { run(it) }
    }
}
engine.start(voice.engineOptions())   // … engine.stop() when done
```

- **VoiceEngine** (pure contract): `kind`, `available`, `state: StateFlow<VoiceEngineState>` (Idle / Loading / Listening / Failed), `results: SharedFlow<VoiceResult>` (`text`, `confidence` 0..1, `final`, `alternatives`, `atMs`; partials carry `VoiceResult.UNSCORED`), `echoCancelActive`, `start(VoiceEngineOptions)`, `stop()`, `close()`. `VoiceEngineOptions`: `language`, `sensitivity`, `echoCancellation`, `noiseSuppression`, `partials`.
- **VoskVoiceEngine** (default, `VoiceEngineKind.VOSK`): on-device Vosk on a 16 kHz AudioRecord, 100 ms frames, final confidence = mean word confidence. Model from `VoskModelSource` (`assetDir` default `model-en-us`, unpacked once to `unpackDir`; or `path` to an unpacked folder). Pass a different source with `VoiceModule(this, VoskModelSource(…))`. Vosk uses whatever model is installed; `language` is ignored by it. Listens only while started: background listening needs the app's own microphone foreground service.
- **Placeholders**: `AndroidRecognizerVoiceEngine` (`axf.voice.engine.android`), `CloudVoiceEngine` (`axf.voice.engine.cloud`); `PlaceholderVoiceEngine` base. Never available, `start` returns false with a Failed state.
- **dictate** (`VoiceEngine.dictate(options, endPhrases)` / `AxfVoice.dictate()`): `Flow<DictationEvent>`; the stop phrase counts only as the last words of a final utterance ("buy milk end note" ends, "the end note of the song" doesn't). Pure parts: `EndPhrases.find/parse`, `DictationAssembler`.
- **VoiceSensitivity**: slider 0..1 → `confidenceFloor` = `1 - s` (slider held to 0.05..0.95, floor to 0.2..0.9); `passes(result, s)` (partials always pass); `parse(stored)`.
- **MicEffects**: platform `AcousticEchoCanceler` / `NoiseSuppressor` when available, VOICE_COMMUNICATION mic source when echo cancellation is on.
- **VoiceArming** (pure state machine, time passed in): `ArmingConfig(phrases, alwaysArmed, timeoutMs, extendOnUse)`; `onHeard(text, nowMs)` → `Ignored` / `Armed(untilMs)` / `Pass(text, untilMs)`; `arm`, `disarm`, `isArmed`, `remainingMs`. "hey notes read it back" arms and passes "read it back" at once; each passed command restarts the timeout; timeout 0 = only the rest of that utterance; capped at 120 s. `Flow<VoiceResult>.armedBy(arming, sensitivity)`.
- Settings group **Voice listening** (`voice-listening`, `VoiceModule.listeningGroup()`): engine, sensitivity (slider), echo cancellation, noise suppression, always armed, arming phrase(s), stay armed (seconds), stop dictation phrase(s). Keys `AxfVoice.ENGINE`, `SENSITIVITY`, `ECHO`, `NOISE`, `ALWAYS_ARMED`, `ARM_PHRASE`, `ARM_TIMEOUT`, `END_PHRASES`; read them through `voice.engineOptions()`, `voice.armingConfig()`, `voice.endPhrases`.
- Ported from Brett's ActiveX app (VoiceDetector, the mic loop of its detection service, its voice settings), generalised.

### Shipping the Vosk model

The library brings the Vosk + JNA dependencies, not the ~40 MB model. An app that uses `VoskVoiceEngine` adds the model to its own `src/main/assets/model-en-us` with a `uuid` file; this task in the app's `build.gradle.kts` fetches it once (from ActiveX):

```kotlin
val voskModelDir = layout.projectDirectory.dir("src/main/assets/model-en-us")
val fetchVoskModel by tasks.registering {
    val dir = voskModelDir.asFile
    outputs.dir(dir)
    onlyIf { !File(dir, "uuid").exists() }
    doLast {
        val name = "vosk-model-small-en-us-0.15"
        val zip = File(temporaryDir, "$name.zip")
        java.net.URL("https://alphacephei.com/vosk/models/$name.zip").openStream().use { i -> zip.outputStream().use { o -> i.copyTo(o) } }
        dir.deleteRecursively(); dir.mkdirs()
        java.util.zip.ZipInputStream(zip.inputStream()).use { zin ->
            generateSequence { zin.nextEntry }.forEach { e ->
                val rel = e.name.removePrefix("$name/")
                if (rel.isBlank()) return@forEach
                val out = File(dir, rel)
                if (e.isDirectory) out.mkdirs() else { out.parentFile.mkdirs(); out.outputStream().use { zin.copyTo(it) } }
            }
        }
        File(dir, "uuid").writeText(java.util.UUID.randomUUID().toString())
    }
}
tasks.named("preBuild") { dependsOn(fetchVoskModel) }
```

Without the model `VoskVoiceEngine.available` is false and `start` fails with a message.

Tests: `VoiceListeningTest` (sensitivity mapping, arming state machine, stop-phrase detection, dictation assembler, placeholders) runs in CI with `:lib-voice:testDebugUnitTest`. Written without a compiler.

Not built (declared placeholders in `library.json`): always-on wake word service, speaker identification, the phone-recognizer and cloud engines. The app listens only while it is open (or while its own foreground service runs an engine).
