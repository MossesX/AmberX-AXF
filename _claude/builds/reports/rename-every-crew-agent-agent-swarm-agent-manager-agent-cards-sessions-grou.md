# Crew takes cat names

Build `rename-every-crew-agent-agent-swarm-agent-manager-agent-cards-sessions-grou`, Phase 1, Opus, Nov 17 2026.
Branch `claude/rename-every-crew-agent-agent-swarm-agent-manager-agent-cards-sessions-grou`.

## Result

Every crew agent in the Agent Swarm now has a cat name from Brett's name pool. Ids did not change, so branches,
tmux sessions, swarm state, pay, history and section owners all still work. The orchestrator's chat voice "Boss" is
now **Patches** (Brett's Nov 3 org chart: Patches runs the floor).

| id | New name | Was |
|---|---|---|
| kat | Kit Kat | Kotlin Kat |
| rio | Pixel | Rio React |
| py | Byte | Py Pete |
| manny | Widget | Manny Fest |
| tia | Velvet | Tia Theme |
| tex | Glitch | Tex Tester |
| doc | Merlin | Doc Holli |
| max | Velcro | Merge Max |
| rhonda | Shadow | Reel Rhonda |
| paulie | Comet | Ping Paulie |
| sully | Snickers | Snap Sully |
| lenny | Sir Pounce | Landin' Lenny |
| joey | Dusty | Janitor Joey |
| earl | Whiskers | Earl the Ear |
| gina | Olive | Greenlight Gina |
| gizmo | Gizmo | (kept) |
| boss | Patches | Boss |

## The name pool

The brief had no list attached. It came from Brett's Nov 7 notes in AmberX Notes ("Name pool", "Name pool: cats
only", "Name pool: 100 more cats"): 39 + 50 + 100 = 189 cat names, plus his own kept names (Amber, Molly, Patches,
Brownie, Gizmo, Ashes, Marco, Polo, Jasmine, Cole, Ciocia, Jennifer). The "cats only" note dropped the people
names. Everything is in `apps/console-web/plugins/agent-swarm/agents/name-pool.json`, with `taken` (who has which
name; taken names are crossed off, never removed) and `formerly` (old names).

## Where the names show

- Agent Swarm roster, agent cards, ID cards, Crew tab, profile pages: from `roster.json`.
- Group chat: speaker names are worked out when a message is read, so old messages show the new names. Old message
  *text* is left as it was written.
- Section owners board and crew-say posts: roster names.
- Sessions, Terminal tabs, build rows, UI Review avatars: the agent directory. Old names are published as aliases,
  so old "Agent: Ping Paulie" lines in builds and briefs still find the agent.
- Claude agent picker (claude-session): finds agents by id, new name or old name. A saved default by old name still
  works.
- Agent briefs, lease column, chat empty state: say Patches.

## API

- CLI: `node apps/console-web/plugins/agent-swarm/swarm.mjs names [--json]`.
- REST: `GET /api/plugins/agent-swarm/names`; `names` is also in `GET …/state`.
- control@1 (plugin-commands auto, from the GET route): MCP tool `agent-swarm_names`, REST
  `/api/control/agent-swarm/names`, CLI `axf agent-swarm names`; voice reaches it the same way as every other plugin
  command. Not checked against a live console: that needs this branch deployed.
- Renaming one agent without a file edit: its ID card name (`act` `identity`), same as before.
- Deep link: Builds → Agent swarm (unchanged).

## Not done, and why

- **Agent Manager chat agents not renamed:** Vinny (axHub's approval bot; axHub is a separate repo and still says
  Vinnie), Mosses (the coder persona, hundreds of references) and the AI/AXF experts. They are Agent Manager chat
  agents, not swarm crew, and Molly is one of Brett's kept names. Easy follow-up if Brett wants it.
- **No new hires:** Marco, Polo, Brownie, Ashes and Jennifer have roles in `_claude/shared/memory/naming.md` but no
  agent cards yet. They are kept in the pool. Hiring them is its own build.
- **Pool editor:** no HR UI for the pool in this build. The file is the source; the HR build reads it.
- **Android twin deferred** (Android on hold): recorded in `framework/spec/PORTING.md`.
- No screenshots: the live console runs main, so a shot would show the old names until this lands.

## Checks

agent-swarm test 109/109, check-swarm 232, check-agent-card 84, check-job-type 129, crew-live 59/59, claude-session
72/72, build-origin 21, crew-say check, plugin-lifecycle (agent-swarm, crew-live) clean, check-theme, check-controls,
console-web `tsc --noEmit` clean.
