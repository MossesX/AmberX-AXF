<!-- memory-chunk@1 source=_claude/memory/handoff-2026-11-01.md lines=17-22 tokens=259 -->
## 2. Where the truth lives (read these, don't trust chat memory)
- `_claude/THREADS.md` (per-thread "To carry on"), `STATUS.md`, `_claude/shared/rules/RULES.md`, decisions logs, `install_steps.md` (Parts A–M), `_claude/builds/reports/*.md` (one report per build).
- Orchestrator: `_claude/builds/profiles/<profile>/orchestrator.json` — profiles `refactor` (main), `angel`, `breakroom`, `urgent`. CLI: `AXF_BUILD_PROFILE=<p> node apps/console-web/plugins/build-orchestrator/orchestrator.mjs list|next|brief|act`. Read-only view: axHub `vps.check name=orchestrator`.
- One builds store (urgent-builds, merged 2a057cc4) — Plan/Tracker/Queue/Pending/Orchestrator data is merged; orch-sync bridge retired.
- Headless builds: axHub `vps.build_start` (name, repo AmberX-AXF|axHub, brief, model). Folders /root/axf-builds/<name>, branch claude/<name>, tmux axf-<name>, log <name>.log. Land with `vps.build_land` (union-merges notes files; real clash → branch only). Status: `vps.build_list`, `vps.check builds|build_log|git_main|git_branch`.
