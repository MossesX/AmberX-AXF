<!-- memory-chunk@1 source=_claude/shared/instructions/projects-and-sync.md tokens=184 -->
## Commands
- `claude-sync status` / `claude-sync projects`: where it syncs, the projects found, data paths, held files.
- `claude-sync sync`: sync every project in this repo now.
- `claude-sync resolve <id> --keep local|hub` (or `--all`), in that project's folder: settle a held file. Deleting on the hub asks for his approval in axHub first.
- `claude-sync init [dir]`: add a draft manifest and `_claude/` to an AmberX project.
- Setup per device: `node ~/axHub/clients/claude-code/claude-sync.mjs install`, then `claude-sync login` (the axHub token) where `/projects` isn't mounted (the VPS shell, laptops, the phone).
- Validate a manifest: `node framework/cli/project.mjs validate [dir]` in AmberX-AXF, or Dev Console → Standards.
