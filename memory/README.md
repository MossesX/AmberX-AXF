# memory/

Snapshot (refreshed Oct 18 2026) of the instructions and Claude memory files from the **AmberX Framework** claude.ai Project, so Claude Code sessions in this repo have the same context.

**These files now live on axHub at `memory/amberx-axf/`** (decisions #65–#69 in the axHub repo); this folder is a read-only mirror marked by `.axhub-mirror`. The SessionStart hook (`axhub-memory load`, installed from the axHub repo) refreshes it at every session start, uses it when the hub is down, and seeded the hub from it the first time. Edit memory on the hub, then commit the refreshed mirror.

**`RULES.md` is the active one:** a condensed list of Brett's working rules and decisions, imported by `CLAUDE.md` so every Claude Code session in this repo has it. On the VPS, `bash deploy/claude-pick.sh --install` also imports it into `~/.claude/CLAUDE.md`, so it applies in any folder.

| Folder | Contents |
| --- | --- |
| `project-docs/` | The Project's knowledge docs: `Frame` (original spec), `Start`, `Building baseline`, `axf-architecture.md` |
| `project-memory/` | Project-scoped memory: AXF area notes, axHub, tools, preferences (how Claude should work here) |
| `account-memory/` | Account-level memory files related to the framework and Brett's apps (AmberX Studio, PilotX, ShipX, ActiveX, tools) |

The Project's custom instructions field is empty; working rules live in `project-memory/preferences.md`.

Personal memory (family, pets, food) is deliberately not copied here.

This is a copy — the live versions stay in claude.ai and may drift. Re-sync by asking Claude to copy them again.
