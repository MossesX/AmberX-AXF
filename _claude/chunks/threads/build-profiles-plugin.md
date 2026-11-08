<!-- memory-chunk@1 source=_claude/THREADS.md tokens=190 -->
### Build profiles + plugin
- Asked (Brett, Oct 27 2026): "Create multiple build profiles and a console plugin to select and save one. Each build profile holds plans, build queue, pending builds, tracking, and all work stuff. Name current one main framework and then start new one called refactor."
- Model Opus. Branch `claude/build-profiles`, all 4 orchestrator steps done (orchestrator build `build-profiles`, pending `build-profiles`).
- Left: CI green → merge → console redeploys itself. Checks: `python3 apps/console-web/server/test_build_profiles.py`, `node framework/cli/profiles.mjs`.
- First message: "Carry on thread Build profiles: check PR for branch claude/build-profiles, merge when CI is green, then confirm the console shows the profile chip."
