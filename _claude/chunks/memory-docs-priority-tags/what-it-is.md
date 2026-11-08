<!-- memory-chunk@1 source=_claude/memory/docs/priority-tags.md tokens=136 -->
## What it is

Every build has a priority: **Urgent, High, Normal, Low** (P0-P3, the same levels Plan Studio uses). A small coloured chip shows it on the Build manager, Builds page, Build orchestrator, Build queue, Pending builds, Crew, Codebase changes, Plan Studio's build link, the Home build card, the agent queue and the merge queue. It reads `High · 3 waiting` when things wait on the build.

Tap or right-click the chip: change the level, and see **Waiting on this**. Each row opens and flashes the thing it names; a PR opens on GitHub.
