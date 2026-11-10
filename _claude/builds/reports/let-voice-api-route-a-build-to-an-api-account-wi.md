# let-voice-api-route-a-build-to-an-api-account-wi — voice / API can ask to run builds on an API account

Build `let-voice-api-route-a-build-to-an-api-account-wi`, Phase 1, Opus, branch
`claude/let-voice-api-route-a-build-to-an-api-account-wi`. Headless, dispatched by the orchestrator.

## What Brett said (verbatim, Nov 9 2026, 19:23 UTC)

> They have to run on the API. There's no more Fable credits. Run them on API, man. ... You need to. Fix it. Make it so you can.

## Before

`pipeline-route api` and `apiOverflow on` worked only from Brett's own console click. A voice session or MCP call
got a 403, so it couldn't even ask. The CLI went the other way: `pipeline.mjs route <id> api` ran from any shell and
applied with no approval at all.

## What changed

**Request, then approve** (`apps/console-web/plugins/build-orchestrator/pipeline.mjs`):
- `route <id> api [--account A] [--reason R]` from anyone except Brett files an **API route request**. It applies
  nothing yet. The request is kept in the pipeline's `routes.json`. Each build gets a note (an audited store write,
  action `pipeline:route-request`), the request goes into `log.jsonl`, and a console alert
  `Approve API run: …` is raised. The caller gets back the axHub confirm call to send once:
  `axf.orchestrator_route_approve {request}` with a reason. If an open request already covers the same builds and
  account, it is reused, so a request is never filed twice.
- `route <id…> api` and `route --all-queued api` cover several builds with **one request** and one approval.
- `request --route api` (filing a build) follows the same rule.
- `route-approve <rr-id>` / `route-deny <rr-id>`: only Brett can run these (`approverFrom`: his console click or an
  axHub approval). A Claude session, headless build or agent is refused even when it holds the approver variables.
- Brett's own click (`AXF_APPROVER` + via console) still applies `route api` at once.
- `subscription` / `auto` apply for anyone, because they never spend money. They also drop the account pin and take
  the build out of any open request.

**Pinned account** (`pipeline-core.mjs`): `route api --account account-5` limits the build to that one API account.
`routeFor()` / `plan()` take `pins`. **The caps still apply.** `apiState` still blocks an account that has hit its
daily or weekly spend cap, has no key, is switched off, or is full. If the pinned account can't take the build, it
waits and the wait reason says why.

**REST** (`server/__init__.py`):
- `POST /pipeline/route {id | ids | all_queued, route, account?, reason?}`. A request from anyone but Brett returns
  **202** `{pending, request, ask}` instead of a 403.
- `GET /pipeline/route/requests`.
- `POST /pipeline/route/approve` and `/deny {request}`: Brett's click only. Anyone else gets a 403.

**MCP**: `orchestrator_route_approve(request)` is what axHub runs once Brett approves (confirm policy, never a veto).
It is built the same way as `orchestrator_upgrade_approve`.

**Console** (Build orchestrator → Pipeline):
- Each open request shows as a card with **Approve / Deny** buttons.
- An API account card shows **Run queued here** when some queued builds aren't on API yet.
- The *Runs on* button shows the pinned account.

**plugin.json**: `pipeline-route` now takes account, ids, all_queued and reason. New commands:
`pipeline-route-requests`, `pipeline-route-approve`, `pipeline-route-deny`. This makes them reachable from control@1,
MCP, the CLI (`axf build-orchestrator …`) and AmberX voice.

## How each piece is reached

| Action | REST | MCP / control@1 | CLI | Voice |
|---|---|---|---|---|
| Ask to run on API | `POST /pipeline/route` | `build-orchestrator/pipeline-route` | `pipeline.mjs route … api` | the same plugin command |
| See requests and pins | `GET /pipeline/route/requests`, `GET /pipeline` (`routes`) | `pipeline-route-requests` | `pipeline.mjs route-requests` | the same |
| Approve / deny (Brett) | `POST /pipeline/route/approve` / `deny` | axHub → `orchestrator_route_approve` | `route-approve` / `route-deny` (his environment only) | the axHub approval |

Deep link: the console's Build orchestrator page. Pipeline is its default tab.

## s2: running them on API now

On this VPS, account-5 is a usable API worker: $100/day and $100/week caps, $0 spent, the only entry in
`apiAccounts`. 11 builds are queued and none are routed to API. I filed **one request, `rr-mwa0yhwk-ym8b`**, for every
queued build on account-5, with Brett's words as the reason. **Nothing runs on API until Brett approves it.**
- No axHub tool was available in this headless session, so the axHub call was **not sent**. The request is in
  `routes.json` and the console alert was posted.
- The live console and dispatcher run `main`. Brett can approve it (Pipeline card, or
  `pipeline.mjs route-approve rr-mwa0yhwk-ym8b` from his own shell) **after this PR lands**.
- Right now every queued build also waits on the VPS agent-slot cap (3/3 in use), not only on accounts.

## Tests

- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 37 checks. New: pinned account and caps,
  the route-request alert, and end to end request → reuse → self-approve refused → axHub approve → pin → subscription
  drops the pin → Brett's direct click → all-queued → deny.
- `python3 apps/console-web/plugins/build-orchestrator/test.py`: 43 checks (non-Brett route api now hands the CLI no
  approver; approve/deny are Brett-only).
- `test.mjs` 33, `server/test_upgrade.py` 12, `plugin-commands` 53.
- `tsc --noEmit`, `check-theme`, `check-controls` and `check-toolbars` pass.

## Gaps

- **UI Review shots not taken.** The scratch console that `rebuild-shots.mjs` starts can't reach axHub from this
  sandbox, so the capture stops at "Waiting for axHub". The Pipeline approval card needs desktop and phone shots
  before it is called ready.
- No framework/core change, so there is no Kotlin twin and nothing to add to PORTING.
