<!-- memory-chunk@1 source=_claude/THREADS.md tokens=226 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| AmberX: one listener, no repeat "Note saved", no ding loop (proven from hub notes: AmberX re-saving its own mis-heard "Note saved to Inbox" via always-armed + AI notes; Android replaying retained wake events on open; Chrome hands-free restarting with its ding) — one owner per device, handled event ids, Quiet switch, Sound and microphone settings (Opus) | done (pushing to main) | `claude/amberx-listeners` | — | AmberX test.mjs 2045→2101, veto banner 11/11, tsc + vite build, theme/controls/pages/validate green. Shots in UI Review → Screenshots "AmberX listeners - Nov 1". Install the new APK (CI `amberx-debug.apk` → hub Apps). Waiting on Brett: go to delete 122 duplicate loop notes (dry run `_claude/builds/reports/amberx-listeners-notes-dryrun.md`). Report `_claude/builds/reports/amberx-listeners.md` | 2026-11-01 |
