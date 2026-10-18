# AmberX AXF rules

Project memory (claude-fs@1): `_memory/` ↔ `/Claude/projects/amberx-axf/_memory/`. Rules for every project are in
`_memory/shared/rules/`. Edit here, then `claude-sync sync`, then commit.

- **Pending builds:** check the pending list before any build (`node framework/cli/pending.mjs`, MCP `pending_list`, console → Pending builds). "Add to the pending build list" means park it.
- **Live data is on the hub:** pending list, plan + media, build queue, catalog status, libraries index and tracker are read and written in `/Claude/projects/amberx-axf/data/<same path as in the repo>` on the VPS (`framework/cli/persist.mjs`; the list is `_memory/data.json`). The repo copies at the original paths are synced snapshots (`claude-sync sync`, then commit). On the VPS, change data through the CLI, console or MCP, not by editing repo files.
- **Everything visible is an asset** (`asset@1`). UI reads only engine-compiled tokens; never hardcode colours or sizes. Plugin and library UIs use theme tokens only (`framework/spec/THEMING.md`).
- **Engine compatibility across ports is a hard constraint:** the Kotlin kernel and TS `framework/core` are the same design; change a reference engine, then regenerate `framework/spec/fixtures`.
- **Build options are `--switches`** from one registry (`framework/schemas/build-options.json`), each setting an asset token. Every future build defaults every option to off; existing files were set on. First option: `--wrap-groups`.
- **Every app gets a landing/loading screen and a settings interface by default.** Every app compiled by the build engine ships the settings interface and lib-settings.
- **Plugins:** each plugin gets a Plugin Manager entry (info, enable/disable, logs, settings). Plugins never ship their own settings screen; they add tabs to the app's settings interface.
- **Extraordinary care for expansion:** placeholders everywhere, open registries, nothing in a build may constrain later scaling.
- AmberX-AXF is private. Don't create the separate console repo until he says so.
