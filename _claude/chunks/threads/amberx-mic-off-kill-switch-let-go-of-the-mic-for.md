<!-- memory-chunk@1 source=_claude/THREADS.md lines=144-144 tokens=276 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| AmberX Mic off kill switch + let go of the mic for other apps (Brett: "turns the green dot off my phone"; Claude voice call couldn't get the mic) (headless, Opus) | done (branch pushed; Brett lands it with build_land) | `claude/amberx-mic-kill` | — | Native `MicGuard` (one gate: wake listener, classic loop, one-shot, Speak, recorder mic), quick-settings tile "AmberX mic", Mic off/on on the notification; page gate `micguard.ts` (getUserMedia + SpeechRecognition); Home switch, banner chip, toolbar, menu, Settings; hands-free yields to calls/VoIP/other apps and comes back. Cause: always-on wake listener never yielded + `02e951c2` re-sends voice config on every sound/device change (re-grabs). test.mjs 2192/2192, tsc, vite, theme, controls, validate green; JUnit MicRulesTest in CI. **New APK required** (Android CI dispatched on the branch, run 41328213281 → `amberx-debug.apk`). Shots in the report folder (not sent to UI Review: no console token here). Report `_claude/builds/reports/amberx-mic-kill.md` | 2026-11-01 |
