<!-- memory-chunk@1 source=_claude/THREADS.md tokens=252 -->
### Agent pick (`agent-pick`, Urgent, Opus) — branch `claude/agent-pick`
- **Asked (Brett, Nov 3 2026, voice):** every Claude session (voice/chat Amber, Claude Code, headless) runs AS an agent Brett assigns; Assign to Claude, agent picker with every stat, session-start approval (console pop-up + axHub + push), booking on the agent's card, persona/voice, rule in RULES.md + CLAUDE.md, zero tokens.
- **Done:** all 9 steps; plugin `apps/console-web/plugins/claude-session`, swarm `axf.crew@1` + `swarm.mjs crew|book` + slot `swarm.agent.actions`, rule lines, report, shots.
- **Left:** PR merge (automatic) and Brett's UI Review. Follow-ups: book the final cost from the codebase-changes Stop hook; route asks through follow-amber when it lands; claude-settings to list the three settings.
- **Checks:** `python3 apps/console-web/plugins/claude-session/test.py`, `node <console plugins>/agent-swarm/test.mjs`, `node framework/cli/plugin-lifecycle.mjs check claude-session`. <!-- axf-plugin:claude-session -->
