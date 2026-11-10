# Failed launches rerun on another working account (failed-launches-auto-retry-on-another-working-ac)

Phase 1, Opus, headless on Moses X. Branch `claude/failed-launches-auto-retry-on-another-working-ac`.

## Brett said (verbatim, 2026-11-10 00:19 UTC)
> When shit needs a rerun, rerun it. Find one that works. The orchestrator knows. It shouldn't just fail. It should find a new one and try it. Somebody else.

## Why builds failed (root cause)
15 builds were marked failed on Nov 9. Each one died within about a minute, 0 turns, $0, three times on the same account:

- account-1 / account-3 printed `Failed to authenticate: OAuth session expired and could not be refreshed`. The dead-login pattern in `deploy/claude-workers.mjs` (`hitOf`) didn't match that text, so the account was never marked out. The dispatcher relaunched on the same dead login until `maxRuns` (3), then failed the build.
- skins-theme-rule / skins-restyle-finish (Fable, Moses X) printed `You're out of usage credits.` The limit pattern only knew `out of credits`.
- The dispatcher's alert link `#/build-orchestrator` is rejected by `POST /api/alerts` ("link must be http(s)://, view:<id> or settings:<tab>"). So no dispatcher alert (idle, ended, failed) ever reached the bell, and nobody was told.

## What was built
| Asked | Where |
|---|---|
| Mark the dead account | `checkEnds()` reads the end of the run log (`<worktree>/<id>.log`). An account hit (login expired, usage limit, out of credits) calls `markLimit()`: a login is parked for `authHoldMin` (60 min, setting), a limit until the reset time it names, else 5 h. `markLimit` gained `holdMs`. |
| Re-launch on the next working account, keep going until one works | The build goes straight back to the Queue (`endOutcome(…, { hit })`) and the run is not counted toward `maxRuns`. The same tick routes it through the existing rules: subscriptions first, then API overflow within its caps. The marked account is out, so it's always somebody else. A launch the account refuses (launcher error text) does the same and doesn't count toward the 3-per-hour launch-fail cap. |
| Resume from the last ticked step | `resumeBlock()` adds a `## Resume` section to the brief on any rerun: which steps are ticked, `git status` / `git log` first, carry on from the first open step. The worktree is reused, so half-done work stays. |
| Model fallback | `plan()`: a Fable phase whose every Fable account is out (not merely busy) runs on Opus when `fableFallback: opus` (default; a downgrade, allowed), or waits for the reset (`wait`). Either way the launch / wait line says which, and when Fable comes back. A busy Fable account is always waited for. |
| Log every retry | Build note (Activity Monitor reads every build note), fix-log entry (`POST /api/plugins/build-orchestrator/pipeline/fixlog` → `axf.changes@1`), `log.jsonl` `rerouted` / `launch-rerouted`, FYI alert `pipeline:retry:<id>` (notify type `pipeline.retry`, no push). |
| Tell Brett only when every account is out | `plan().exhausted`: no account usable or merely busy, for Opus or the pinned model. One alert per spell (`pipeline:exhausted`, push, high) naming each account's state and the exact next reset ("Every Claude account is out until Nov 10 04:30 UTC"). Resolved when an account comes back. `noAccountWhy()` names the next reset too. |
| Re-queue every build that died on login / credits | `pipeline.mjs rerun <id…>` and `rerun --account-failures` (fresh run count, resumes at the first open step). Run live, see below. |

## Re-queued now (live store, through builds-live)
`rerun --account-failures` found and re-queued 13: account-failover-chain, skins-own-everything-colour-theme-swaps-independ, orchestrator-and-build-manager-search-bar-collap, urgent-terminal-pops-up, let-voice-api-route, test-button-on-every-claude-account, split-builds-pages (…-complet and …-complet-3), vps-orchestrator-only-rule, home-page-build-queue-card, prompt-caching-and-batch-api, file-watchdog, amberx-floating-toolbar. By id: appearance-skins-colour-themes-only-remove-design-packs. A later run overwrote its log, so auto-detection missed it.

