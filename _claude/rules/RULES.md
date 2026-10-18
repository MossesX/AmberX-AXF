# AmberX AXF rules

Project files (axhub-projects@1): `_claude/` ↔ `/projects/amberx-axf/_claude/` on the hub. Rules for every project
are in `_claude/shared/rules/`. Edit here, then `claude-sync sync`, then commit.

- **Pending builds:** check the pending list before any build (`node framework/cli/pending.mjs`, MCP `pending_list`, console → Pending builds). "Add to the pending build list" means park it.
- **Project manifests:** every project has `project.manifest.json` (project-manifest@1). This repo holds four: `amberx-axf` (root), `axf-demo`, `axf-console-web`, `axf-console-android` (apps/). Only projects built with or for AmberX get a manifest; unrelated repos are never touched. **The build engine never loads or compiles a project without a validated manifest** (`requireProject` in `framework/cli/project.mjs`; app templates guard their dev/build too). Rules: `framework/schemas/project-rules.json`, managed in the Dev Console → **Standards**; locked rules can't be removed or loosened. Validators: `framework/core/project.ts` (reference), `framework/core/project-check.mjs`, Kotlin `ai.amberx.axf.kernel.project`; fixtures `framework/spec/fixtures/project-manifest.json`.
- **Shared data is on the hub:** the root manifest's `data.shared` (pending list, plan + media, build queue, catalog status, libraries index, project rules, tracker) is read and written in `/projects/amberx-axf/_data/<same path as in the repo>` where `/projects` is mounted (the Dev Console container), through `framework/cli/persist.mjs`. The repo copies are synced snapshots (`claude-sync sync`, then commit). On the VPS, change data through the CLI, console or MCP, not by editing repo files.
- **Everything visible is an asset** (`asset@1`). UI reads only engine-compiled tokens; never hardcode colours or sizes. Plugin and library UIs use theme tokens only (`framework/spec/THEMING.md`).
- **Engine compatibility across ports is a hard constraint:** the Kotlin kernel and TS `framework/core` are the same design; change a reference engine, then regenerate `framework/spec/fixtures`.
- **Build options are `--switches`** from one registry (`framework/schemas/build-options.json`), each setting an asset token. Every future build defaults every option to off; existing files were set on. First option: `--wrap-groups`.
- **Every app gets a landing/loading screen and a settings interface by default.** Every app compiled by the build engine ships the settings interface and lib-settings.
- **Plugins:** each plugin gets a Plugin Manager entry (info, enable/disable, logs, settings). Plugins never ship their own settings screen; they add tabs to the app's settings interface.
- **Extraordinary care for expansion:** placeholders everywhere, open registries, nothing in a build may constrain later scaling.
- AmberX-AXF is private. Don't create the separate console repo (`axf-console`, reserved in its manifest) until he says so.
