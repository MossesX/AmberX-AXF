# Full voice control: merge main and land

Build `full-voice-control-merge-main-and-land`, Opus, phase 1. Brett (Nov 13 2026): "land full voice and API control".

## Result
PR #645 carries all of `claude/full-voice-api-control-type-fields-press` (#627) merged with current main. It is MERGEABLE / CLEAN, and the merge queue lands it. #627 has a comment pointing to #645.

## Steps
- s1: merged origin/main. The only clash was `framework/catalog/status.json`; both entries are kept (`cx.console.fieldcontrol` from the branch, `cx.contextmenu.consolesettings` from main).
- s1 extra: `npm run build` failed because the tracked `apps/console-web/src/axf/core` copy had no `build-id.mjs`, which main's `pending-core.mjs` now imports. CI re-copies `framework/core`, so CI was unaffected. The two files are now synced and the build passes locally. The regenerated `pending-core.mjs` copy and `src/control/inventory.json` (+4 functions from main) are committed.
- s2: the feature reaches main through #645. Nothing new was built; what each action is reached by (REST, MCP, CLI, voice) is in the #627 table, which #645 repeats.

## Tests (on the merged branch)
- `server/tests/test_console_control.py`: 11 tests pass
- `scripts/console-control.e2e.mjs`: 36 checks pass, with the New project form driven end to end (run on port 7377 because another session held :7099)
- check-console-control: 290 checks. gen-fixtures: no drift
- console tsc, `npm run build`, check-theme, check-controls, check-toolbars, check-chrome-assets, `axf validate --framework`, `project validate --all` and `builds-store verify` all pass
- `tracker --check` reports 1 item without a status. That comes from the live base-data status copy (`baseDataPath`), not this branch: here every catalog item has a status.

## Gaps
- claude.ai can read, fill and press, but it cannot approve or veto until the MCP connector carries an owner identity. This is unchanged from #627.
- The Kotlin twin is deferred (PORTING.md).
- No UI changes, so nothing goes to UI Review.
