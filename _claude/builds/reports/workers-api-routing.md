# Workers + API accounts + routing rules (workers-api-routing)

Built Nov 8 2026 on Opus, branch `claude/workers-api-routing`.

## Why nothing ran on the workers
`workers.json` (claude-workers@1) didn't exist. Workers were opt-in: an account only took jobs after someone tapped
**Make worker**, and nobody had, so `route()` always returned nothing and every headless job ran on the console's
account (mossesx-max-). account-3 stayed idle.

## What changed
- **Every saved subscription login is a worker by default** (`excluded` lists the ones you stop). The console's own
  account takes headless jobs after the workers (setting `interactiveTakesJobs`, on by default).
- **Per-account limits:** at most 3 jobs build and 5 wait per account (global defaults plus per-account overrides).
  Jobs claim a slot under a lock (`worker-state.json` → `claims`), so two launches never get the same last slot. When
  every account is full, the launcher waits in the shortest queue, oldest first, and the claim goes when the session ends.
- **API-key accounts** (`~/.claude-accounts/<name>/apikey`) can be workers. The run exports only `ANTHROPIC_API_KEY`,
  and every subscription run now unsets any `ANTHROPIC_API_KEY` it inherited, so a subscription run is never billed per token.
  They take **only** jobs a routing rule sends them, and nothing once their daily or weekly cap is reached (rolling 24 h / 7 days).
- **Routing rules** (ordered, each on or off; the first match decides): job type, model, priority, profile, min/max steps
  left, max minutes left, and "only while no subscription account can start it" (the fallback). Each rule sends the job
  to API accounts (optionally named ones) or keeps it on subscriptions. A capped, switched-off or full API account passes
  the job back to the subscriptions.
- **Spend caps + alerts:** state `warn` at the alert level (default 80%), `capped` at the cap. Health check
  `claude-api-spend` puts a banner item up (also for an API slot that has no key yet). Sessions (CLI, MCP, voice, the
  console token) can lower a cap; only Brett's signed-in console click can raise or remove one.
- **One router:** `deploy/worker-routing.mjs` is pure. The launcher, the CLI and the console server (node, fixed argv,
  JSON on stdin) all run it, so the test-a-job preview shows exactly what a launch would do.
- **Console:** Settings → Plugins → Claude accounts → **Job routing** has collapsible sections: Account status (role,
  running/limit, waiting/queue, cost today/week, spend meters), Workers & limits, API accounts & spend caps, Routing rules,
  Test a job. There are three layouts, each a `settings` asset in `plugins/claude-accounts/assets/settings/` (UI Review
  options). The pick is the setting `axf.claude-accounts.routing.view`.
- **Parity:** every action is a REST route, so it is also an MCP / voice tool through plugin-commands (`routing`, `routing-test`,
  `routing-settings`, `routing-rule`, `routing-api`, `routing-save`, `label`), and the CLI has `claude-workers.mjs
  claim|release|test|status|alerts|config|rules|set|worker|label|api|rule`.
- Agent jobs pass `AXF_JOB_TYPE` (their job-type id), so rules can match walkthroughs, UI shots and the rest.

## Live on the VPS now (data, not code)
`/opt/axf/.axf-console/plugins/claude-accounts/workers.json` was written with account-1 (brettspend) and account-3
(Hulu) as workers, the labels, and two API slots: **hulu-api "Hulu API"** and **mossesx-api "Moses X API"**, each
capped at $10/day and $50/week. The router already on main reads `workers` from that file, so new jobs started routing
to account-1 and account-3 straight away, before this PR merges.

## Known gaps / needs Brett
- **No API keys on the VPS for the two slots.** The axHub vault holds only the console token, the GitHub token and the
  SSH key, and the AI keys keyring is empty, so nothing could be copied in. Each slot shows "No key" with a banner item.
  To fill one: Terminal → VPS host → `claude-account savekey hulu-api` (then `mossesx-api`), and paste the key at the hidden prompt.
- `account-5` is an older API-key account (owner unknown). It is listed as "API · not used" and takes no jobs.
- No routing rules yet, so the API slots take nothing until Brett adds one (or turns on an overflow rule).
- A cap is checked when a job starts; a job that is already running finishes even if it crosses the cap.
- Claude setting `builds.maxParallel` (1, owner raises) still limits how many builds a Claude session starts by itself;
  the agent cap (6 VPS-wide) still applies on top of the per-account limits.

## Tests (before → after)
- `deploy/worker-routing.test.mjs`: new, 44 checks
- `deploy/claude-workers.test.mjs`: 46 → 65 (claims, queues, rules CLI, caps; end to end through claude-headless.sh)
- `deploy/claude-login.test.mjs`: 51 → 57 (API-key logins; the old launcher checks pinned to `AXF_WORKERS=off`)
- `apps/console-web/plugins/claude-accounts/test.py`: 89 (routing routes, owner-only cap raises, preview, health)
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-plugin-commands, plugin-commands tests,
  agent-swarm 100, glossary --check, console tsc: all pass.

## UI Review
Three options (settings assets): **sections** (default), **status-first**, **rule-cards**. Shots are in `shots/`.
