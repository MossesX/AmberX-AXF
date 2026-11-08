<!-- memory-chunk@1 source=_claude/memory/docs/harvest/android-security.md lines=1-7 tokens=123 -->
# Harvest: android-security (Oct 20–21 2026, Opus)

Branch `harvest/h-android-security`. Harvest plan rows 1, 7, 8, 9 + the lib-voice / cleanup items. Kotlin written
without Gradle/Maven; the pure parts (LockGate, LockModeGuard, PersistedLockout, StoredSecret/SecretKind, PinHasher,
SpokenText) were compiled with kotlinc 2.0.21 (`-Xexplicit-api=strict`) and their tests run locally (21/21). Compose,
Android and app code is compiled by CI only: check the "CI build errors" issue after merge.
