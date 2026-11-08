<!-- memory-chunk@1 source=CLAUDE.md tokens=382 -->
## Session start: ask the orchestrator what to load

This file stays small. Everything else is in the chunked memory store, and you load only what the work needs:

1. `node framework/cli/memory-load.mjs` (the SessionStart hook runs it): the builds the orchestrator says were
   started in the last 24 h and stopped unfinished, with their next step, branch, PR and the memory chunks about
   them. Builds data belongs to the orchestrator (`_claude/builds/store.json`), not to memory.
2. `_claude/chunks/INDEX.md`: one line per chunk (rules, THREADS rows, Status entries, decisions, docs, the project
   guide). Grep it for the feature you are on (or `node framework/cli/memory-chunks.mjs find <text>`) and read only
   those chunks (`_claude/chunks/<id>.md`).
3. Before acting, read Claude settings (`node apps/console-web/plugins/claude-settings/claude-settings.mjs get`, or MCP `claude_settings_get`) and follow them. <!-- axf-plugin:claude-settings -->

The long guide that used to be here (stack, layout, build/run/test commands, conventions, related repos, working with
Brett) is `_claude/memory/docs/project-guide.md`, chunked as `memory-docs-project-guide/…`. The chunks are generated:
edit the source file, then `node framework/cli/memory-chunks.mjs build` and commit. Memory files, and what reads and
writes each one, are managed in the console's Memory Manager (`/#/memory-manager`). <!-- axf-plugin:memory-manager -->

Headless builds load no CLAUDE.md at all (their brief is everything; build `brief-only-headless`).
