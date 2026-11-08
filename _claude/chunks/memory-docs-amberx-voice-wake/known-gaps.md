<!-- memory-chunk@1 source=_claude/memory/docs/amberx-voice-wake.md lines=80-88 tokens=155 -->
## Known gaps

- The Java has only had a parse-level `javac` check here (no Android SDK or Maven access). CI compiles it and runs WakeRulesTest.
  The Vosk API used: `Model(String)`, `Recognizer(Model, float[, String])`, `acceptWaveForm(short[], int)`,
  `getResult` / `getPartialResult`, `close`, `LibVosk.setLogLevel`.
- English model only (other `lang` values still use it for the wake phrase; Google hears the command in the chosen language).
- Wake phrase words the small model doesn't know are skipped by Vosk. "amberx" itself is covered by the spelled-out variants.
- The model download doesn't check for Wi-Fi.
