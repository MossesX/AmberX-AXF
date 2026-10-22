# lib-voice

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
- **Speaker.say(text)** returns when speech has finished, so the next listen never hears the phone.
- **VoiceCommands**: open registry; user phrases persisted in the kernel KV store (`axf.voice.triggers`). A phrase belongs to one command; a command always keeps one phrase.
- **SpokenText**: pure Kotlin field normalisers: `site("Gmail dot com")` = `gmail.com` (drops `www.`), `password` (trimmed, kept as heard), `code` (words only, case and punctuation ignored: use it on both save and check of spoken codes).
- **PhraseMatcher**: pure Kotlin (`normalize`, `triggerScore`, `labelScore`, `best`, `ranked`); "gmail dot com" = "gmail.com" = "gmail".
- **VoiceTriggersScreen()**: route `voice-triggers` (Settings → Voice → Voice triggers): record, type, switch defaults off/on, reset.
- Settings group **Voice**: speak prompts, prefer on-device recognition, speech language.
- Manifest pieces come from the library: `RECORD_AUDIO` and the recognizer/TTS package queries.

Not built (declared placeholders in `library.json`): always-on wake word service, speaker identification. The app listens only while it is open.
