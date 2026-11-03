# Git status (console plugin `git-status`)

Where everything stands in git, in one page of grids with expandable rows (Builds → **Git status**).

| Tab | What is in it |
|---|---|
| Needs push | VPS checkouts (`/opt/axf`, `/root/axf-builds/*`) with commits not on GitHub or uncommitted files (build-status files that go live by themselves don't count), and pushed branches with no PR yet |
| Needs pull | checkouts and branches behind `origin/main` (how many commits) |
| In CI | PRs whose checks are running, queued, failed or missing; expand for the failing checks and their error lines |
| Ready to merge | green CI, mergeable, nothing holding it (behind main is fine: Merge / auto-merge pull main in first) |
| Held | UI Review waiting / changes / rejected, conflicts, a draft, a hand hold, a dependency PR (`Depends on #N` in the PR text): the reason in plain English and what clears it |
| Merged today | PRs merged since midnight (Brett's time, `AXF_GIT_STATUS_TZ`, default America/New_York) |
| Deployed | which app container runs which commit (the image tag when it is a commit id, else main at the time the container was built) and how far main moved since |
| Stale | no activity for 3 days or more than 150 behind main: Land (land-build job) or Kill (delete the GitHub branch) |
| Batches | push batches: live badges (ready, in CI, red, held, merged), merge order, Merge next, a PR sub-grid each |

A row (collapsed) leads with `#N` and a plain-English line built from the build's name and its report / origin
summary, else the PR title (no LLM), then status, CI dot, branch, agent (from the build), ↑ahead ↓behind (⇡ = not
pushed), age and cost (from the Codebase changes log). Expanded: what blocks it → what clears it, the actions, checks
with failing lines, commits, files with diffs, the linked build and its steps, its UI Review item, batch, folder.

Actions: **Merge** (push banner: up to date, CI green on the pinned head, nothing held), **Hold** / release,
**Update from main**, **Re-run CI** (failed jobs), **Fix** (an `ops-fix` job to Merge Max with the failing lines),
**Land** (a `land-build` job to Landin' Lenny), **Close** (confirm), **Kill** (confirm), **Add to batch** / **New batch**.
Right-click a row for the same; "Show in Git status" is on every PR, branch and build menu in the console.

## Data (zero tokens)

- GitHub through the push banner's capability **`axf.push@1`** (axHub first, the local token as the fallback; its
  2-minute cache): open PRs and branches, details, check runs + annotations, files, merged PRs. Every write goes
  through the banner's own checks and shows in the Activity banner.
- Local git (`server/localgit.py`): plain `git` on every checkout the console can see, in the background every 3 min,
  one `git fetch --prune` at most every 10 min. Read-only.
- `_claude/builds/store.json` (build, steps, agent, origin), `_claude/builds/reports/<id>.md` (summary line),
  `ui-review@1`, `axf.changes@1` (cost), `axf.containers@1` (deployed). Each is optional; a missing one is named in a
  note at the top instead of breaking the page.
- Provides **`axf.merge-holds@1`**: the push banner's auto-merge skips a held PR and Merge refuses it.

Live: the page asks `board?since=<stamp>` every 20 s while visible; the server answers `{same: true}` until something
changes and rebuilds in the background (a read never waits behind GitHub).

## Commands

Every route is a plugin command (plugin-commands@1): REST `/api/control/git-status/<command>`, MCP
`git-status_<command>`, CLI `axf git-status <command>`: `board`, `sections`, `list --section ready`, `item --key …`,
`files`, `batches`, `merge`, `hold`, `update`, `rerun`, `fix`, `land`, `close`, `kill`, `batch-new`, `batch-add`,
`batch-take-out`, `batch-order`, `batch-merge-next`, `batch-remove`. Keys: `MossesX/AmberX-AXF#287` (a PR),
`MossesX/AmberX-AXF:claude/x` (a pushed branch), `wt:<path>` (a checkout).

Data folder `.axf-console/plugins/git-status`: `holds.json`, `batches.json`. Self-test: `python3 test.py`.
