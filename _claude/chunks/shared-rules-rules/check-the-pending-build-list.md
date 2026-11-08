<!-- memory-chunk@1 source=_claude/shared/rules/RULES.md tokens=103 -->
## Before building anything

- **Check the pending build list** before building. Builds parked until their model is available are listed in AmberX-AXF (`node framework/cli/pending.mjs`, MCP `pending_list`, console → Pending builds) and on the claude.ai Pending Builds page (https://claude.ai/artifact/HTwGSP7HcEt5yBd3MNz2Ye, db collection `builds`). "Add it to the pending list" means park it, don't build it.
