<!-- memory-chunk@1 source=_claude/THREADS.md lines=168-168 tokens=217 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| **One build: `refactor-all`** (every unfinished Refactor step in one build, matrix `refactor-all`) | done (merged + deployed Oct 29 02:40 EDT) | `claude/refactor-all` | [#166](https://github.com/MossesX/AmberX-AXF/pull/166), [#168](https://github.com/MossesX/AmberX-AXF/pull/168) (voice wake), axHub [#18](https://github.com/MossesX/axHub/pull/18) — all merged | Console, AXHub web, Patches web, the hub and AmberX web all redeployed; `vps.run`/`logs` on the veto policy (Vinnie). AmberX Dockerfile fix e74303f2 (copy emptyState.tsx). Note: /opt/amberx-web pulls from the /opt/axf mirror, not GitHub — a fresh main reaches it only after /opt/axf updates. Left for Brett: install the new AmberX APK (CI artifact app-apks / hub Apps page); first run downloads the Vosk model | 2026-10-29 |
