# Self-healing build folders (self-healing-build-folders-auto-clear-stale-git)

Brett, Nov 10 2026: "Anytime that happens, you gotta remove that. You guys have to deal with the problems. I can't have
it just stop working every time something goes wrong. Put in the code: if something breaks, it needs to remove locks.
Put it in the code so it doesn't rely on AI."

## What shipped

Plain Node, zero model calls: `framework/cli/self-heal.mjs`.

| Problem | What the code does | Runs from |
| --- | --- | --- |
| Stale git locks (index.lock, HEAD.lock, config.lock, packed-refs.lock, refs/**.lock, per-worktree locks) in `/opt/axf/.git` and every `/root/axf-builds/*` | Removed when older than 2 minutes and no live process has the file open or runs git in that checkout. A `git worktree lock` marker whose folder is gone is removed too. | every dispatcher tick, before every launch, every landing round, `self-heal.mjs locks/run` |
| A git command refused on a lock | The lock it names is cleared (after 3 s, only when nobody holds it) and the command runs once more | every git call in pipeline.mjs, land.mjs (auto-land + merge queue) and builds-live.mjs |
| Stray files blocking a merge / checkout ("would be overwritten") | Logs, `.axf-*` scratch files and `_claude/builds` sync files are archived (`/root/archive/self-heal`), tracked ones restored, untracked ones removed, then the git call runs again. Code is never touched. | same git guard |
| A tracked log a tool rewrote (`assets.log`, build logs) in a finished build's worktree | No longer reported as uncommitted code: archived and put back, so the landing carries on | auto-land `cleanWorktree` (land-core `strayPlan`) |
| Crashed sessions: build marked running, tmux up, no claude in it (or the pane is dead), no session-end, past the 10-minute grace | The empty tmux session is killed; the same tick's session-end check records the crash and requeues the build (or fails it after max runs) | every dispatcher tick |
| A launcher that fails on a git lock | The lock is cleared and the build is launched once more | `launch()` |
| The same build launched twice into one folder (happened on this build: two sessions, one billed per token) | The dispatcher refuses to start a build that already has a live `axf-<id>--*` session with claude running | every dispatcher tick |

Every fix: one line in the fix log (`/var/tmp/axf-heal/fixes.jsonl`, `self-heal.mjs log`), an "Automatic fix (self-heal,
no AI): …" note on the build that owns the folder, and one FYI per round: into the console's fix log when a plugin
provides fix-log@1 (found by capability; it notifies AmberX), else a plain console alert. Nothing to approve.
builds-live runs git under the store lock, so its fixes skip the build note (fix log + FYI still go out).

## Already used

A dry run on the VPS found 10 stale `index.lock` files under `/opt/axf/.git/worktrees/*`, 20 minutes to 5 days old,
none held. `self-heal.mjs locks` removed them (fix log lines + notes on those builds). A second run finds none.

## How to reach it (no UI)

- CLI: `node framework/cli/self-heal.mjs run [--dry-run] [--json]` (locks + crashed sessions), `locks`, `log [--limit n]`,
  `git -C <dir> -- <git args>` (any git command with the guard).
- Dispatcher: `pipeline.mjs tick --json` returns `healed` (the fixes this tick); `log.jsonl` has `self-heal` and
  `launch-refused-duplicate` events.
- FYI and history: console alerts / the fix log (REST, MCP, voice reach those through their own APIs).

## Tests

- `framework/spec/check-self-heal.mjs` (13, in CI): fake stale / young / held locks, a dead worktree marker, real git
  calls refused on a lock and retried, real merges blocked by stray logs and sync files, code never touched, crashed
  sessions with fake tmux panes, fix log + FYI, capability lookup, no model client.
- `pipeline.test.mjs` (37): the tick clears a stale lock in a build folder and leaves a fresh one; a build with a live
  session is not launched twice and is launched once that session is gone.
- `land.test.mjs` (95): tracked logs are restored, journals still committed; self-heal.mjs is held to the same
  zero-token rule as the merge pipeline. `merge-queue.test.mjs` (11), `check-builds-live.mjs` (62),
  `check-builds-store.mjs` (40), `check-builds-store-lock.mjs` (5), `build-orchestrator/test.mjs` (33) green.

## Notes

- This build was dispatched twice (Janitor Joey on account-5, an API key, and Ping Paulie on mossesx-max-), into the
  same folder, two minutes apart. Both started writing a version; both backed off on seeing the other. Joey's
  `self-heal.mjs` (more complete: stray files and merge retry) was restored from `/root/archive/self-heal-joey-2026-11-10/`
  and finished here; Paulie's `git-heal.mjs` draft was dropped. The duplicate-launch guard above is the fix.
- The fix-log plugin (PR #418) and the slot reaper (PR #421) are not on main yet. The FYI finds the fix log by
  capability when it lands; crashed-session reset only kills the dead tmux session and leaves the slot to the reaper.
- Root cause of the double dispatch is not found (the build went back to the Queue while Joey's session ran); the guard
  stops the damage whatever the cause.
