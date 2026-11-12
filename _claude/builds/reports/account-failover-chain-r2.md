# Account failover chain, redo on current main

Build `account-failover-chain-r2` · branch `claude/account-failover-chain-r2` · Opus · redo of
`account-failover-chain-subscription-next-subscri` (#425, ~1800 commits behind, conflicting in the pipeline files).
The old branch was read, not merged.

Brett said (Nov 9 2026): "The orchestrator assigns a model; if it doesn't work, it goes to another subscription, and if
there's no subscriptions, it goes to an API." Redo asked for Nov 11 2026 (voice): all subscriptions are peers, including
the console's own login; API only if Brett has it switched on (it is off now); every switch shown on the build and posted
to the group chat as the owning employee; reuse the usage meter and the claude-workers routing config.

## What changed

- **The chain** (`pipeline-core.mjs` `failoverFor`): when a pipeline run's account fails, the next link is
  1. a subscription login with usage left. Every subscription is a peer, the console's own login too, whatever its
     worker role. Logins that are switched off for the pipeline, limited, out on the usage meter, already tried by this
     run, or missing Fable for a Fable phase are skipped. Ranking: free slot first, then most usage left (unknown after
     known), then Brett's account order. A login at its parallel cap comes last: the run gives its old slot back as it
     moves.
  2. an API account, only when no subscription can take it, the build may use API (route `api`, or auto with the API
     overflow rule on), and Brett has that account switched on as an API worker, with a key, under its caps. Both
     switches are Brett-only clicks today, so nothing new can turn API on. A build set to Subscriptions never reaches API.
- **Usage left** (`usageLeft`, `usageMap`, `pipeline.mjs readUsage`): the Badges plugin's host reader
  (`server/usage_host.py`, plain HTTP, no token printed). The pipeline finds it by the new capability
  `service:claude-usage@1`, not by folder name. The tighter of the 5-hour and weekly windows counts. A window whose reset
  time has passed counts as fresh. Under 2% left, locked, or HTTP 401 means out. Read at most every 2 minutes and cached
  in the pipeline dir.
- **What triggers it** (`deploy/claude-headless.sh`, pipeline runs only):
  - At launch: the pinned login can't be copied (expired or removed). The run moves on and never runs on the shared
    login. If nothing is left, it is "Not started" with exit 3.
  - Mid-run: claude-workers `hitOf` reads the log. A limit always counts. A dead login or a **429 rate limit** (new kind
    `rate`, 15-minute pause) counts only on a failed exit. The run restarts on the new login with a "carry on from the
    worktree" line.
  - A pipeline run never falls through to the console's AI keys account switch any more. The switch cap for pipeline
    runs is 6 (`AXF_ACCOUNT_SWITCHES` still wins).
- **Every switch shown** (`pipeline.mjs failover`):
  - The account is marked limited in claude-workers.
  - The hop goes into `pipeline.failovers` (build-pipeline@1), a build note and `log.jsonl`.
  - It is posted to the Breakroom group chat as the `accounts` section's owner (Manny Fest): `done` when it moved,
    `failed` when nothing was left.
  - The Pipeline card shows "Failover: a (limit) → b · b (rate limited) → c", with the reasons in a tooltip. It is
    flagged when the chain ran dry.
- **Who built it** (`pipeline.builtBy`, carried over from the old branch): at session end the session-login / -part /
  -end events give one entry per login used, with email, kind, model, cost and the steps ticked in its window.
  `lastRun` carries the email and cost. The end note says "Built by …", and the card shows "Built by a → b".

## How to reach it (API)

| | Failover hop | Who built it / hops | Usage left |
|---|---|---|---|
| UI | Pipeline card "Failover:" line, build notes | Pipeline card "Built by" | — (Badges usage meter drop-down) |
| REST | (host only) | `GET /pipeline/builtby/{build}` | — |
| MCP / voice | — | plugin command `pipeline-builtby` ("who built skins") | — |
| CLI | `pipeline.mjs failover <id> --from <acct> [--kind usage\|auth\|rate] [--tried a,b]` | `pipeline.mjs builtby <id>` | `pipeline.mjs usage [--refresh]` |

The hop is called by the headless runner on the VPS host. It is not a console action because the console container has
no Claude login.

## Tests and checks

- `pipeline.test.mjs`: 52 checks pass. New ones cover `usageLeft`, `failoverFor` (the console login as a peer, usage
  ranking, skips, Fable, an account at its cap, API on, off or capped, routes), segments → builtBy, `hitOf` rate, and
  end to end `failover` ×3 (to the console login, then the next peer, then none), `usage`, `builtby` and the session end
  recording two logins.
- `test.mjs` 33, `test.py` 41, claude-badge `test.py` 73, `claude-workers.test.mjs` 72, `worker-routing.test.mjs` 44:
  all pass.
- check-theme, check-controls, check-toolbars, check-chrome-assets, `crew-say.mjs check`: all pass. builds-store verify
  is ok. `tsc --noEmit` on console-web is clean.
- `plugin-lifecycle check build-orchestrator` reports stale references in `framework/spec/check-build-limit.mjs` and
  walkthrough-studio's rules copy. The same findings are on main; this build did not touch those files.
  `plugin-lifecycle check claude-badge` is clean.
- `deploy/claude-login.test.mjs` fails 2 of 57 (`--account account-a runs`, `--account picks the account per launch`).
  The same 2 fail on main at the same commit (`/opt/axf`, 9ce874643). The cause is not in this change.
- The shell path of `claude-headless.sh` passed `bash -n` only. No end-to-end run with a real expiring login.

## Gaps

- **No UI Review shots yet.** `rebuild-shots.mjs` started a scratch console with a seeded store, but it stopped at
  "Waiting for axHub": the random dev origin can't reach the hub, and no local hub runs on this VPS. The PR stays a draft
  until shots of the Pipeline card are taken. The seed script and shots spec are in the PR description.
- The orchestrator has no record for `account-failover-chain-r2`, so no steps were ticked there. The branch and PR are
  linked to the original build `account-failover-chain-subscription-next-subscri`.
- Kotlin twin of `failovers` / `builtBy` deferred in `framework/spec/PORTING.md`.
