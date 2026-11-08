<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=175 -->
## Oct 20 2026 — App catalog on axHub (app-catalog@1)

- **Oct 21 2026 — Codebase changes log + banner (Brett).** Every time Claude is asked to build, edit or remove something, an entry is created (what was asked, what it does, broken into steps) and its results are stored when done. Entries show in a **Codebase changes** banner on every console load until closed (closing clears it everywhere), and a permanent log is browsable in the console. Banner, behaviour and log browser are one console plugin, installed. Recording: automatic Claude Code hook opens the entry; Claude fills in steps and results. Storage: on axHub (`/projects/amberx-axf/_data/…`, the hub is the main copy). Built on Opus.
