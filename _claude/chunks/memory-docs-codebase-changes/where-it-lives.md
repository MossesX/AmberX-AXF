<!-- memory-chunk@1 source=_claude/memory/docs/codebase-changes.md lines=25-31 tokens=256 -->
## Where it lives

- **Main copy on axHub:** `/projects/amberx-axf/_data/changes/` (the console container mounts `/projects`; resolved like every other shared file through `persist.mjs` / `cx.persist_root()`). One file per entry, rewritten only to update that entry; atomic writes; in the hub tree files are 0660 and new folders 2770 so axHub (another user) can serve them, elsewhere 0600/0700.
- `changes/` is in the root manifest's `data.shared`, like `sessions/`: the repo copy is a synced snapshot (`claude-sync sync`), and entries written in a clone (`--to-repo`) reach the hub that way. The first time the console uses an empty hub folder it seeds it from the repo copy.
- No shared index file (two copies appending one would conflict on sync): the server indexes the files in memory (by mtime) for lists, filters and pages.
- **Uninstalling never deletes the log**, not even `uninstall.mjs --all`: it is Brett's record. Removing it is a deliberate manual step (deleting on the hub through axHub needs his approval).
