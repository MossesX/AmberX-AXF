<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=159-159 tokens=154 -->
## Status (as of Oct 21 2026)

- **Changes & features grid plugin (Oct 25 2026, Opus):** `apps/console-web/plugins/changes-grid` (`ai.amberx.axf.console.changes-grid`), nav → Builds → **Changes & features**: one grid of every Codebase changes entry (server `GET changes`, `GET changes/{id}` through `axf.changes@1`, never by folder) and every plan feature; each row is titled with the thread/request name and its date and time and expands to its details; filter both / changes / features, search, sort newest / oldest / name. Stores nothing. Self-test `test.py` (11 + pure core 17). <!-- axf-plugin:changes-grid -->
