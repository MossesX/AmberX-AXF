# Reporting builds to the Build manager (every session, every machine)

Rule (Oct 21 2026, Brett; `_claude/shared/rules/RULES.md` → "Report every build to axHub"): before any session builds,
edits, removes or fixes something, it records it on axHub, keeps it live while it works, and finishes it. The console's
**Build manager** (Live + Built) and **Codebase changes** log read the same files. <!-- axf-plugin:codebase-changes -->

**Where:** one JSON file per build, `changes/<YYYY>/<MM>/<id>.json` in AmberX-AXF's shared data on axHub
(`/projects/amberx-axf/_data/changes/…`). Through the hub tools that is `axhub.memory_write` with
`project: "amberx-axf"`, `area: "data"`, `path: "changes/2026/10/chg-20261021-1a2b3c4d5e.json"`. Same file for every
project (the build's own repo goes in `repos`).

## Claude Code (VPS, any computer, headless, subagents)

One line per machine (needs Node 18+ and a clone of AmberX-AXF; the hub token from `claude-sync login`, or
`AXHUB_TOKEN`, lets it write to axHub from anywhere):

```bash
node ~/AmberX-AXF/apps/console-web/plugins/codebase-changes/changes.mjs hooks install   # user settings: every project
```

`deploy/claude-pick.sh --install` runs it too. The hooks (`~/.claude/settings.json`, all projects) open an entry when
a prompt asks for a change, send the current activity (throttled, one write per 30 s) and subagent starts/stops as live
steps, mark "waiting for you", and on Stop / SessionEnd fill in the **actual tokens and cost** from the session
transcript (prices: `framework/schemas/model-pricing.json`). They never block Claude Code. Then, before building:

```bash
C=~/AmberX-AXF/apps/console-web/plugins/codebase-changes/changes.mjs
node $C update <id> --ref pending:lib-clone --model opus --estimate-min 90 --areas "apps/console-web/plugins/x,framework/core/y" --branch feat/x
node $C step <id> "Server routes" --state running      # … --state done
node $C result <id> --state done --summary "…" --branch feat/x --commit abc1234 --link pr=https://github.com/…
```

Where a run writes: `AXF_CHANGES_DIR` → `/projects` (console container) → **axHub over MCP** (hub token) → console API
(`AXF_TOKEN`) → `--to-repo` → local queue (sent on later). Console launches set `AXF_SURFACE=console-launch`; a session
started for another entry sets `AXF_PARENT_CHANGE=<id>` so it shows under it.

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
  "activity": "Writing the design note",
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

Validators: `apps/console-web/plugins/codebase-changes/changes-core.mjs` (Node) = `server/store.py` (Python), schema
`schema/change-log.schema.json`. Check an entry: `node changes.mjs validate < entry.json`. <!-- axf-plugin:codebase-changes -->
