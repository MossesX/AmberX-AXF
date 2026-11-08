<!-- memory-chunk@1 source=_claude/THREADS.md lines=87-87 tokens=243 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Plugin commands, automatically (Urgent `plugin-commands-auto`; Brett Nov 3 voice): every plugin, existing and new, exposes all of its commands and reads through control@1 on REST `/api/control/<plugin>/<command>`, MCP `<plugin>_<command>` (+ `plugin_commands` / `plugin_read` / `plugin_run`) and CLI `axf <plugin> <command>`, made automatically from routes, actions, data folder and plugin.json `commands`; lifecycle check + CI enforce it. Opus. Base token-control-opus (#250) + console-commands (#249) merged in | PR open (all 6 steps done; UI Review waiting) | `claude/plugin-commands-auto` | [#263](https://github.com/MossesX/AmberX-AXF/pull/263) (merges after #250 and #249; UI Review r-20261103-3345d3d4) | axHub admin: allow `<plugin>_*`, `plugin_commands`, `plugin_read`, `plugin_run` on the `axf-console` service. Report `_claude/builds/reports/plugin-commands-auto.md` | 2026-11-03 |
