<!-- memory-chunk@1 source=_claude/memory/docs/build-reporting.md tokens=614 -->
## claude.ai chats (no shell)

Write the whole entry with `axhub.memory_write` before starting, then rewrite it (read → change → write) on each step
and at the end. `if_version: "new"` on the first write; pass the version you read on later ones. Shape (only `$axf`,
`id`, `title` are required; the rest is what the Build manager shows):

```json
{
  "$axf": "change-log@1",
  "id": "chg-20261021-1a2b3c4d5e",
  "createdAt": "2026-10-21T16:00:00.000Z",
  "updatedAt": "2026-10-21T16:00:00.000Z",
  "kind": "build",
  "title": "Short name of the build",
  "asked": "What Brett asked, short, no secrets",
  "repos": ["MossesX/AmberX-AXF"],
  "model": "opus",
  "who": { "where": "claude-ai", "host": "claude.ai" },
  "surface": "claude-ai",
  "status": "running",
  "buildRef": { "kind": "pending", "id": "lib-clone" },
  "startedAt": "2026-10-21T16:00:00.000Z",
  "lastSeenAt": "2026-10-21T16:00:00.000Z",
  "doing": "Writing the design note",
  "estimate": { "minutes": 45, "costUsd": 6.3 },
  "costEstimated": true,
  "branch": "feat/x",
  "areas": ["apps/console-web/plugins/x"],
  "steps": [ { "text": "Design note", "state": "running", "startedAt": "2026-10-21T16:00:00.000Z" } ],
  "result": null,
  "closed": null
}
```

- `id` = `chg-<YYYYMMDD>-<6–16 lowercase hex>`; the date picks the folder.
- `status`: `queued` | `running` | `done` | `failed` (derived from `result` once there is one).
- Step `state`: `queued` | `running` | `done` | `failed` | `skipped`.
- Finish: set `result` `{ "state": "done|failed|partial|cancelled", "summary": "…", "branch", "commits": [{"sha"}], "links": {"pr": "https://…"} }`,
  `finishedAt`, and `actual: { "minutes": N }`. claude.ai can't count its tokens: leave `actual.costUsd` out and
  `costEstimated: true` (the estimate stays, shown as estimated).
- Cost estimate: minutes × the model's per-minute heuristic in `framework/schemas/model-pricing.json`
  (about $0.14/min on Opus, $0.28/min on Fable, $0.07/min on Sonnet at the Oct 18 2026 prices).
- Heartbeat: rewrite with a new `lastSeenAt` at least every 10 minutes while working, or the Build manager shows "no word".
- Never write tokens, keys or passwords into an entry.

Validators: `apps/console-web/plugins/codebase-changes/changes-core.mjs` (Node) = `server/store.py` (Python), schema  <!-- axf-plugin:codebase-changes -->
`schema/change-log.schema.json`. Check an entry: `node changes.mjs validate < entry.json`. <!-- axf-plugin:codebase-changes -->