skins-theme-rule and skins-restyle-finish were hand-launched Fable sessions with no build record. Their uncommitted work (11 and 28 files) is still in their worktrees. Each was filed as an orchestrator build with the worktree's id (so the rerun lands in that worktree), with steps written from the run's own narration, and queued. split-builds-pages-…-2 was Pending, not failed, so it stays where it is.

They run on Moses X (the only working subscription: account-1 is removed, account-3 is switched off for the pipeline). The first one, account-failover-chain, started at 00:55 UTC.

**account-5:** turning API overflow on bills per token, and the console only lets Brett's own click do it, so this session didn't. The pipeline's API account list is set to `account-5` only. A bell alert (`pipeline:ask:overflow-account-5`) tells Brett the one tap: Orchestrator → Pipeline → API overflow on.

## API (all four the same)
- **REST**: `POST /api/plugins/build-orchestrator/pipeline/rerun` `{ids?, accountFailures?}`. `POST …/pipeline/settings` takes `fableFallback` (opus|wait) and `authHoldMin`. `GET …/pipeline` carries `plan.exhausted`, `launches[].fallback/pinned` and `state.recent` `rerouted` events. `POST …/pipeline/fixlog` is the dispatcher's own route into the change log.
- **MCP**: `build_orchestrator_pipeline_rerun` (new plugin command `pipeline-rerun`); `pipeline-settings-set` schema gained `fableFallback` and `authHoldMin`.
- **CLI**: `node apps/console-web/plugins/build-orchestrator/pipeline.mjs rerun <id…> | rerun --account-failures`; `pipeline.mjs set fableFallback=wait authHoldMin=90`.
- **Voice**: through plugin-commands@1 ("rerun the builds that died on a login").
- **Deep link**: `view:build-orchestrator` (Pipeline tab): the "Fable out → Opus" switch, the "Rerun account failures" button, and a red note when every account is out.

## Also fixed
- `ALERT_LINK` is now `view:build-orchestrator`. Before this, every dispatcher alert was refused by the alerts API (verified live: the new shape is accepted).
- The headless launcher's own in-session limit check knows "out of usage credits".

## Tests
- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 42 checks, 7 new. These cover the uncounted requeue with its note, Fable→Opus vs wait, busy-is-not-out, every-account-out with the earliest reset and the API overflow case, resume block, settings clamps and the alert link. End to end: a dead-login session end marks the account out, reroutes to another account with a resume brief, and `rerun --account-failures` picks the credits failure but not a code failure.
- `python3 apps/console-web/plugins/build-orchestrator/test.py`: 37 checks (rerun route, bad ids, new settings, fix-log entry through `axf.changes@1`).
- `node deploy/claude-workers.test.mjs`: 68 checks (both real error texts, `holdMs`).
- `node apps/console-web/plugins/build-orchestrator/test.mjs`, `check-theme`, `check-controls`, `check-toolbars`, `plugin-commands check` (67/67), `tsc --noEmit` (console-web), `bash -n deploy/claude-headless.sh`: green.
- `plugin-lifecycle check build-orchestrator`: two stale-reference lines in `framework/cli/dispatch-gate.mjs`, already there before this build.

## Gaps / choices
- **UI Review: no shots taken.** The Pipeline tab gained a switch, a button and a note (framework Switch / Button / Note, no new CSS). Shots need a scratch console build of this branch, which didn't fit this phase. They're still owed before the PR counts as ready.
- `fableFallback` defaults to `opus` because Brett's standing rule says a downgrade is fine and he asked that nothing waits. Set `wait` to keep Fable work on Fable.
- A login marked dead stays out for 60 min (`authHoldMin`). Signing it in again doesn't clear the mark early.
- The deployed dispatcher runs main: the failover takes effect when this lands. Until then the re-queued builds run on Moses X under the old rules.
- account-failover-chain (now running) got a note pointing at this branch so it builds on it instead of duplicating it.
