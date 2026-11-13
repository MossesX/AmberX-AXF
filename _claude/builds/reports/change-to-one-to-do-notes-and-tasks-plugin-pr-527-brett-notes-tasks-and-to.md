# Notes & tasks: one item type, nested to any depth (revises PR #527)

Build `change-to-one-to-do-notes-and-tasks-plugin-pr-527-brett-notes-tasks-and-to`, phase 1 (Opus), Nov 13 2026.
Branch `claude/change-to-one-to-do-notes-and-tasks-plugin-pr-527-brett-notes-tasks-and-to`, PR #545. It carries
#527's design commit, so it supersedes #527.

## Result
- s1: the notes-tasks@1 contract now has one row shape, `item`. A **look** (`note`, `todo`, `task`, `list`, plus up
  to 12 that Brett adds) replaces `kind`. It only sets what is shown. Changing it keeps every field.
- s2: `parent` is any item, with no depth limit. The rules cover moves (whole subtree, no cycles), delete with
  `lift` / `delete` for children, cascade tick, deep duplicate, roll-up progress, tabs across every depth, and cycle
  and orphan handling on read. The engine function list, API table, deep links, control@1 additions, voice intents,
  UI and later steps were all revised to match.
- Legacy amberx-notes@1 rows still read: `kind` → look, `list` → parent, `lists` rows → holder items, `checklist`
  → checkable children. `kind` / `list` mirrors are still written for the old phone code.

## Files
- `apps/console-web/plugins/notes-tasks/DESIGN.md`
- `apps/console-web/plugins/notes-tasks/schema/notes-tasks.schema.json`
- `framework/spec/PORTING.md` (twin line, Kotlin still deferred)

## Checks
Schema parses and every `$ref` resolves. `check-theme.mjs` ✓, `check-controls.mjs` ✓. There is no running code or UI
yet, so nothing went to UI Review.

## Open
- Children render after the body. A list placed mid-note (an inline anchor) is not designed.
- Old AmberX phone code shows deep items as subtasks of their top ancestor until s6 moves it to the engine.
- Engine, server, web and AmberX steps (DESIGN.md "Steps after this one") are not built yet.
