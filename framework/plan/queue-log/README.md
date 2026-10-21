# queue-log@1 — what changed in everything still to build

One file per day (UTC): `<YYYY>/<MM>/<YYYY-MM-DD>.json` = `{ "$axf": "queue-log@1", "day", "batches": [...] }`.
A batch is one write to the pending list, the build queue or the plan: `{ id, at, source: tool | outside, by, surface,
op, reason, prompt, changeId, session, files, events }`; events are `added`, `removed`, `moved` (from → to), status,
model, estimate, steps, notes and more (`framework/plan/queue-log-core.mjs`). `state.json` holds the last snapshot of
each list so changes made outside the tools (axHub direct writes, git syncs, hand edits) are caught and logged too.

Shared data: the live copy is on the hub (`/projects/amberx-axf/_data/framework/plan/queue-log/`); this folder is the
repo seed. Browse it in the console (Builds → Build manager → Activity) or `node framework/cli/queue-log.mjs`.
