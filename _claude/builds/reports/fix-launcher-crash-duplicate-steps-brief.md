# Fix launcher crash: duplicate steps + brief too big

Build `fix-launcher-crash-duplicate-steps-brief`, branch `claude/fix-launcher-crash-duplicate-steps-brief`.
Brett (Nov 17 2026): "That failed. Shouldn't the VPS be doing this on its own? Nothing should be sitting there."

## What broke

1. **Steps doubled on every sync.** Two copies of the builds store (a build worktree's, main's, `/opt/axf`'s) that gave
   the same step different uids merged into *both* copies: `mergeBuild` matched steps by uid only and kept a loser's
   step whose `createdAt` was newer than the winner's `updatedAt`. Every builds-live publish / pull / foreign-write
   absorb doubled the list (16 → 32 → … → 2,682). This build itself had 240 steps (16 real ones) when it started.
2. **The launch crashed with E2BIG.** `deploy/claude-headless.sh` passed the whole brief to `claude -p` as one argv
   string. Linux refuses any single argument over 128 KB (`MAX_ARG_STRLEN`): a brief carrying 700+ repeated steps
   made exec fail (`line 416: …/claude: Argument list too long`, exit 126) before Claude started.
3. **Nothing retried it.** A launch crash counted as a run against the 3-run cap and parked the build.
4. **A clash sat.** A build with every step done whose branch clashed with main (Phone Connect #787) waited in
   Pending / fixing for someone to merge main in.

## What changed

| Piece | Where | Behaviour |
|---|---|---|
| Merge by text | `framework/plan/builds-merge-core.mjs` `mergeBuild` | a step is matched by uid, then by normalized text; a done copy wins; repeats collapsed |
| Dedupe guard | `builds-store-core.mjs` `dedupeSteps` / `normBuild`, `builds-store.mjs` `saveStore` | every read normalizes, every write collapses repeats in the builds it touched (normalized text, done copy wins, order of first appearance) |
| Re-split | `pipeline.mjs` `splitBuild` (already replaced not-done steps) | pinned by tests: re-split twice keeps the count, done steps keep flag and uid |
| Cleanup | `builds-store.mjs dedupe-steps [--dry-run\|--apply] [--from f] [build…]` | collapses repeats, tidies `s65-64` ids where free, one journalled revision + note per build, newer `updatedAt` so every copy's newer-wins merge takes it |
| Launcher | `deploy/claude-headless.sh` | the prompt goes to `claude -p` on **stdin** from a temp file (tmux path and no-tmux fallback), removed on exit |
| Brief cap | `orchestrator-core.mjs` `briefStepLines`, `pipeline.mjs` `fitBriefFor`, Claude setting `builds.briefMaxBytes` (default 120 KB) | > 40 steps: done count + next 40 open + "N more steps in the store"; over the cap: fewer steps, then the rules block, then the phase brief; "Brett said (verbatim)" and the Pipeline paragraph are never cut; a trim is logged and noted on the build |
| Launch-crash retry | `pipeline-core.mjs` `launchCrashOf`, `pipeline.mjs` `endRun` / `requeueLaunchCrash`, `build-pipeline.mjs` `pipeline.launchRetry` | E2BIG / launcher error / empty stream after launch → back to the Queue after 1, 4, 16 min, not counted as a run; after 3 in a row: `gaveUp`, banner alert, systems check item "Builds crashing at launch" with a Requeue auto fix |
| Land-clash bounce | `pipeline-core.mjs` `clashBounceStep`, `pipeline.mjs` `detectFailures` / `bounceClash`, `pipeline.bounce` | a done build that clashes gets one Opus step "Merge main into <branch> and resolve conflicts in <files> (clash at <head>)" and goes back to the Queue; the same head never adds a second step; only a live lander fix agent on that head is waited for |

## Duplicate steps: before / after

Cleanup run on the live store Nov 17 2026 (`builds-store.mjs dedupe-steps --apply --from <pre-fix snapshot>`), one
journalled revision per build, published to main through builds-live. Main and `/opt/axf` have no repeated steps
after it. (The first publish from this branch had already written main's store back normalized; the cleanup made it a
journalled, newer write per build so copies still on the old merge take the clean list.)

| Build | Before | After |
|---|---:|---:|
| api-fully-drives-every-field-type-forms | 2682 | 18 |
| dispatcher-split-builds-evenly-across | 2171 | 13 |
| vps-sets-every-build-status-manifest | 750 | 15 |
| one-true-source-for-every-setting | 720 | 20 |
| auto-lander-never-wait-missing-ui-review | 544 | 17 |
| fix-launcher-crash-duplicate-steps-brief | 240 | 16 |
| remove-amberx-app-code-once-phone | 224 | 7 |
| terminal-main-tab-streaming-console-s | 168 | 14 |
| molly-console-commands | 112 | 7 |
| auto-lander-settings-log-placeholder | 108 | 9 |
| profile-filter-tables | 96 | 4 |
| settings-fix-part-2-blank-toolbars | 84 | 21 |
| headless-session-efficiency-shared-chain-control | 32 | 16 |
| always-fill-every-slot-when-slots-are | 30 | 27 |
| server-watchdog-orchestrator-auto-recovers-stuck | 25 | 22 |
| every-plugin-screen-gets-a-settings-gear | 24 | 21 |
| server-rule-done-means-merged-working | 18 | 17 |
| stop-auto-lander-committing-tracking | 16 | 15 |
| context-menus-plugin-one-true-source | 12 | 9 |
| pass-approval-hook-deep-link-amberx-notification | 11 | 10 |
| running-builds-follow-the-active-claude-account-fail-over-when-it-dies | 10 | 5 |
| grindr-ai-wingman | 10 | 5 |
| new-app-wizard | 10 | 5 |
| orchestrator-settings-collapsible-split | 10 | 9 |
| molly-ri-court-records | 8 | 4 |
| fix-step-splitter-claude-exit-1-input | 8 | 4 |
| approvals-no-window-spam-on-approve-veto-only-for-vps-writes-and-account-switc | 6 | 3 |
| group-chat-audio-hear-agents-talk-while | 6 | 5 |
| amberx-open-any-url-apk | 4 | 2 |
| **Total (29 builds)** | **8139** | **340** |


Stale per-worktree store copies of finished builds still hold repeats until they next pull main; any copy that pulls
takes main's newer record, and once this lands no writer can store a repeat again.

## Launcher behaviour

| | Before | After |
|---|---|---|
| 300 KB brief | `line 416: claude: Argument list too long` (exit 126), Claude never starts | starts; the fake claude reads all 300,000+ bytes on stdin; no argument near 128 KB; prompt file removed after the run |
| 3,000-step phase | every step listed | 40 open steps + "[x] N steps done" + "… N more steps in the store" |
| Brief over `builds.briefMaxBytes` | sent anyway | trimmed to fit (64 KB and 16 KB caps tested) with Brett's words and the Pipeline paragraph intact; noted on the build |
| Launch crash | counted as a run (3-run cap), parked | requeued after 1 / 4 / 16 min, `pipeline.launchRetry` { count, lastError, retryAt }; cap → banner + systems check |

`deploy/test/claude-headless-brief.test.sh` fails on the old launcher with exactly the production error and passes now.

## Applied on the live store

- `auto-lander-never-wait-missing-ui-review`: back in the Queue with 17 steps (was 544 → 748 in its crashed brief);
  waits only for a free slot (VPS hard build limit 8/8).
- Phone Connect (`rebuild-fresh-main-phone-connect-small`, PR #787): `git merge-tree` confirms the clash in
  `framework/spec/check-ci-scope.mjs`; `pipeline.mjs clash-bounce` added s28 (merge main in, resolve, push) and
  queued it; the dispatcher lists it in the Queue (waiting on the 8/8 limit).

## How each piece is reached

| Piece | REST (console) | MCP / voice (plugin command) | CLI |
|---|---|---|---|
| Launch / bounce state (lastLaunchError, retries, retryAt, gaveUp, bounceReason) | `GET /api/plugins/build-orchestrator/launch-state/{build}` | `pipeline-launch-state` ("why won't skins start") | `pipeline.mjs launch-state <id>`, `axf build-orchestrator pipeline-launch-state --build <id>` |
| Requeue a launch crash | `POST /pipeline/requeue-launch` {id} | `pipeline-requeue` ("requeue skins") | `pipeline.mjs requeue-launch <id>`; all: `launch-crashed --requeue` |
| Clash bounce | `POST /pipeline/clash-bounce` {id, files?, head?} | `pipeline-clash-bounce` | `pipeline.mjs clash-bounce <id> [--files a,b] [--head sha]` |
| Dedupe steps | `POST /pipeline/dedupe-steps` {apply?, ids?} | `pipeline-dedupe` ("dedupe the build steps") | `pipeline.mjs dedupe-steps [--apply]`, `builds-store.mjs dedupe-steps` |
| Brief size cap | Claude settings `builds.briefMaxBytes` (settings API / control@1) | same setting | `claude-settings` |
| Launch-crash banner | systems check item `builds-launch-crash`, Requeue auto fix | — | `pipeline.mjs launch-crashed` |

No UI was added: the state is on the build record (`pipeline.launchRetry`, `pipeline.bounce`) that the existing
orchestrator views and `GET /attempts` already carry.

## Checks

check-builds-store 52 · check-build-steps 44 · check-landing-line 32 (new: conflict → bounce step) · check-builds-live 69
· check-done-means-merged 417 · check-build-pipeline 154 · check-headless-context 38 · check-build-limit 52 ·
check-plugin-commands 59 · check-ci-scope 10 · pipeline.test 64 · build-orchestrator test.mjs 35 · server test.py 58 ·
claude-settings 93 · new: resplit-dedupe 8, launch-retry 5, land-clash 6, claude-headless-brief 13 ·
`builds-store.mjs verify` ok. The four new tests run in CI (`.github/workflows/android.yml`).

## Left open

- `framework/core/build-pipeline.mjs` gained two optional records (`launchRetry`, `bounce`) on Opus; a Fable review
  of the build-pipeline@1 contract may want them in `framework/spec/BUILDS.md`.
- Until this lands, the dispatcher in `/opt/axf` runs the old normalizer, which drops `pipeline.bounce` on its next
  write of Phone Connect (the s28 step and the queued status stay).
