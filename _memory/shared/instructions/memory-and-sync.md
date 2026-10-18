# Memory and sync (claude-fs@1)

## Where things are
| What | In a project | On the hub (VPS) |
| --- | --- | --- |
| Project memory | `_memory/` (rules/, instructions/, memory/, decisions/, docs/, sessions/, inbox/) | `/Claude/projects/<project>/_memory/` |
| Shared memory (all projects) | `_memory/shared/` (same sections) | `/Claude/_memory/shared/` |
| Project live data | its original paths, listed in `_memory/data.json` | `/Claude/projects/<project>/data/<same path>` |
| Outside any project | `~/.config/claude-sync/shared/` | `/Claude/_memory/shared/` |

`<project>` is the git repo name, lowercase (e.g. `amberx-axf`, `axhub`). Schema: `claude-fs.schema.json` in the axHub repo (`clients/claude-code/`).

## Session start
A SessionStart hook runs `claude-sync start`. It creates `_memory/` if the project has none, syncs all three
scopes, then prints the rules, instructions, memory and decisions (shared first) and lists docs/, sessions/
and inbox/ files. Held files are listed at the top: ask Brett which copy to keep.

## Saving
Edit the files directly, then run `claude-sync sync`, then commit (everything in `_memory/` is committed,
`shared/` included). On claude.ai, with no shell: axHub `call` → `axhub.memory_write` with
`repo` = project name or `shared`, `area` = `memory` (default) or `data`, and `path` inside it.

## Commands
- `claude-sync status`: where it syncs, data paths, held files.
- `claude-sync sync`: sync now.
- `claude-sync resolve <id> --keep local|hub` (or `--all`): settle a held file. Deleting on the hub asks for his approval in axHub first.
- `claude-sync init [dir]`: add `_memory/` to a project.
- Setup per device: `node ~/axHub/clients/claude-code/claude-sync.mjs install` (+ `claude-sync login` on devices without `/Claude`). On the VPS once, as root: `claude-sync migrate`.
