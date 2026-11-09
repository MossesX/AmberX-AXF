# Per-account queues + long-press a queued build to send it to an account now

Build `per-account-queues-long-press-a-queued-build-to` · branch `claude/per-account-queues-long-press-a-queued-build-to` · Opus

## Brett said (verbatim, Nov 9 2026)
> I want to be able to hold a job down in the build manager or in the orchestrator in the queue and send it to an API immediately. An API queue. I want every account to have its own queue.

## What changed
- **build-pipeline@1** (`framework/core/build-pipeline.mjs`): `pipeline.pin` / `pinnedAt` / `pinnedBy`. A pinned build sits in that
  account's own queue and runs only there. `queueOrder` starts pinned builds first within their priority (oldest send first).
  `queueOf()` added. Kotlin twin deferred in `framework/spec/PORTING.md`.
- **Dispatcher rules** (`pipeline-core.mjs`): `routeFor` honours the pin first through `pinRoute()`. An API account still needs its
  key, daily and weekly caps and room. A subscription account needs to be switched on, not limited, have room and have Fable
  for a Fable phase. It does not need to be a worker, because the send is Brett's pick. `accountQueues()` builds one lane per
  account (running / waiting / next) plus the shared queue.
- **CLI** (`pipeline.mjs`): `send <id> <account>|auto [--later]` (a Pending build is queued by it; `auto` = back to the shared
  queue) and `queues`. `send` ticks the dispatcher at once on the VPS host, under the cron's own `flock`, so the build starts
  right away when the account has room. `unqueue` clears the pin.
- **REST**: `GET /pipeline/queues`, `POST /pipeline/send {id, account, now?}`. Sending to an API account is Brett's own click,
  the same rule as `route api`; a session gets 403.
- **MCP / voice**: plugin commands `pipeline-queues`, `pipeline-send`.
- **UI**:
  - Build orchestrator → Pipeline → **Account queues**: one lane per account, API lanes marked, plus the Shared queue.
  - Long-press or right-click a build (Pipeline cards, lanes, Builds tab, Build manager rows) → **Send to account queue** → any
    account.
  - Drag a card onto another lane to move it; drop it on Shared to unpin it.
  - The Build manager's Live tab shows the same lanes through the new `builds.accounts` slot. No folder coupling.
- **Deep link**: console action `build-orchestrator.queues` opens Pipeline at `#account-queues`.

## How each part is reached
| What | UI | REST | MCP / voice | CLI |
|---|---|---|---|---|
| Read every account's queue | Pipeline → Account queues; Build manager → Live | GET /pipeline/queues | pipeline-queues | pipeline.mjs queues |
| Send to an account (API too) | long-press → Send to account queue; drag to a lane | POST /pipeline/send | pipeline-send | pipeline.mjs send <id> <account> |
| Back to the shared queue | drop on Shared / menu → Shared queue | POST /pipeline/send {account: auto} | pipeline-send | pipeline.mjs send <id> auto |
| Open it | — | — | console action build-orchestrator.queues | — |

## Tests
- pipeline.test.mjs: 38 checks, 3 new (pin routing and reasons, queue order, plan, lanes, e2e send).
- build-orchestrator test.mjs: 33 checks. test.py: 37 checks (send: API = Brett only, bad name 400, `--later`).
- build-manager: 127 checks. builds-store: 40 checks. tsc clean.
- check-theme, check-controls, check-toolbars and check-chrome-assets pass.

## Not done / notes
- No UI Review screenshots yet: this headless session has no console running the branch. The next phase (or Brett) should
  capture desktop and phone shots of Pipeline → Account queues and the long-press menu.
- Adding fields to build-pipeline@1 is schema work, which is normally Fable. It is three optional fields with the same
  normalisation as `route`, so it stayed on Opus.
- Pre-existing, not from this build: `help-coverage` flags `claude-accounts/help.json` entries[17];
  `plugin-lifecycle check build-orchestrator` flags stale references in `framework/cli/dispatch-gate.mjs`.
