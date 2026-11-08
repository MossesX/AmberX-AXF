<!-- memory-chunk@1 source=_claude/THREADS.md tokens=197 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Gizmo voice fix: talk mode starts, listens, no echo (`gizmo-voice` s3 + `amberx-voice-echo-fix` s1–s3, All, Opus; Brett Nov 7: "Gizmo inside AmberX won't turn on / isn't listening.") | built (committed, not pushed) | `claude/gizmo-voice-fix` | — | Root cause: talk mode + the wake one-shot let go of the mic on every audio-focus loss, and Google's recognizer takes focus itself (FocusRules fix); hands-free stuck yielded after a one-shot; Gizmo's speech bypassed the speech gate; "Note saved to Inbox" parsed as a note. test.mjs 2316/2316, FocusRulesTest 4/4. Next: push + PR into the merge queue, then Brett installs the CI APK and phone-tests. Report `_claude/builds/reports/gizmo-voice.md` | 2026-11-07 |
