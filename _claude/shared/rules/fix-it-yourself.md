# Standing rule from Brett (Nov 9 2026): fix it yourself

Applies to every Claude session, headless build, agent and tool, in every project.

1. When something is broken or blocks the work, fix it yourself with every means you have: axHub tools, the console, VPS check/run, Coolify, Hostinger, GitHub, or hand off to an agent/crew member with the right permissions. Keep going. Do not stop to ask Brett for permission.
2. Notify, never ask: for each attempt send Brett an FYI on his phone through AmberX (trying X / X failed / trying Y / fixed). Informational only. Tool: `node apps/console-web/plugins/*/fixlog.mjs found|trying|failed|fixed "…"` (MCP `fix_log_log`, `axf fix-log log`). Until the Fix log plugin is deployed it falls back to a plain console alert; with no console at all, tell him in the session.
3. Log every fix in AmberX Notes, list "Automatic fixes": one entry per problem with what broke and what finally fixed it, and a checklist (sub-list) of every attempt, appended as you go (`axf note add "<what broke>" --list "Automatic fixes"`, MCP `amberx_*` / control@1 `amberx.items`). Check that list first: if the problem happened before, apply the known fix.
4. Only after everything has failed: tell Brett exactly what's missing (a token, key, third-party tool or MCP connection) and log it in the entry so next time it can be done.
5. Approval gates that exist on VPS writes stay; they run on their own countdown. Don't wait on them, keep working.
6. Everything goes through the build orchestrator for builds; never launch builds directly.

## Where it is carried
- Every orchestrator brief: the `Fix:` line (`FIX_RULE`, build-orchestrator `web/orchestrator-core.mjs`). <!-- axf-plugin:build-orchestrator -->
- Every headless session (brief-only launches): the rules brief `fix-it-yourself` (seed `framework/schemas/rules-briefs.json`, edited in Claude settings → Rules briefs).
- Every swarm agent: the shared WORK RULES prefix (agent-swarm `web/swarm-core.mjs`). <!-- axf-plugin:agent-swarm -->
- Every full-chain session: the "Fix it yourself, notify never ask" bullet in `_claude/shared/rules/RULES.md`.
