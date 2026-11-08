<!-- memory-chunk@1 source=_claude/memory/handoff-2026-11-01.md lines=35-43 tokens=288 -->
## 5. Next up (in order)
1. Land build-start-fable (or do it by hand) so Fable can be launched.
2. Write "Opus or Fable only, never Sonnet; Fable for foundation work" into `_claude/shared/rules/RULES.md`.
3. **Fable review pass** (review first, rebuild only what Fable flags) of Opus-built foundation work: one builds store (urgent-builds), UI Review schema, help@1 / help mode, job-type@1 / agent jobs, session@1 / chat viewer, agent swarm (agent-swarm-fable-rebuild 0/7 already pending), plus whatever of #4 gets finished. Put them on the Fable rebuilds list.
4. Resume the six stopped builds (Fable where marked).
5. **AmberX mic bug**: since this morning AmberX holds the microphone so Claude voice calls can't use it (Brett had to close AmberX). Likely from recorder-mic or the listeners change going live via the 5-min auto-update. Fix: release the mic when another app/call needs it (audio focus), never hold it while idle.
6. New AmberX APK from the listeners fix — confirm Brett installed it; if the screen is still black / "note saved" loops, it's still broken.
7. Stale branch `batch/amberx-axf-1031-0505` (267 behind) — delete or ignore.
