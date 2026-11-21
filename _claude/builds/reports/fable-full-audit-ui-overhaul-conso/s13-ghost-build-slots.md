# s13: ghost build processes holding build slots

## Found

1. **Root cause: a killed tmux session did not end its claude.** `deploy/claude-headless.sh` (inner run) trapped HUP/TERM
   but ran `claude -p … | tee | claude-stream | tee` in the foreground. Bash runs a trap only after the foreground
   command returns, and the pane's HUP reaches the session leader (the pane bash) only, never the pipeline. So after
   `tmux kill-session` the pane bash stayed (orphaned under the tmux server, no tty) waiting on a claude that never got
   a signal. A real claude usually died later on a broken pipe; a quiet one (the build-limit test's stand-in) never did.
   Reproduced on the VPS: one run of `framework/spec/check-build-limit.mjs` left a live stand-in plus its pane bash.
2. **The test deleted its folder under a live process.** `check-build-limit.mjs` wrote the stand-ins' `go` file, killed
   the sessions and removed `/tmp/axf-limit-*` straight after; the stand-in polls every 0.2 s, so it often never saw
   `go`, then looped forever on a path that no longer existed. If the test was killed outright (timeout), its sessions
   stayed and the reaper's tmp sweep later deleted the folder under them: the same ghost.
3. **The hard limit counted them.** `build-limit.mjs` counts every `claude -p` tree on the host, so each ghost held a
   real build place (10-15 hours seen, Nov 20).
4. Already on main before this step (#857): the reaper kills test-run claudes from gone or hours-old `/tmp/axf-limit-*`
   folders and their tmux sessions. That clears ghosts after the fact; 1-3 above stop them being made and counted.

## Fixed

- `deploy/claude-headless.sh`: the run pipeline goes to the background and is waited for (exit code still claude's);
  the HUP/TERM trap now signals the pipeline, records the run end, then exits. `tmux kill-session` ends the run at once.
- `framework/cli/build-limit.mjs`: `notABuild()`: a stand-in from a `/tmp/axf-limit-*` sandbox, or a claude whose
  `/tmp` folder was deleted, holds no place. They are listed as "not counted" (with why) in `status`, the snapshot and
  the console data. A claude in a deleted build worktree still counts (the reaper judges that one). The test's own run
  (`AXF_BUILD_LIMIT_ONLY`) still counts its stand-ins.
- `framework/spec/check-build-limit.mjs`: the stand-in ends by itself when its folder is gone, the test is gone, or
  after 3 min; cleanup waits for nothing to run from the sandbox (SIGKILL as last resort) before deleting it. New
  checks: ghosts not counted / deleted worktree still counted; `tmux kill-session` ends a quiet claude and its pane; no
  process outlives the test. The kill-session check fails on the old launcher (verified).
- Killed the one ghost my first reproduction left on the VPS.

## Tests

- `check-build-limit` 60/60, `check-reaper` 15, `check-agent-slots` 56/56 (with no AXF_BUILD_ID in the environment),
  `claude-headless-brief.test.sh` 14/14, `check-headless-context` 38, `check-build-rules` 27, `claude-workers` and
  `claude-login` node tests pass.
- Not mine: `check-shipped-manifest` fails on a builds-store landing check ("landed with no merge time … is
  complete"); this step touches none of that code.

## Note

`/usr/local/lib/axf/build-limit.mjs` (the host copy) picks up the change on the next `deploy/install-build-limit.sh`.
