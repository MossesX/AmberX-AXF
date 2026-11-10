# Account failover chain: subscription, next subscription, then API; record who built it

Build `account-failover-chain-subscription-next-subscri` · branch `claude/account-failover-chain-subscription-next-subscri` · Opus

Brett said (Nov 9 2026): "The orchestrator assigns a model; if it doesn't work, it goes to another subscription, and if
there's no subscriptions, it goes to an API. Whatever account or API actually does the job, the orchestrator notes it:
this account is the one who built it."

## What changed

- **Failover chain** (`pipeline-core.mjs` `failoverFor`, `pipeline.mjs failover`): when a pipeline run's login fails
  (auth) or hits a limit (usage), `deploy/claude-headless.sh` calls `pipeline.mjs failover <id> --from <account>`. It
  marks the account limited (claude-workers `markLimit`), picks the next subscription account in priority order
  (`candidates`), and when none is left an API-key account under its caps (`apiCandidates`). Accounts already tried are
  never retried. The run restarts on the new login with a "carry on from the worktree" line. Every hop is a build note
  and a pipeline log line. When the chain is exhausted the run stops and the note says why for each link.
- **Never outside the chain**: pipeline runs no longer fall through to the console's AI keys account switch.
  `route subscription` builds never reach API, `route api` builds stay on API accounts. New setting `failoverToApi`
  (on by default) stops the chain at the subscriptions when turned off.
- **Who built it** (`build-pipeline@1` `pipeline.builtBy`, `normBuiltBy`): at session end the dispatcher reads the
  session-login / session-part / session-end events and records one entry per login the run used: account, email,
  subscription or API, model, cost, the steps ticked in that window, and `ran` or `limited`. `lastRun` also carries
  the email and cost. The end note says "Built by …".
- **Shown in the orchestrator**: Pipeline cards show "built by a → b (API)", with a tooltip listing each run. A
  "Failover to API" switch sits next to "API overflow".
- Folded in: `running-builds-follow-the-active-claude-account-fail-over-when-it-dies` and
  `auto-switch-claude-account-when-the-active-one-r` (notes on both).

## How to reach it (API)

| | Who built it | Failover to API setting | Failover hop |
|---|---|---|---|
| UI | Build orchestrator → Pipeline card "built by" | Pipeline → "Failover to API" switch | build notes |
| REST | `GET /pipeline/builtby/{build}` | `GET/POST /pipeline/settings` `failoverToApi` | (host only) |
| MCP / voice | plugin command `pipeline-builtby` ("who built skins") | `pipeline-settings-set` | — |
| CLI | `pipeline.mjs builtby <id>` | `pipeline.mjs set failoverToApi=false` | `pipeline.mjs failover <id> --from <acct>` |

The failover hop is called by the headless runner on the VPS host. It is not a console action because the console
container has no Claude login.

## Tests

- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 38 checks pass, including `failoverFor`,
  segments → builtBy, and end to end `failover` / `builtby` on a scratch store.
- `test.mjs` 33 checks pass. check-theme, check-controls and check-toolbars pass. `tsc --noEmit` on console-web is clean.
- `plugin-lifecycle check build-orchestrator` reports stale references in `framework/cli/dispatch-gate.mjs`. Those
  are already on main and this build did not touch them.

## Gaps

- No UI Review shots: Playwright is not installed in this worktree, so the capture made no pictures. The UI change is
  one switch and one meta line on the Pipeline card.
- The Kotlin twin of `builtBy` is deferred in `framework/spec/PORTING.md`.
