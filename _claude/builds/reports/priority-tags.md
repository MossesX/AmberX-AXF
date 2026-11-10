# Priority tags report (Nov 5 2026)

Build `priority-tags`, Opus, agent Snap Sully. Spec and usage: `_claude/memory/docs/priority-tags.md`.

## What landed

- Priority on every build (Urgent / High / Normal / Low = P0-P3): optional store field, unset is worked out on read.
- `PriorityTag` chip on Build manager, Builds page, Build orchestrator, Build queue, Pending builds, Crew, Codebase changes, Plan Studio build link, Home build card, agent queue, merge queue.
- Tap or right-click: change level, see what is waiting; rows open and flash their target.
- Agent queue and merge queue follow priority. Manual moves win.
- Build queue screen: the real agent-slots queue (running + waiting, with tags) on top, the plan order below.
- CLI `framework/cli/build-priority.mjs`, routes and plugin commands (`priority-list`, `priority-get`, `priority-set`) for API, MCP and voice.

## Decisions

- Backfill is read-time, not a store write: a write would have bumped 354 records and clashed with every open branch. A build marked urgent shows Urgent at once.
- Urgent profile counts as marked urgent. The brief said name or brief; the Urgent profile is the same mark.
- A priority change never rebuilds a running merge-queue stack, to save CI. It changes who joins next.
- `urgent` in a brief counts only when shouted or opening a line, so "not urgent" and this build's own brief don't match.
- New internal capability `axf.merge-queue@1` so another plugin can read the queue without naming push-banner. Not a wire contract.

## Found on the way

`.fx-chip { all: unset }` further down `axf.css` wipes every `fx-chip--danger/warning/success` tone, so tone chips across the console render uncoloured. Not fixed here: it would recolour the whole console. The tag colours itself through `data-axf-priority`.

A second one, fixed here: `ROOT` in the orchestrator server was `CLI.parents[3]`, which is `apps/`, not the repo root. The server's origin routes (What Brett said) and the `builds-live` health item looked for their CLIs in `apps/framework/cli/`, where nothing exists. It is now `parents[4]`, with a test that every CLI the server runs is really there.

## Limits

- Bulk change is on the Builds page through the steps selection; the builds grid has no row selection.
- Older checkouts running code from before this build drop `priority` when they write that build. It falls back to its default until set again.
- Steps have no priority of their own.
- The shell CLI's waiting list is partial; the console's is complete.

## Tests

`check-build-priority.mjs` 8 new, `merge-queue.test.mjs` 9→11, `land.test.mjs` 92, `check-builds-store.mjs` 37, `build-orchestrator/test.mjs` 33, `build-orchestrator/test.py` 5→11, push-banner 178, agent-slots 19, plugin-commands 41. Theme, controls, toolbars, chrome and help checks pass. Console typecheck and build pass.

Shots: `priority-tags/shots/` (mock data).
