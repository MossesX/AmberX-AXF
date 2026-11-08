<!-- memory-chunk@1 source=_claude/shared/rules/RULES.md tokens=115 -->
## Before building anything

- **One chat per task (Oct 26 2026, Brett):** "Use threads instead of session." Every new task gets its own chat thread (its own row in `_claude/THREADS.md`), not more work piled into the current session. When he asks for something new mid-session, finish or park the current work, add a THREADS.md row for the new task, and give him a ready first message to start that thread; don't build it in the old session unless he says so.
