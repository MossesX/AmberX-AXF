# API accounts need no approval: builds route there like any other account

Build `api-accounts-need-no-approval-builds-route-there` · Phase 1 (Opus) · Nov 10 2026

Brett said: "I don't want to have to approve builds sent to API. They need to just go there just like any other build."

## What changed

- **No owner click for API routing.** `POST /api/plugins/build-orchestrator/pipeline/route` with `route: api` and
  `POST …/pipeline/settings` with `apiOverflow: true` no longer answer 403 for a session, MCP, voice or CLI caller
  (`build-orchestrator/server/__init__.py`). The old rule (token-usage-log s10: every API run is a confirm approval) is
  superseded.
- **API accounts are in the account order.** `pipeline-core.mjs` `inAccountOrder()`: when Brett's account order
  (Claude accounts drag-and-drop) covers every candidate, that order decides, API accounts included. With a partial or
  no order it stays subscriptions first, then API. `routeFor()` and `routeOptions()` (the final pick) both use it.
  `route: subscription` and `apiOverflow: false` still keep a build off API.
- **Worker router falls through to API.** `deploy/worker-routing.mjs` `decide()`: when no rule applies and no
  subscription account can start a job, a free API worker (set up, with a key, under its caps) takes it before the job
  queues. A rule `to: subscription` still keeps the job off API. Headless jobs started without an account (voice, axHub,
  other surfaces) now behave the same as the dispatcher.
- **Spend caps are the safety net.** A capped API account takes nothing (unchanged). New: the dispatcher tick sends an
  alert to the console (AmberX) per API account at the alert level (80% by default, `warning`) and when a cap is hit
  (`error`: "no more builds go there"), once per state, and resolves it when spend falls back under the cap
  (`alertFor('api-spend')`, `apiSpendAlerts()`, `pipeline.mjs` tick).
- Wording: the seed rules brief (`framework/schemas/rules-briefs.json`), the launcher's routing note, the Claude
  accounts help text, the plugin command descriptions and file headers say no approval, caps apply.

## How it is reached (API rule)

No new UI. The existing controls lose their approval gate:
- REST: `POST /api/plugins/build-orchestrator/pipeline/route {id, route}` · `POST …/pipeline/settings {apiOverflow}`.
- MCP / plugin commands: `build-orchestrator/pipeline-route`, `build-orchestrator/pipeline-settings-set`.
- CLI: `node apps/console-web/plugins/build-orchestrator/pipeline.mjs route <id> api|subscription|auto` · `… set apiOverflow=true`.
- Voice (AmberX): through the same plugin commands.
- State: `pipeline.mjs status` (accounts with `api.spend`), console alerts with keys `pipeline:api-spend:<account>`.

## Tests

- `node deploy/worker-routing.test.mjs`: 49 checks pass (new: no-rule overflow to API, least busy API, a subscription
  rule keeps it off API, capped API workers take nothing, switched-off API takes nothing; queue tests now run without
  API workers).
- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 43 pass (new: account order with API, partial
  order, route subscription, overflow off, capped vs near-cap, spend alerts).
- `python3 apps/console-web/plugins/build-orchestrator/test.py`: 31 pass (route api and overflow on by a session → 200).
- `node apps/console-web/plugins/build-orchestrator/test.mjs`: 33 pass. `check-theme`, `check-controls`: pass.
- `node deploy/claude-workers.test.mjs` fails on "the launcher starts it: dispatch token already used". It fails the
  same way on a clean HEAD (host dispatch-token state), so this change did not cause it.

## Left for Brett / follow-ups

- The live rules brief on the hub (`/projects/_shared/_data/claude/rules-briefs.json`) is Brett's document, so this
  build did not change it. Only the seed changed. To match it: Claude settings → Rules briefs, replace "Every run on an API key is
  Brett's confirm approval, never a veto." with the seed line.
- Raising a spend cap is still Brett's own click (unchanged; a session may only lower one).
- Text-only UI changes (two help paragraphs). Nothing was submitted to UI Review because nothing visual changed.
