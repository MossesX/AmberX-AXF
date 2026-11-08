<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=98 -->
## Status (as of Oct 21 2026)

- **Module dependencies in the module list (Oct 21 2026, Opus):** `listModules()` (engine-rpc `modules`, console `GET /api/modules`) now gives each module `dependsOn` = the module names its `build.gradle.kts` pulls in with `project(":x")`; libraries already carry `dependsOn` in `libraries.json`. Build Pilot uses both to highlight what a picked feature needs.
