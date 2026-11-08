<!-- memory-chunk@1 source=_claude/memory/docs/session-checkin.md lines=119-156 tokens=645 -->
## The archive

Every check-in writes one record, `session-log@1`:

```jsonc
{
  "$axf": "session-log@1",
  "id": "2026-10-18T07-56-12Z-vps-3f9c",       // started-at + location + short random
  "startedAt": "2026-10-18T11:56:12Z",
  "client": "claude-code",                      // claude-code | claude-ai | unattended
  "unattended": false, "skipped": false, "sameAsLast": false,
  "location":  { "answer": "vps", "detected": "vps", "host": "srv1837178" },
  "repo":      { "answer": "MossesX/AmberX-AXF", "detected": "MossesX/AmberX-AXF", "branch": "main", "head": "d74b95d", "dirty": false, "behind": 0, "ok": true },
  "container": { "answer": "host", "detected": "host", "ok": true },
  "project":   { "answer": "AmberX Framework", "detected": "AmberX Framework" },
  "memory":    { "source": "axhub", "fallback": false, "files": ["RULES.md", "project-memory/preferences.md", "..."], "opened": ["RULES.md"] },
  "model":     { "recommended": "opus", "why": "…", "picked": "opus", "running": "claude-opus-5-5", "switchNeeded": false },
  "effort":    { "picked": "high", "applied": "high" },
  "estimate":  { "baseline": "baseline-v1", "model": "opus", "effort": "high", "usd": 0.00, "calibrated": true, "pricesAsOf": "2026-10-18", "plan": true },
  "pending":   ["…ids waiting on the picked model"],
  "end":       { "at": null, "usage": null, "commits": [] }   // filled by the SessionEnd hook when the client has one
}
```

- **Where it's written** (first that works):
  1. the hub persist folder: `/opt/axhub/persist/amberx-axf/sessions/<YYYY>/<MM>/<id>.json`, plus an `index.jsonl` line, through `framework/cli/persist.mjs`
  2. the console API: `POST /api/sessions`
  3. axHub (`call`)
  4. the repo's `sessions/` folder, committed with the session's next commit
- **The cloud container is never the only copy:** it's temporary.
- **Never logged:** tokens, keys or other secrets, environment values, memory file contents, or the text of his messages.
- **Browsing:**
  - **Console:** a **Sessions** view: a newest-first table with filters (location, model, effort, mismatches, unattended) and a detail panel per session.
  - **Command line:** `node framework/cli/sessions.mjs [--last 20] [--location vps]`.
  - **MCP:** not exposed. Console plugin routes are never reachable through the console's MCP server (plugin security rule).
  - **Totals:** sessions per model, check-in mismatches, baseline estimate over time. A price change shows up as a step in that line.
- **Retention:** keep everything; records are small. Deleting needs Brett's approval, as with memory.
