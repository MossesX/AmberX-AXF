# Git status board in the console (build `finish-and-land-the-git-status-board-every-ready`, Opus)

Brett, Nov 10 2026: "Git status board, put them in the console."

PR [#475](https://github.com/MossesX/AmberX-AXF/pull/475) replaces #291 (`git-status-board`, 5 of 6 steps). That branch
was 3,175 commits behind main, and the rules say not to update a PR from main, so the plugin is ported fresh onto main
here. #291 can be closed once #475 lands.

## Where it is

Dev Console → Builds → **Git status**. The first tab is **Ready to merge**: every open PR that is green and not held,
each with its title or build line, CI dot, branch, agent, age and cost. Conflicts, UI Review, drafts, holds and
dependencies show up as blockers, each with what clears it. Rows expand to show failing check lines, commits, files and
diffs, the linked build and its UI Review item. Actions: **Merge**, **Fix** (a `pr-fix` job for Merge Max),
**Open on GitHub**, Hold / Release, Update from main, Re-run CI, Land, Close, Kill, and batches. The other tabs are
Needs push, Needs pull, In CI, Held, Merged today, Deployed, Stale and Batches.

## What changed from #291

- **Merge queue respects holds.** Since #291, main has gained a host merge queue (`push-banner/land/merge-queue.mjs`)
  that lands AmberX-AXF outside the banner's auto-merge. A hold in Git status now also runs the queue's `remove` with
  the reason, and Release runs `add`, through the new `axf.push@1` method `queue_hold`. Without this, Hold would not
  have stopped a merge.
- **Framework chrome.** The section row is a framework `TabGroup` (`git-status.section`), which `check-chrome-assets`
  requires. Search, repo, sort and add-to-batch are `TextField` / `SelectField`. The dot radius literal is now a token.
- **Job type.** #291 rewrote `ops-fix`, but on main that is a separate VPS ops job (Janitor Joey). Git status → Fix now
  sends a new `pr-fix` job (`framework/assets/job-type/pr-fix.json`, Merge Max), and `ops-fix` is unchanged.
- **Push-banner merge conflicts.** Resolved by keeping both sides: main's `wait_ui` merge switch and auto-land notes,
  plus #291's `merge_hold` and `axf.push@1`.

## API (each surface the same)

- Deep link: `console_show target="git-status"`; `action:git-status.show:<PR # | branch | build>` opens the board on
  that row; nav under Builds → Git status; "Show in Git status" in context menus.
- REST `/api/plugins/git-status/*`, and through plugin-commands@1 (auto) the same 20 commands as MCP tools, CLI and
  voice: board, sections, list, item, files, batches, merge, hold, update, rerun, fix, land, close*, kill*, batch-new,
  batch-add, batch-take-out, batch-order, batch-merge-next, batch-remove* (* destructive).

## Tests

- `python3 apps/console-web/plugins/git-status/test.py`: 53 checks pass (includes new checks: Hold takes the PR out
  of the merge queue with its reason, and Release puts it back).
- `python3 apps/console-web/plugins/push-banner/test.py`: 176 checks pass.
- `tsc --noEmit` (console-web) is clean. check-theme, check-controls, check-toolbars and check-chrome-assets pass.
  `plugin-lifecycle check git-status` is clean.

## Screenshots

The shots are in `finish-and-land-the-git-status-board-every-ready/shots/`: `git-status-ready-desktop.png` and
`git-status-ready-phone.png` show the board open on Ready to merge, with the framework TabGroup tab row and the
Search / Repo / Sort fields.

The shots were taken with a scratch console (rebuild-shots), so the grid is empty: that console had no GitHub token
and no Docker proxy, and the board shows those notes instead of rows.

Not yet submitted to UI Review: `review.mjs submit --console` needs `AXF_CONSOLE_URL` and `AXF_TOKEN`, and this
headless session has neither. To submit:
`review.mjs submit --kind screen --app console-web --screen git-status --pr 475 --shots <the two pngs> --single-option "…" --console`.

Tooling notes:
- Playwright was missing from this worktree, so it was linked in from another worktree.
- The VPS has Chromium rev 1234, but Playwright 1.56 expects rev 1194; a scratch `PLAYWRIGHT_BROWSERS_PATH` shim
  pointed it at the installed browser.

## Gaps / next

- Redeploy the console after the merge queue lands #475.
- Other gaps carried over from #291 (in `_claude/builds/reports/git-status-board.md` on that branch):
  - claude-sync holds aren't a row reason yet.
  - Worktrees whose branch has already merged still count in Needs pull / Stale.
  - Deployed infers the commit from the container start time.
  - There are no per-PR before/after feature shots.
- `framework/catalog/status.json` has no entry because plugins aren't catalog features.
