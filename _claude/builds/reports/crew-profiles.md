# crew-profiles: every employee gets a full agent profile

Build `crew-profiles` (Current profile, Opus, booked on Reel Rhonda). Branch `claude/crew-profiles`.

## What Brett said
> I want all the employees to have persona sections and skills and tools and all that, just like the agents and the agent manager.

Addenda: agents and employees are one thing with job titles (Agent manager agents = Assistant); Crew window containers
show the crew card and the ID card and collapse to avatar + name; once working, stay at the top.

## What changed
- **One roster (crew-profile@1)**: `apps/console-web/plugins/agent-swarm/crew-profiles.mjs` builds every member from the
  roster, swarm state, profile seed (`agents/profiles.json`) + per-section edits (data folder `profiles.json`), the
  Agent manager's agents (axf.agents@1, linked as **Assistant**, not copied) and write-ups from shared memory.
  Sections: persona, role + duties, tagged skills, tools allow list, model (Opus/Fable only), memory, safety, hourly
  pay, stats (jobs, cost, strikes, write-ups), avatar, reports to. Owner-only: pay, tools, safety, job title.
- **Roster**: added Marco (VP), Amber (Chief Architect), Patches (Orchestrator), Gizmo (Companion & Guide, $8.00/h),
  Polo, Conrad (Librarian), Chachi (Front Desk, she/her), Brownie (QA Inspector), Ashes (Security), Jennifer (Lunch
  Lady). Titles for the existing crew: Lander, Site Checker, Walkthrough Producer, Custodian, Screenshot Runner,
  Listener QA, CI Fixer. Brett = Boss (owner, not on payroll). Molly and Vinnie are not crew. Everyone $7.50/h minimum.
  Existing stats kept (runtime state untouched).
- **Interfaces**: CLI `swarm.mjs crew-list|crew-get|crew-update`; REST `GET/PATCH /api/plugins/agent-swarm/crew[/{id}]`
  and the Crew plugin's `members[/{id}]` (plugin commands); MCP `crew_list`, `crew_get`, `crew_update` (never owner).
  `axf.crew@1` gains `profiles()/profile()/update()`; `crew()` rows carry `jobTitle` + `personaLine`, so the agent
  picker shows job titles and `claude_session` falls back to the profile persona.
- **Crew window**: opens on Crew cards: one collapsible container per member (collapsed = avatar + name + dot + title;
  open = Crew card / ID card (framework AgentCard) / Profile tabs, editable). Working on top, longest-running first,
  live reorder with a short slide, held while touching/scrolling. Expand all / Collapse all, open state per member,
  default working open (setting under Settings → Plugins → Crew). The old run grid is the Table view.
- **Agent manager**: new Roster tab (same roster through axf.crew@1), collapsible, Edit profile → `crew.profile`.
- Rule written in `_claude/rules/RULES.md`.

## Tests
- agent-swarm `test.mjs`: 100 → 111 checks (crew roster, titles, pay floor, Molly out, assistants linked, owner-only,
  model policy, persona merge, working on top). Shared-home routing test generalised (several all-rounders share a home).
- crew-live core-check 20 → 24; crew-live test.py 57/57; claude-session 57/57; agent-manager 176/176; MCP tools 189 checks.
- `tsc --noEmit` clean; check-theme, check-controls, check-toolbars, plugin-lifecycle, plugin-commands, help-coverage pass.
- `plugins.mjs --check` fails on main already (asset-browser pending/plan item), not touched here.

## Gaps
- Breakroom (agent-swarm web) still lists only roster agents (no Assistants) in its own grid; its profile drawer is unchanged.
- The Agent manager's own Agents tab still lists a Molly agent where the add-on is installed (the roster leaves her out);
  swapping her guide duties to Gizmo in molly-guide / AmberX is the follow-up named in shared memory.
- Group chat lines (bugs-board handoffs) can read `personaLine` from `axf.crew@1`; bugs-board isn't on main, not wired here.
- Hourly pay is recorded on the profile; the weekly token budget (`salary`) is unchanged.
