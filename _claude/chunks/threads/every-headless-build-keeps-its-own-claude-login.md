<!-- memory-chunk@1 source=_claude/THREADS.md lines=42-42 tokens=150 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Every headless build keeps its own Claude login (Current `build-own-login`, Opus; Brett Nov 5 voice: "Yeah, it should be like that already."): per-build `CLAUDE_CONFIG_DIR` copy of the active saved account (`deploy/claude-login.mjs`), inherited OAuth token dropped, account recorded (log, tmux tag, event, build note), `--account` per launch, swarm runner too | built, in the merge queue | `claude/build-own-login-r2` | (see Live build log) | Report `_claude/builds/reports/build-own-login.md`. Brett: none | 2026-11-05 |
