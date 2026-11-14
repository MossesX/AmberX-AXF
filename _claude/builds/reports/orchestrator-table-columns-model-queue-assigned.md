# orchestrator-table-columns-model-queue-assigned

PR: https://github.com/MossesX/AmberX-AXF/pull/680 · branch `claude/orchestrator-table-columns-model-queue-assigned` · Opus

Brett (Nov 10 2026): "You need to see what model it's getting built on, show its number in the queue, show the agent it's assigned to. It has to be assigned to an employee. If we don't have any builder employees, you have to hire one. Notify me if I want to hire somebody; if I approve it, you hire somebody new. Give them a persona, give them the tools and all that. You need to be able to train the employees with website data."

## Done
- Orchestrator grid and Build Manager: sortable Model, Queue #, Employee columns (avatar + name, opens the employee card). Data: read-only `run` on the orchestrator projection (`framework/plan/builds-store-core.mjs runOf`, `queuePositionsOf`); Build Manager `state` rows carry `model`, `queue`, `agent`.
- Builds are booked on builders only (employees who can take `feature-build`; `jobs-core route` `strict`).
- No builder free → one `hire-request@1` + guarded notification "Hire a new builder?" (`agent-swarm/notify.json` `hr.hire-request`, console + AmberX push), link `agent-swarm.hire-request:<id>` opens Approve / Deny in Breakroom → Crew. Only Brett decides (console click or axHub). Approve hires a builder (name, avatar, persona, voice, job category, tools, limits) and assigns the waiting build.
- Website training per employee: URL + crawl (≤ 20 same-site pages), stored under the plugin data folder, listed and removable, digest in job briefs.
- API: REST `/api/plugins/agent-swarm/hr/*`, plugin commands (MCP), `agent-job.mjs hire-*|train|knowledge|forget`, deep-link actions.

## Checks
build-orchestrator 36 · agent-swarm 114 · builds-store 40 · builds-live 68 · build-priority 8 · theme / controls / toolbars / chrome pass · help coverage 100% · tsc clean.

## Open
- UI Review shots (desktop + phone) and live verification: after merge (the session can't run this branch's console).
- Knowledge digest into headless build briefs (claude-headless.sh) not wired yet.
- Hire voice/category kept in `profiles.json`; an `agent@1` voice field is a kernel change (Fable + Kotlin twin), deferred.
- Earlier run ticked s1 without pushing code; this branch contains all of it.
