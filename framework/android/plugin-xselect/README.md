# X Select (plugin)

**Read aloud** next to Select all in every app on the phone. A plugin@1 module plugin (`ai.amberx.axf.plugin.xselect`, built on Opus, Oct 24 2026), not tied to an app yet.

## Add it to an app

```kotlin
// app/build.gradle.kts
implementation(project(":plugin-xselect"))     // or ai.amberx.axf:plugin-xselect:$axf
// App.kt → modules()
SettingsModule(), ReadAloudModule(this, settingsPrefix = null), SelectionModule(), XSelectModule(this)
```

The plugin's manifest brings the menu entries (one activity + seven activity-aliases), lib-readaloud brings the playback service and its permissions. Nothing to add to the app's manifest.

## What it does

- **Menu entries** (`menu.ReadAloud` / `ReadOutLoud` / `Speak` / `Listen` = the chosen label, plus optional `ReadSlowly`, `ReadNext`, `SpellOut`), switched on and off from settings at run time (`SelectionMenuEntries`).
- **ReadAloudActivity**: translucent, gone at once; waits for the app's settings on a cold start, optional "ask first" for long text, start note / vibration / chime, then `ReadAloud.read(…)`. Reading keeps going in the foreground service with notification controls.
- **Screen `xselect`** (settings only): toolbar (test voice, pause/resume, stop, slower, faster, read clipboard, check axHub, reset voice settings), live banner (the piece being read with the word highlighted, progress, time left, queue), axHub status badge, sections + search over every setting, installed engines and voices to pick, recently read.
- **Banner badges** on the app's banner: axHub status (green up / amber signed out / red unreachable / count of approvals waiting; checked every N minutes, or lib-hub's last reading) and Reading (speed, paused). Origin = the plugin, so `detachAll` removes them.
- **Settings**: Settings → Plugins → X Select, 13 groups / 81 settings (X Select menu, Voice, Speed & pitch, Pauses, Text cleanup, Reading in pieces, Queue, Sound & interruptions, While reading, Timers & recovery, Feedback, Banner & badge, Look). Read-aloud keys are `xselect.<name>` (`ReadAloudKeys("xselect.")`).
- **Actions**: `xselect.open|test|stop|toggle|clipboard|hub`; counter `xselect.reading`.

Pure rules (`XSelectRules.kt`) are tested by `XSelectRulesTest`. Android parts were written without the Android compiler (CI compiles them).
