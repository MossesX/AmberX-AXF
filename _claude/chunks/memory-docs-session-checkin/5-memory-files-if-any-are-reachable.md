<!-- memory-chunk@1 source=_claude/memory/docs/session-checkin.md lines=67-78 tokens=188 -->
### 5. Memory files (if any are reachable)
- **Show:** where memory was loaded from, in priority order:
  1. axHub `memory/amberx-axf/` (live)
  2. the repo mirror `memory/` (read-only)
  3. the claude.ai memory store, in claude.ai or a session attached to a Project
- **Also show:** whether the hub was reachable or the mirror was used as a fallback.
- **List the files** (path, size, last updated) as a numbered list.
- **Open:** Brett can open any of them to **read only**: "open 3" or "open RULES" prints the file.
  - Nothing in this step edits, saves or deletes memory.
  - Changes go through the normal channels (`axhub.memory_write`, or the claude.ai memory tools on an explicit ask).
- **This step logs file names only, never their contents.**
