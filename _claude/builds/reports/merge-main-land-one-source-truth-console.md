# merge-main-land-one-source-truth-console

Auto-land could not land `one-source-truth-console-shows-only-what` (PR #598): merging main clashed in
`apps/console-web/plugins/build-orchestrator/pipeline.mjs`. Merged main into
`claude/one-source-truth-console-shows-only-what` and pushed; no new PR.

## Resolution (both sides kept)
- `status()`: keeps the branch's `live` summary and main's `state.authWaits`.
- `checkEnds()`: with a fresh live truth a session ends after the start grace (branch); without one it falls back to
  tmux + the 10-minute grace (main). Either way a live session beats the build lock, and a build whose own session is
  gone is only called dead when `buildLive()` finds no renamed duplicate or claude pid (main).
- `reapBuilds({ truth, env })`: live-truth grace (branch) plus main's liveness confirm / adopt / lock release.
- `selfCheck()` passes `{ truth, env }` to the reaper.
- `tick()`: alias assignment, live-truth read, `checkEnds`, login-failure re-queue (`authWaitsTick`), then the
  live-truth reap / stale settling / 3-second publisher.
- CLI: both `pipeline live` and `pipeline auth-waits` commands.

## Checks
- `node --test` pipeline.test.mjs (53 checks) and build-id.test.mjs: pass.
- `node framework/cli/tracker.mjs --check`: pass.
- `git merge-tree origin/main HEAD`: clean after the push.

No UI change in this merge; API reach is unchanged from the two sides (status `live` / `state.authWaits`, CLI
`live` / `auth-waits`).
