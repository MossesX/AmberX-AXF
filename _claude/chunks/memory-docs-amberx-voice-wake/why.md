<!-- memory-chunk@1 source=_claude/memory/docs/amberx-voice-wake.md lines=5-15 tokens=151 -->
## Why

Brett (Oct 29 2026, 01:13 EDT): "AmberX voice control constantly triggers tone but ActiveX doesn't — make it like ActiveX."

AmberX's hands-free mode restarted Android's `SpeechRecognizer` every few seconds, and every start plays the system
tone. Muting streams (the Oct 28 voice fix) only helped on some phones and muted notifications for as long as hands-free ran.
ActiveX idles on Vosk instead: offline, continuous, matching text phrases, no tone.

Brett chose the hybrid: a silent offline wake listener runs the whole time, and Google's recognizer runs for one
utterance only after a trigger.
