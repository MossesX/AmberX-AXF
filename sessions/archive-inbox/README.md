# session archive inbox

claude.ai sessions (no shell) record a chat here with `axhub.memory_write` (project `amberx-axf`, area `data`, path
`sessions/archive-inbox/<chat id>.json`) in the shape `fromChat` takes (`framework/plan/session-archive-core.mjs`):
`{id, url, title, project, startedAt, endedAt, model, messages: [{role, at, text (≤300 chars), chars, toolChars, tools, files}]}`.
The archive turns each into a session record (estimated tokens and cost) and leaves a receipt in its place.
Full instructions: `_claude/memory/docs/session-archive.md`.
