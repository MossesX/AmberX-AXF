# Land drive-live-console-first: resolve clash in console-commands engine

Build `land-drive-live-console-first-resolve` · branch `claude/drive-live-console-first` · PR #620 · Nov 13 2026

Brett said: "land drive the live console first"

## What was done
- Phase 1 (Fable): merged origin/main into the branch, resolving the 7 clashing files (console-commands plugin
  `console.mjs` and `server/__init__.py`, the console-commands engine `.mjs`/`.d.mts` in `framework/core/engines` and
  `apps/console-web/src/axf/core/engines`, `framework/catalog/status.json`). Kept main's newer behaviour (reconnect
  delivery, wake, op `control`) plus this branch's "drive the live console first" path (op `url`, console-first
  pages and approvals).
- Phase 2 (Opus): merged main again (clean: no conflicts), re-baked the console-commands engine into
  `apps/molly` (it was missing op `control`), and re-ran the checks.

## Checks (all green)
- `node apps/console-web/plugins/console-commands/test.mjs`: 10 tests
- `npx tsx framework/spec/check-console-commands.mts`: 137 checks
- `npx tsx framework/spec/check-console-control.mts`: 290 checks
- `npx tsx framework/spec/check-control.mts`: 390 checks
- console-commands server `python3 -m unittest test_console_commands`: 130 checks
- `check-project-fixtures`, `check-axf-server`, `check-theme`, `check-controls`: pass

## Known, not from this PR
- `plugin-lifecycle check console-commands` flags `approvals-banner/web/index.tsx` calling
  `pluginFetch('console-commands', 'overlay')` by folder name. The same line is on main already; it needs moving
  onto a capability service in its own build.
- The console-web baked `control-rules.mjs` / `schemas/control.json` lag the framework on main as well; left
  to `rebake`.

## API reach
Unchanged from PR #620: `console.nav` act `open_url` is reached through REST `POST /api/console/open-url`, the MCP
tool `console_open_url`, the CLI `axf console open-url <url> [--live]`, and AmberX voice (`amberx.open_url` asks the live
console first).

## Next
Waiting in the merge queue. Kotlin twin deferred (PORTING.md).
