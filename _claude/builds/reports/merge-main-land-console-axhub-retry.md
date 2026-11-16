# merge-main-land-console-axhub-retry

Merged main into `claude/console-axhub-retry-failed-calls` (PR #589) so auto-land can take it. Merge commit `ba0c8fa31`, pushed to the PR branch; no new PR for that work.

## Conflicts and how they were resolved
- `.github/workflows/android.yml`: both sides added checks next to the builds-store lock check. Kept main's `check-build-id.mjs`, one `check-builds-store-lock.mjs` line, and the branch's `check-retry-ladder.mjs` / `check-retry-runner.mjs`.
- `apps/console-web/server/mcp_server.py`: both sides added a block at the same place. Kept the branch's retry-ladder runner (`retry_runner`, `retried`, `CONSOLE_FIXES`) and main's `_control_run` / `_control_focus` (console-control@1 focus for console_open / console_show). No name clashes.
- `framework/spec/PORTING.md`: kept both deferred entries (retry-ladder@1, plus main's skin-config@1 and skin-switch@1).
- `apps/console-web/plugins/claude-accounts/help.json` (not in the brief's list, clashed too): took main's newer text for the account picker.

## Tests (on the merge)
- `check-build-id` 9, `check-builds-store-lock` 9, `check-retry-ladder` 76, `check-retry-runner` 5: pass
- `test_mcp_retry.py` 4, `test_mcp_tools.py` 206, `tests/test_console_control.py` 8, `axf_server/test_retry.py` 17, `auto-fixes/test.py` 23: pass
- `tracker.mjs --check`: pass
- PR #589 after the push: MERGEABLE, CI running; auto-land and the merge queue land it.

## Notes
- The PR branch is checked out in another worktree with uncommitted builds-store writes; the merge was done in a separate detached worktree so that checkout was left alone.
- No UI or API change: merge only.

## Attempt 1 (2026-11-16): stopped, PR archived
- The merge queue kicked #589 out: CI failed on top of main (Web Dev Console (React/TS) + Python API, Build engine sweep (Node); run 43662470182).
- Brett then closed #589 on 2026-11-16 22:53 UTC: "Archived by Brett: more than 500 commits behind main. Branch kept." The branch is now 1520 commits behind main.
- Steps s7/s8 (retry the land, merge main again) were not run: re-merging and reopening the PR would override the archive. The branch `claude/console-axhub-retry-failed-calls` is untouched.
- Build handed back to Pending. To revive the retry-ladder work, rebuild it fresh on main rather than merging 1520 commits into the old branch.
