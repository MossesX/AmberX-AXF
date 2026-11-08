<!-- memory-chunk@1 source=_claude/shared/instructions/projects-and-sync.md lines=25-36 tokens=210 -->
## Saving
Edit the files directly, then run `claude-sync sync`, then commit. On claude.ai, with no shell: axHub `call` →
`axhub.memory_write` with `project` = manifest name or `shared`, `area` = `claude` (default) or `data`, and
`path` inside it.

**Notes Brett asks you to save** ("save this", "make a command", handoffs, session logs, plans, install notes) go in
one place: `notes/<folder>/<file>.md` in the shared Claude files (`/projects/_shared/_claude/notes/`; axHub
`axhub.memory_write` with `project` = `shared`, `area` = `claude`; in a checkout `_claude/shared/notes/`). Folders:
`handoffs/`, `sessions/`, `plans/`, `install/`, `commands/`, `orchestrator/`, `misc/` (add one when none fits), and a
line in `notes/INDEX.md`. They sync everywhere but are not printed at session start; read them on demand. Console:
Plugins → Notes.
