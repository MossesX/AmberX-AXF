# Make Hulu actually take builds (make-hulu-actually-take-builds-dispatcher-counts)

Brett (Nov 10 2026, 20:59): "I want five builds on each subscription in parallel, so a total of ten at a time."

Branch `claude/make-hulu-actually-take-builds-dispatcher-counts` · Opus · Phase 1 (s1–s3).

## What changed

| Area | Before | After |
|---|---|---|
| Dispatcher account view (`pipeline-core.mjs accountView`) | The console's interactive account (Hulu, account-3) was usable only when no worker existed, so it sat on standby: "not a worker (workers take every headless job)". | It is a builder whenever claude-workers says it takes headless jobs (`interactiveTakesJobs` on, `row.takesJobs`). When that is off, the reason now says so: "console account; taking headless jobs is off". |
| Candidate order (`candidates`) | Workers before the console's account on a tie. | Same priority: Brett's order, fewest running, Opus away from Fable accounts, then the name. |
| VPS agent cap (agent-slots@1 `maxAgents`, live setting) | 3 | 10 (5 per subscription × 2). `parallelPerAccount` was already 5 and claude-workers `building` 5. |
| Account health sweep (`pipeline.mjs callAccount`) and the splitter | `--tools ''` took the prompt as a tool name, so every probe failed with "Input must be provided…": the sweep never caught an account that could not sign in. | The prompt goes on stdin. Live sweep now: 3 ok, Hulu "cannot sign in". |
| `healthOf` | "Failed to authenticate: OAuth session expired and could not be refreshed" read as no answer. | Read as a sign-in failure, so the dispatcher holds the account out. |
| Pipeline alerts (`ALERT_LINK`) | `#/build-orchestrator`: the console alerts API refuses it (400), so no pipeline alert reached the bell or AmberX. | `view:build-orchestrator`. |

## Verified live

- One dispatcher tick from this branch launched four builds on account-3 (Hulu) and one on mossesx-max-. Hulu is now picked.
- All four Hulu runs died in 1–2 s: **Hulu's Claude login has expired** ("OAuth session expired and could not be refreshed"). Brett needs to sign it in again. An AmberX alert was sent (bell + ntfy + web push): `pipeline:account:account-3`, with the steps.
- After the health fix the sweep marks Hulu "cannot sign in (health check)", so the dispatcher stops putting builds on it until it signs in. Moses X runs 5/5 and the Hulu API key 5/5 (10 in all) in the meantime.
- What it cost: running the tick from this worktree used the worktree's stale build store, so it started a second copy of two builds that were already running (this build and molly-sign-in-once; both died at once on Hulu's login, no edits). It also started one run (api-accounts-need-no-approval-builds-route-there on mossesx-max-) that the live store did not know about. I stopped that run and released its slot, so the live dispatcher starts it again normally. None of the worktree store changes were committed.

## Brett: to do

1. Sign Hulu (account-3, hulu0241@gmail.com) in again: Claude accounts → account-3 → sign in, or on the VPS `claude setup-token` as that account and `claude-account save account-3 <token>`. The next 5-minute health sweep puts it back to work, and its first build raises a "Building … Started on account-3" alert.

## API reach

No UI changed. The settings are already reachable without the UI: `node framework/cli/agent-slots.mjs set maxAgents=N`, `pipeline.mjs status|health|tick`, claude-workers `set interactiveTakesJobs on|off` / `routing/settings` (REST), and the console alerts API.

## Tests

- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 45 checks passed (new: console account as builder, 5 + 5 = 10, same priority; expired OAuth = sign-in failure; alert links valid).
- `node deploy/claude-workers.test.mjs`: 72 checks passed. This test fails inside a dispatched session unless `AXF_DISPATCH_TOKEN` is unset, because it inherits the session's token. That is a test-isolation gap, not this change.
- `node deploy/worker-routing.test.mjs`: passed.
