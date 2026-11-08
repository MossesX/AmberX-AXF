<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=160-160 tokens=177 -->
## Status (as of Oct 21 2026)

- **Crew plugin (Nov 3 2026, Opus, build crew-live, Ping Paulie):** `apps/console-web/plugins/crew-live` (`ai.amberx.axf.console.crew-live`), nav → Builds → **Crew**: every agent working right now, live over SSE (`GET live`), from headless stream logs, `axf.headless@1` (new, Terminal plugin: tmux list, meters, kill), `axf.swarm-roster@1` (new, agent swarm), the builds store and git; expanded rows show the live diff vs the build's base. Commands `agents`, `agent`, `files`, `diff`, `stop` (REST + MCP + CLI). Framework `AgentAvatar` + `agent-avatar` asset + agent directory; `agent` context menu. Zero tokens (test). Self-test `test.py` (55). <!-- axf-plugin:crew-live -->
