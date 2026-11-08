<!-- memory-chunk@1 source=_claude/THREADS.md tokens=246 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Crew retrain (Breakroom `crew-retrain`, Opus, 8 steps; Brett Nov 3, voice: "retrain, don't fire"; booked on Landin' Lenny): every crew agent an all-rounder (job-type@1 `skills`, agent@1 `skills` "*" + `home`), new job types `feature-build` + `ops-fix`, router = any free agent (home job, least busy, round the crew), every headless launch booked on a named agent before it starts (`claude-headless.sh` → `agent-job.mjs book`, tmux `axf-<slug>--<agent>`, `# agent` log line), `agent-job.mjs assign`, today's 13 builds back-assigned, Breakroom cards show skills / home / now + Who's free | review (all 8 steps done; PR open; UI Review waiting) | `claude/crew-retrain` | [#265](https://github.com/MossesX/AmberX-AXF/pull/265) | Land last: land-everything is landing PRs, pick this one up after the rest. Report `_claude/builds/reports/crew-retrain.md`. Brett: UI Review (Breakroom cards + Jobs) | 2026-11-03 |
