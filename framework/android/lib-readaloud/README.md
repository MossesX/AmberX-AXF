# lib-readaloud

Read any text aloud from anywhere in an AXF Android app.

```kotlin
ReadAloud.configure("myplugin.") { key -> config.string(key) }   // where the prefs live
ReadAloud.read(context, text, title = "Article")                  // foreground playback, keeps going
ReadAloud.state.collect { it.utterance; it.word; it.paused }      // live state for screens
ReadAloud.toggle(context); ReadAloud.next(context); ReadAloud.stop(context)
ReadAloudSettings.groups("myplugin.", tab = "myplugin", module = id)  // nine settings groups, 54 settings
```

- **ReadAloudService** (foreground, `mediaPlayback`): one TextToSpeech engine, queue, pauses between pieces (silent utterances), audio focus, headphones / screen-off / sleep timer, notification with controls. Brings its own permissions and service in the library manifest.
- **Pure Kotlin** (tested by `ReadAloudRulesTest`): `ReadAloudPrefs` + `ReadAloudRanges` + `ReadAloudKeys`, `TextPrep`, `TextChunker`, `ReadQueue`, `ReadAloudPlan`.
- **ReadAloudModule(context, settingsPrefix, settingsTab)** provides `axf.readaloud` and the actions `readaloud.stop|toggle|next|previous|faster|slower`.

Placeholders: `axf.readaloud.media-session`, `axf.readaloud.save-audio`, `axf.readaloud.web`. First user: the X Select plugin (`framework/android/plugin-xselect`).
