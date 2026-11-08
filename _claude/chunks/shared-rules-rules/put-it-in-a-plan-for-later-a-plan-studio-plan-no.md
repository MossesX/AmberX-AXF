<!-- memory-chunk@1 source=_claude/shared/rules/RULES.md tokens=177 -->
## Before building anything

- **"Put it in a plan for later" = a Plan Studio plan, not a build (Oct 30 2026, Brett):** when Brett says to put something in a plan for later (or "plan it", "save it as a plan"), it becomes a **parked** plan in Plan Studio (plan@1, console → Builds → Plan Studio; CLI `node apps/console-web/plugins/plan-studio/plans.mjs add "<title>" --status parked --category "A > B"`; claude.ai: `axhub.memory_write` project `amberx-axf`, area `data`, path `plan-studio/plans/<id>.json`; server parts: capability `plans@1` `park()`), never an orchestrator build or a pending item. It only becomes a build when Brett says so (Plan Studio → Turn into a build). <!-- axf-plugin:plan-studio -->
