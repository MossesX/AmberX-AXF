# Projects, Claude files and shared data (axhub-projects@1)

## Where things are
| What | In a project | On the hub (`/projects`, its own Docker volume) |
| --- | --- | --- |
| Manifest | `project.manifest.json` (project-manifest@1) | `/projects/<name>/_data/project.manifest.json` |
| Claude files | `_claude/` (rules/, instructions/, memory/) | `/projects/<name>/_claude/` |
| Shared Claude files (every project) | `_claude/shared/` (same sections) | `/projects/_shared/_claude/` |
| Shared data | the manifest's `data.shared` paths, where they are in the project | `/projects/<name>/_data/<same path>` |
| Outside any project | `~/.config/claude-sync/shared/` | `/projects/_shared/_claude/` |

`<name>` is the manifest's `name`. A repo can hold several projects: every folder with a manifest is one
(AmberX-AXF holds `amberx-axf` at its root plus `axf-demo`, `axf-console-web` and `axf-console-android` in `apps/`).
Layout schema: `clients/claude-code/projects.schema.json` in the axHub repo. Manifest schema and rules:
`framework/schemas/project-manifest.json` and `framework/schemas/project-rules.json` in AmberX-AXF.

## Session start
A SessionStart hook runs `claude-sync start`. It never creates a manifest (only projects built with or for AmberX,
plus axHub, belong on the hub; add one with `axf project init`, or make any folder a Claude project with
`claude-project` / `/claude-project`, which also creates its GitHub or VPS repo). It creates `_claude/` in every folder that has a
manifest and lacks it, syncs all of them, then prints the rules,
instructions and memory (shared first) and lists anything in a `docs/` folder. Held files are listed at the top:
ask Brett which copy to keep.

## Saving
Edit the files directly, then run `claude-sync sync`, then commit. On claude.ai, with no shell: axHub `call` →
`axhub.memory_write` with `project` = manifest name or `shared`, `area` = `claude` (default) or `data`, and
`path` inside it.

## Commands
- `claude-sync status` / `claude-sync projects`: where it syncs, the projects found, data paths, held files.
- `claude-sync sync`: sync every project in this repo now.
- `claude-sync resolve <id> --keep local|hub` (or `--all`), in that project's folder: settle a held file. Deleting on the hub asks for his approval in axHub first.
- `claude-sync init [dir]`: add a draft manifest and `_claude/` to an AmberX project.
- Setup per device: `node ~/axHub/clients/claude-code/claude-sync.mjs install`, then `claude-sync login` (the axHub token) where `/projects` isn't mounted (the VPS shell, laptops, the phone).
- Validate a manifest: `node framework/cli/project.mjs validate [dir]` in AmberX-AXF, or Dev Console → Standards.
