# Multiple queue lists + API job control panel (multi-queues-api-panel)

Built Nov 9 2026 on Opus, branch `claude/multi-queues-api-panel`. Supersedes `api-jobs-panel-queue`.

## What changed
- **Named queues** (`build-queues@1`, `queues.json` next to the pipeline's files, written under a lock). Brett can create,
  rename, reorder, pause/resume and delete queue lists. Each queue has: accounts it may use (subscriptions, API or both,
  optionally named ones), max parallel, default model (only for steps with no model pinned), priority vs other queues
  (1 starts first) and an optional 24 h cost cap. Ships with **Main** (subscriptions; every build already queued or
  running is migrated into it on first use) and **API** (hulu-api, mossesx-api, 2 at once, $10 / 24 h cap).
- **Moves:** a build goes Pending → any queue, queue → queue, queue → Pending (drag a card onto a column, the Move to
  picker, CLI, MCP or voice). Each build sits in one queue. A running build moved to another queue counts there next.
- **Rules** (ordered, each on/off): *overflow* (a Main build no subscription account can start goes through the API
  queue; shipped **off**), *route* (a build queued with no queue named goes to a queue by category or next model),
  *max cost per job* (an API run over it is stopped; shipped on at $5 for the API queue).
- **Spend safety:** every tick the dispatcher stops (tmux kill) any API job whose account hit its daily/weekly cap, whose
  queue hit its cost cap, or that cost more than its max per job. The build goes back to Pending with the reason. AmberX
  notices at 80 % and at the stop (alerts keyed `queues:spend:*`, `queues:cap:*`, `queues:stop:*`; push types in
  `notify.json`), once per spell, cleared when spend drops back.
- **API runs need Brett's OK** (rules: an API run is a confirm approval, never a veto). A build that would start on an
  API key waits with "needs your OK", the dispatcher asks once (`queues:ask:<build>`, opens the screen on that build),
  and Brett taps **OK to run on API**. Owner-only, like raising a cap: lowering a cap is anyone's; raising one, switching
  a max-cost rule off, giving a queue API accounts and OK-ing an API run need his signed-in console click.
- **Queues & API screen** (Builds → Queues & API, also a button on the orchestrator page): every queue with its live
  running jobs (account, cost vs max for API runs) and queued builds (why each waits, what the next tick starts),
  Pending, the API accounts (key **set / missing**, never the value; on/off; spend today and this week with cap meters)
  and the rules editor. Three layouts as `settings` assets (`plugins/build-orchestrator/assets/settings/`), setting
  `axf.build-orchestrator.queues.view`: **columns** (default), **stacked**, **api-first**.
- **Full control:** REST routes `GET /queues`, `/queues/spend`, `POST /queues/{create,update,rename,move,pause,delete,
  assign,pending,rule,approve,revoke}` → MCP / axHub / voice tools through plugin-commands (13 new commands); CLI
  `queues.mjs status|create|update|rename|move|pause|resume|delete|assign|pending|rules|rule …|approve|revoke|spend|act`;
  deep link action `build-queues.open[:<queue or build>]`, link `view:build-queues`.

## Integration point (for orchestrator-only-launcher)
Queues are their own module. The dispatcher (`pipeline.mjs`) touches it in one import and two calls:
`queuesHook.hookPlan(args)` wraps `P.plan()` (launches spread over the queues; falls back to the plain plan if the
queues fail) and `queuesHook.afterTick({ launched, ended, plan, … })` (claims, releases, API OK asks, spend stops).
The interface for any dispatcher is in `queues-core.mjs`: `queues(doc)`, `nextJob(doc, queue, builds)`,
`claim(doc, build, {…})`, `release(doc, build)`, plus `plan()` / `enforce()`. When orchestrator-only-launcher lands,
move those two calls into its dispatcher.

## Live state
- mossesx-api key: **set** (checked by file presence, value never read). hulu-api: **still missing** (the existing
  `claude-api-spend` banner item already says how: Terminal → VPS host → `claude-account savekey hulu-api`).
- Nothing was written to the live pipeline folder: `queues.json` is made by the dispatcher on its first tick after this
  lands, with today's Queue migrated into Main.

## Known gaps
- An MCP/voice call can do everything except the owner-only actions, which answer 403 with the reason (Brett's click).
  Approving through an axHub approval needs the console's axHub-approved tool path to set `AXF_APPROVER_VIA=axhub`.
- The console has no URL router yet (kernel deep-link scheme is a catalog item): URL `?queue=`/`?build=` params are read
  but the in-console deep link is the `build-queues.open:<id>` action.
- Spend is checked once a minute (the tick), so an API run can pass its max by up to a minute of tokens.
- Account caps themselves are still edited in Settings → Plugins → Claude accounts → Job routing (shown read-only here).
- No framework/core change, so no spec fixtures or Android twin.

## Tests
- `plugins/build-orchestrator/queues.test.mjs`: new, 23 checks (queues, moves, rules, owner-only, plan, overflow, claims,
  caps; CLI + dispatcher end to end with a fake API account: ask once, approve, launch, max-cost hard stop, 80 % and cap notices).
- `plugins/build-orchestrator/test.py`: 16 new checks, 37 total (queue routes, approver only from Brett's click, error codes).
- `pipeline.test.mjs` 27, `test.mjs` 33, `deploy/claude-workers.test.mjs` 65, plugin-commands 41: unchanged and passing.
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-plugin-pages, plugin-commands check, console tsc: pass.

## UI Review
Three options: **columns**, **stacked**, **api-first**, desktop and phone shots in `multi-queues-api-panel/shots/`
(mock data through the real screen).
