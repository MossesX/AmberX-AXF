<!-- memory-chunk@1 source=_claude/memory/docs/amberx-voice-wake.md tokens=201 -->
## The model

- `vosk-model-small-en-us-0.15` (~40 MB zip), from `WakeListener.MODEL_URL` (the only place the address lives).
- Downloaded once on first use into `files/vosk/vosk-model-small-en-us-0.15/` (marked `.ready`) with progress on the overlay
  (**MODEL n%**) and on the Voice page. Then it is loaded once per process. The APK stays small.
- Safety: the download is capped at 200 MB and every zip entry must stay inside the folder.
- If it fails (no network, say), the chip says **NO MODEL** with the reason, and it tries again in 5 minutes.
  Hands-free stays silent until then. Switching to Classic listens without the model (with the tone).
- Gradle: `com.alphacephei:vosk-android:0.3.47@aar` + `net.java.dev.jna:jna:5.13.0@aar` (Maven Central, the way the Vosk Android demo pulls them in).
