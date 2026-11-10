# Multi-account headless workers (build multi-account-headless-workers, Nov 7 2026)

The console stays on one Claude subscription. Other saved accounts can be marked as workers: they only run headless jobs, side by side, each job on a private copy of the login.

## Audit: what was reused

| Existing | Used for |
|---|---|
| `deploy/claude-login.mjs` (private login copy per build) | Runs a job on any saved account without touching the live login. This already made parallel subscriptions possible. |
| `deploy/claude-token-save.mjs` | Rotated tokens go back to the worker's saved login, unchanged. |
| `claude-accounts` plugin, `vps_read`, the held `vps.run` | Reads and writes. New commands go down the same path. |
| `session-login` / `session-end` events and `headless-meter@1` | The per-account ledger. |
| agent-slots, agent booking, orchestrator notes | Unchanged. Routing happens after the slot is granted. |

Replaced for worker runs: the limit loop in `claude-headless.sh` called AI keys `/switch`, which flips the global active account, so one build's limit moved the console too. Unrouted runs keep that path.

## What shipped

- `deploy/claude-workers.mjs` (`claude-workers@1`): `route`, `limit`, `hit`, `status`, `signin`, `remove`, `note`.
- `claude-headless.sh`: a job with no `--account` goes to the least busy worker. A usage limit takes the worker out until the reset time in Claude's message (else 5 hours). A dead login takes it out for 10 minutes. The run moves on and is told to carry on from the worktree.
- `claude-accounts` 0.3.0: roles, `POST role | signin | remove`, usage per account, a worker can't be switched to, health check *Claude worker accounts*.
- AI keys: the console's limit switch skips workers.
- UI (Builds → Claude accounts and its settings tab): Worker and limit chips, usage line, Make / Stop worker, Sign in, Remove, Add a worker account, Recent headless runs.

Sign in runs `claude auth login` with `CLAUDE_CONFIG_DIR` set to the account's own folder in a tmux session the Terminal opens, so the live login is never touched.

## Decisions to check

1. **Nothing changes until an account is marked.** No workers = the launcher behaves exactly as before.
2. **No worker free = the job runs on the console's account**, with a note on the build and the systems check red. A build never stalls, but it can spend the console's quota. If workers should wait instead, that is a small change.
3. **This overrides the Nov 5 `account-switch-handoff` rule** ("They can only run on one account"), and that brief stays as history.
4. **A move between workers sends no approval.** The Nov 5 `account-failover` brief asked for an approval after every switch. A worker move doesn't change the console's account, so it gets a build note instead. Changing the console's account still goes through the held call.
5. **Role changes aren't held.** They only write `workers.json`, no credential moves. Sign-in and remove are held.
6. **API keys are never workers,** matching the rule that they stay last and need an approval.
7. The record format is build tooling kept as small as possible, on Opus as pinned. If it grows into a cross-app contract it should get a Fable look.

## Tests

- `node deploy/claude-workers.test.mjs`: 37 checks, in CI. Includes `claude-headless.sh` end to end in tmux with a fake claude: worker one hits a limit, the run moves to worker two, the console's account and the live login stay unchanged, and no credential reaches the events.
- `claude-accounts/test.py`: 74 (was 47). `ai-keys/test.py`: 133. `claude-login.test.mjs`: 51. `claude-badge/test.py`: 40.
- Passing locally: tsc, vite build, check-theme, check-controls, check-toolbars, check-chrome-assets, help coverage, plugin-commands (both), check-control, menu-reach, plugin-lifecycle.

## Not tested

- **No real sign-in, and no real run on a second subscription.** Those need Brett's click and would spend quota. The fake claude covers the launcher only.
- The held `vps.run` path is covered with a fake hub. The ssh read with the new `status` command wasn't run from the console container.
- The wording of Claude's limit message is matched from the patterns already in the launcher and the formats known so far. A format it can't read falls back to 5 hours.
- A failed exit on a limit message isn't required, as before. A dead login is only counted on a failed exit.

## Known gaps

- **Usage is what headless runs cost, not the subscription's remaining quota.** No reader for used vs total exists on main. Steps s36-s39 of `token-usage-log-accounts-plan-studio-control-small-steps` own that, and it should plug into the same row.
- **Two jobs on one worker share a refresh token.** The first renewal spends it, so the second may lose its login and move on. Routing prefers idle workers, so this needs more jobs than workers.
- **A move restarts the same brief** with a note to carry on. It keeps the worktree but not the conversation.
- Plan is shown only for accounts the console has seen active.

## Overlaps

- `claude-accounts-edit`: Sign in on a row covers re-logging an account in place. Its wizard Edit button and error text are still open.
- `running-builds-follow-the-active-claude-account-fail-over-when-it-dies`: failover is built here for workers. Following the active account is unchanged.
- `console-account-picker` s4 and `auto-switch-claude-account-when-the-active-one-r`: unchanged, but they must skip workers.

## Found on the way

The console's status commits had stopped on Nov 6: 98 outbox lines, which is why this build's record wasn't on main. Two causes, both fixed in PR #381 (`claude/builds-journal-parts`): the journal reached GitHub's file limit, and one bad record failed every batch. The batch was published by hand through the new code. The journal still grows about 14 MB a day, and foreign-write absorbs from the hub's `pending.json` caused the bad records. Neither is fixed.

Shots: mocked data, UI Review, group "multi-account-headless-workers".
