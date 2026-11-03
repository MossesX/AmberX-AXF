# Git status board (build `git-status-board`, current profile)

Brett, Nov 3 2026 (voice): "Where do I view items at git status? Like, what is it? The push one's ready for push, one's
ready for this, what the ones in CI, what needs to be pulled, merged. Where do I see all that? Is there a plugin to view
all that status?" … "Yup. Like, I want to be able to view everything in grids with expandable rows and all that shit."

Built by Snap Sully (headless worktree session, Opus; the router wasn't on main). Replaces pending item
`batch-manager` (angel profile, noted there): its batch grid + badges, PR sub-grid + Fix, dense phone rows, PR browser
with a plain-English lead line, Merge / Hold, left click to open, right-click menu all live here now. Its predicted
screenshots moved to `ui-review-predicted`; its real before/after feature shots are not part of this build (see Gaps).

## What was added

- **Plugin `apps/console-web/plugins/git-status`** (`ai.amberx.axf.console.git-status`), Builds → Git status. Tabs
  Needs push, Needs pull, In CI, Ready to merge, Held, Merged today, Deployed, Stale, Batches; each a framework
  `DataGrid` (sort by column, column menu, expandable rows, status edge) with search, repo filter and sort on top.
  - Collapsed row: `#N` + plain-English line (build name + report / origin summary, else the PR title; a PR title that
    already names the build is used whole), status chip, CI dot, branch, agent (from the build's detail/notes), ↑↓ (⇡ not
    pushed), age, cost (Codebase changes log). Phone: the line plus one meta line; wide columns come back on desktop.
  - Expanded: blockers → what clears each, actions, checks with failing lines (annotations + summaries), commits, files
    with diffs (expand a file), linked build + steps, UI Review state + Open UI Review, batch, depends-on, folder/image.
  - Actions: Merge, Hold / release, Update from main, Re-run CI, Fix (ops-fix job), Land (land-build job), Close and Kill
    (confirm), Add to batch / New batch. Row right-click carries the same; "Show in Git status" is added to every context
    menu whose payload is a PR, branch or build on the board, and as a row hook on orchestrator / pending / queue /
    change rows.
  - Batches: New batch from ready, badges (ready, in CI, red, held, merged/gone), merge order (up / down), Merge next
    (merges the first ready PR in order, pulling main in first when it is behind; says what the first one waits for),
    take out, remove; a PR sub-grid per batch.
  - Live: `board?since=<stamp>` every 20 s while the page is visible, `{same: true}` until something changes; the
    server rebuilds in the background so no read waits behind GitHub (the first read only).
- **Server** `server/__init__.py` (routes + holds + batches), `server/core.py` (pure classifier, no I/O, no LLM),
  `server/localgit.py` (read-only git scan of `/opt/axf` and `/root/axf-builds/*`; in the console container the
  worktrees' `/opt/axf/.git/...` paths are mapped to `/axf`; background every 3 min, one fetch per 10 min; ~150
  checkouts in ~30 s).
- **Commands once → REST + MCP + CLI** (plugin-commands@1, declared in `plugin.json`): board, sections, list, item,
  files, batches, merge, hold, update, rerun, fix, land, close (destructive), kill (destructive), batch-new, batch-add,
  batch-take-out, batch-order, batch-merge-next, batch-remove (destructive).
- **Push banner capability `axf.push@1`** (push-banner/server): snapshot, detail, checks with failing lines, files with
  diffs, merged since, merge, update, merge-ready round, rerun failed jobs, close a PR, delete a branch with no open
  PR. All through the banner's existing checks and its Activity reporting.
- **`axf.merge-holds@1`** (provided by git-status): the push banner's Merge refuses and auto-merge skips a held PR
  (`on hold: <reason>`), like a UI Review hold. Without the plugin nothing changes.
- **Job type `ops-fix`** (`framework/assets/job-type/ops-fix.json`, specialty merge-fixer → Merge Max): fix one red or
  conflicting PR on its own branch, never main, with the failing lines from Git status in the brief.

## Live check (VPS data, local API run)

GitHub through the push banner: 57 open PRs on AmberX-AXF, 14 on axHub. Board: In CI 47, Held 56 (mostly
conflicts with main), Merged today 24, Stale 54; local scan of 152 checkouts: Needs push 29 (after leaving out
build-status files), Needs pull 147. Deployed needs Container access (the Docker proxy), so it is empty outside the
console container and filled in it.

## Tests

- `python3 apps/console-web/plugins/git-status/test.py`: 51 checks (manifest + commands, zero-LLM scan of every
  source file, classifier cases, lead lines, agent parsing, a throw-away repo + worktree for the local scan, every route
  against a fake push banner / UI Review, holds through `axf.merge-holds@1`, batch order and Merge next, Kill refusals,
  push banner off) + `web/core-check.mts` (11).
- `python3 apps/console-web/plugins/push-banner/test.py`: 150 checks, unchanged, still green.
- `tsc --noEmit` (console-web) clean; `check-theme.mjs` and `check-controls.mjs` clean for the plugin;
  `plugin-lifecycle.mjs check git-status` clean.

## Screenshots

Phone + desktop in `_claude/builds/reports/git-status-board/shots/after/` (taken offline with
`AXF_APPEARANCE_HUB=off` and auto-merge off, real GitHub data through the local token): Ready, In CI with a row open,
Needs push, Held with a row open, Deployed, Batches. Sent to UI Review (group `git-status-board - <time>`).

## Gaps / next

- Real before/after **feature screenshots per PR** (old batch-manager step s3) aren't built here: they need the
  capture tooling driven per PR; predicted shots are `ui-review-predicted`.
- **claude-sync holds** aren't a row reason yet: `claude-sync` doesn't run in the console container; the held files
  show in the session-start hook. A capability for them would let Held list them.
- Worktrees whose branch already merged still count in Needs pull / Stale; a worktree sweeper (or Kill for local
  checkouts) would clear them. Kill deletes GitHub branches only, never a local folder.
- Deployed infers the commit from container start time for apps whose image tag isn't a commit id; tagging images with
  the commit at build time (install-console.sh) would make it exact.
- The agent column shows the agent named in the build; PRs with no linked build show none (the GitHub login is kept as
  `author`).
