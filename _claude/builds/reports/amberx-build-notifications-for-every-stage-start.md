# AmberX build notifications for every stage: start, complete, ready to merge, merged, live

Build `amberx-build-notifications-for-every-stage-start` · Opus · branch `claude/amberx-build-notifications-for-every-stage-start` · stacked on #436

## Brett said (verbatim, Nov 10 2026 20:56)

> I'll get a notification every time a build starts, completes, ready for merge, and goes live, right?

## The answer before this build

Partly. #436 (`one-amberx-build-notification-veto-approval-befo`, built, not merged) covers **start** (the veto pop-up, then Started) and **complete** (Finished, with the outcome), and only for builds the dispatcher launches. Nothing sent **ready to merge**, **merged** or **live**.

## What changed

**Stacked on #436.** #436 is not on main yet, so its branch is merged into this one (conflicts with main's account health sweep, build actions and multi-account pick resolved; the veto now holds the plan's first pick before the account fallback loop). This PR includes #436. Land #436 first or land this PR in its place.

**Three stages after the finish.** The dispatcher tick (cron every minute on the VPS) now also runs `checkStages` every 3 minutes:

| Stage | When | AmberX reads |
|---|---|---|
| Ready to merge | the PR is open, not a draft, and its checks are green (GitHub `statusCheckRollup` SUCCESS) | `Ready to merge: <build>: ready to merge, PR #n, CI green` |
| Merged | GitHub says the PR is merged, or the build carries `mergedAt` (reconciler / merge queue) | `Merged: <build>: merged, PR #n` |
| Live | the console's newest successful deploy-log@1 record (`.axf-console/deploys/log.jsonl`) contains the merge commit (git ancestry) | `Live: <build>: live on the console` |

- **One notification per build.** Each stage resolves the build's earlier start, finish and stage alerts (keys `pipeline:ready|merged|live:<id>`), so AmberX takes the old one away and shows the new one. Repeats on one key don't re-push to the phone (alerts.py), so a fresh key per stage plus resolving the old one is how "updates in place" reaches the phone. A new run of the build clears its stage alerts and starts the chain again. With `notifyGrouping: each`, every event stays.
- **No spam.** A build that jumps stages between two checks gets one pop-up, for the furthest stage. Stages never go back. The very first check only records where every build stands, so the backlog never pops up.
- **Which builds.** Every built or complete build with a PR (or run by the dispatcher), finished in the last 14 days, until it is live. A real run found that only 10 of 282 recent finished builds were dispatcher-run, so following only those would have missed most of them.
- **GitHub cost.** One GraphQL query per 50 PRs, only for builds not yet merged (a merged build with a known commit needs only git). Real data: 214 builds followed, 119 asked on the second check, so 3 queries every 3 minutes.

**Per-stage on/off.**
- Build orchestrator → Pipeline → Phone pop-ups: switches for Ready to merge, Merged and Live, next to Build finished (`notifyReady`, `notifyMerged`, `notifyLive` in pipeline-settings@1, on by default).
- Notifications panel: three new types, `pipeline.ready`, `pipeline.merged` and `pipeline.live`, for the channels and quiet hours.
- Turning a stage off still records it, so turning it back on doesn't replay old stages.

## API control (everything with a UI)

| | REST | MCP | CLI | Voice |
|---|---|---|---|---|
| Where every build stands | `GET /api/plugins/build-orchestrator/pipeline/stages`; also `stages` in `GET pipeline` | `pipeline-stages` | `pipeline.mjs stages [--check]` (`--check` = check now) | ask Amber (MCP tool) |
| Per-stage switches | `POST pipeline/settings {notifyReady, notifyMerged, notifyLive}` | `pipeline-settings-set` | `pipeline.mjs set notifyLive=false` | ask Amber |
| Open the build from the pop-up | link `<console>/?axf-action=build-orchestrator.open-build:<id>` | console action `build-orchestrator.open-build:<id>` | — | ask Amber |
| The panel | `console_open view:build-orchestrator` (Pipeline tab, Phone pop-ups) | console action `nav:build-orchestrator` | — | ask Amber |

## Checked

- `pipeline.test.mjs` 58 checks: stage rules, alerts, keys and what each replaces, notify types, and `checkStages` in-process (first check records only, CI turning green sends Ready, a stage switched off records but doesn't send, a deploy containing the merge commit sends Live and stops following, throttle, a new run restarts the chain, the CLI listing).
- `test.py` 44 checks (the stages endpoint, per-stage switches reach the CLI). `test.mjs` 33. notify-control 132. `test_alerts.py`.
- `tsc --noEmit` (console-web), check-theme, check-controls, check-toolbars and check-chrome-assets all pass.
- Real data, read-only (scratch state dir, alerts off): the GitHub query and the deploy log work. 214 builds followed: 94 live, 43 ready to merge, 1 merged, 76 still built.

## Left

- **UI Review shots** (Phone pop-ups with the three new switches, desktop and phone) aren't taken. This headless session has no console with a backend and login to capture from (same as #436). Capture Build orchestrator → Pipeline → Phone pop-ups and submit.
- **#436 first.** This PR contains it. Close #436 in favour of this one, or land #436 and this one rebases cleanly.
- **Real phone test after deploy.** The first tick after deploy only records. The first real pop-up is the next build that turns green, merges or goes live.
- **AmberX twin deferred** (PORTING.md): replace the build's notification by `meta.build` in `WatchService.consoleAlert` instead of posting one per key. Until then the phone shows the newest stage and the resolved one goes away.
- **Builds that land without a PR** (fast-forward `build_land`) only get Merged / Live when the store has `mergedAt`.
