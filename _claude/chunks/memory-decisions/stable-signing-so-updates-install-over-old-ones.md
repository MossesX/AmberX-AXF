<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=53-55 tokens=55 -->
## Oct 20 2026 — App catalog on axHub (app-catalog@1)

- Stable signing so updates install over old ones: GitHub secret `ANDROID_DEBUG_KEYSTORE` (base64 of a debug keystore). Without it each CI runner signs differently.
