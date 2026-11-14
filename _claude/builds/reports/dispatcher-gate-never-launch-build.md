# dispatcher-gate-never-launch-build

Branch `claude/dispatcher-gate-never-launch-build` · Opus · Nov 13 2026

Brett said (Nov 13 2026 20:07): "what's up with the parallel build that breaks a build up to run on multiple sessions"

## s1: dispatch gate, one live session per build (build-lock@1)

The bug: on Nov 13 the dispatcher launched the same build phase twice on one worktree (ui-manager-floating-window-to-select-any
three times; orchestrator-settings-collapsible-split too: `--earl`, `--earl-191118` and `--joey` ran together, $23.41 + $2.71 +
$1.86). Two causes:

1. `deploy/claude-headless.sh` renamed a clashing tmux session (`-HHMMSS`) and started a second one beside it.
2. The self-check (`reapBuilds`) released a build with no session on record back to the Queue without checking whether a
   session was alive, and the next tick launched it again.

The fix:

- `framework/cli/build-lock.mjs` answers "is anything alive for this build": tmux `axf-<id>`, `axf-<id>--<agent>`, either with the
  `-HHMMSS` suffix; claude processes whose cwd is the worktree or that carry `AXF_BUILD_ID=<id>`; and `<worktree>/.axf-build.lock`
  (build, session, account, heartbeat). A lock whose heartbeat is older than 20 min has expired.
- `pipeline.mjs launch()` takes the lock or refuses (code `live`). The tick records a wait (not a launch failure, no other account
  tried), and when a Queued build still has a live tmux session it goes back to running on that session.
- `reapBuilds` confirms tmux and pids are dead before releasing; when a session is alive it adopts it instead.
- `checkEnds` counts a missing own session as a crash only when no other session or claude pid for the build is alive. It beats
  the lock while the session lives and releases it at session end.
- `claude-headless.sh` refuses a build launch (`AXF_BUILD_ID` set) beside a live session instead of renaming; other runs keep the
  rename.
- Tests: `framework/spec/check-build-lock.mjs` (8 checks, in CI) and a double-dispatch end to end in `pipeline.test.mjs` (self-check
  keeps a live build, a second launch is refused and adopted, a fresh lock blocks, a stale lock expires and launches once, the lock
  goes at session end).

How it is reached: CLI `node framework/cli/build-lock.mjs check|acquire|beat|release <build> --dir <worktree> [--json]`. The
dispatcher, self-check and launcher call it themselves. It has no UI. Refusals show in the orchestrator as a wait
("already has a live session: …") on the build and in the pipeline log (`launch-gated`, `reap-skipped-alive`, `still-alive`).

## s2: the parallel split, where it stands

Build `orchestrator-settings-collapsible-split` (P1), PR #636. **Not live.**

- s1 (Fable) is done and pushed: the `parallel` record on builds (lead / part), settings `parallelSplit` auto|ask|off,
  `parallelMax` 2..12, `parallelContract`, `parallelIntegrate`, and the splitter files each part as its own build
  (`<lead>-p1`, `-p2`…). The lead keeps the contract step (runs first) and the integration step (runs last, after every part).
- s2 to s8 (Opus) are open: the collapsible Split section in settings, gathering the existing split options, parent/child grouping
  and combined progress, the "split into N parallel" override when filing, full API, tests and the report.
- The build is back in Pending: the reconciler paused it at 20:19 with no live session. Its first run hit the double-launch bug
  above (three sessions at once, about $28 spent).
- PR #636's light check fails on `Property 'overlay' / 'overlayCommand' does not exist on type 'VetoHost'`. That comes from main,
  not from #636: `apps/axhub-web/src/axf/libs/hub/veto.ts` is missing `overlayCommand`, which the console-web and amberx-droid
  copies have. Any PR whose check type-checks axhub-web hits it until the copies are synced again.

Safe with the gate: every part has its own build id, so it gets its own worktree (`/root/axf-builds/<part>`), its own branch
(`claude/<part>`), its own tmux name and its own lock. The session matcher never confuses `axf-<lead>` with `axf-<lead>-p1`
(tested). The rule "parallel sub-builds never share a worktree" holds without any extra code, because `ensureWorktree` is per
id.

To make it live: merge this PR first, then queue `orchestrator-settings-collapsible-split` again for s2 to s8. Keep
`parallelSplit` off until #636 lands.

## Gaps

- No Kotlin twin needed: host-side dispatcher tooling only.
- The lock heartbeat comes from the dispatcher tick (every minute while the session is alive), not from the session itself. A
  launch that waits in the agent-slots queue for more than 20 min before tmux starts has an expired lock, but by then the slot
  entry holds the build (the reaper skips builds whose slot is held).
