<!-- memory-chunk@1 source=_claude/THREADS.md lines=128-128 tokens=279 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Agent cap + queue (agent-cap, Opus, headless; orchestrator `agent-cap` in Breakroom): configurable max running agents (6), heavy test/build lock (3), memory guard (2 GB), FIFO+priority queue that starts by itself, finished sessions auto-close; `framework/cli/agent-slots.mjs` + `deploy/claude-headless.sh` + swarm; `agent-slots` plugin (settings, banner chip, Builds-page queue, desks, systems-check item) | done (tests green) | `claude/agent-cap` → main | — | Report `_claude/builds/reports/agent-cap.md`; screenshots in UI Review → Screenshots, group 'Agent cap - Nov 1'. Gaps: heavy lock is opt-in per command (brief asks for it); banner chip shows only while the activity banner is up. Old finished `axf-*` tmux sessions close on the first launch after deploy. To carry on: in /root/axf-builds/agent-cap run `node framework/spec/check-agent-slots.mjs`, `python3 apps/console-web/plugins/agent-slots/test.py`, then `git fetch origin && git merge origin/main && git push origin HEAD:main` <!-- axf-plugin:agent-slots --> | 2026-11-01 |
