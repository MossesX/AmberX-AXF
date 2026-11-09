# One source of truth for Claude accounts (one-source-of-truth-for-claude-accounts-the-orch)

Built Nov 9 2026 on Opus, branch `claude/one-source-of-truth-for-claude-accounts-the-orch`.

Brett said (2026-11-09 20:26): "Why doesn't the orchestrator see the API accounts? ... I need him to read from one
source, dude. One true source."

## Why it didn't see them
The dispatcher (`apps/console-web/plugins/build-orchestrator/pipeline.mjs`) took the account rows from
`deploy/claude-workers.mjs status`, but it decided what to do with them from its own copy:
- `settings.json` (pipeline-settings@1) had its own `apiOverflow` switch, `apiAccounts` list, `parallelPerAccount` and
  `useConsoleAccount`.
- `accounts.json` had its own per-account `fable`, `parallel` and `use` records.

So the "API fallback when subscriptions are busy" rule that Gizmo turned on in Claude accounts (workers.json `rules`)
never reached the dispatcher, which only checked its own `apiOverflow` (off). The console account rule and the
per-account caps also disagreed between the two places.

## What changed
- **One source.** Claude accounts (`workers.json`, claude-workers@1) is the only place for accounts, models per account,
  API workers, caps, the fallback and routing rules. The dispatcher reads `claude-workers.mjs status` live on every
  call (status, tick, accounts) and keeps no copy.
- **Routing.** `pipeline-core.mjs routeFor()` now runs the Job routing rules from workers.json in order, with the same
  `ruleMiss()` the launcher uses (`deploy/worker-routing.mjs`). The fallback is a rule with `subs: busy`. A rule's
  account list is honoured. If no API account can take the build, it falls through to subscriptions, the same way
  `decide()` does. The per-build override (`route api | subscription`) is unchanged.
- **Account facts come from the row.** Whether an account takes jobs = `takesJobs` (workers, and the console account
  while `interactiveTakesJobs` is on). The parallel cap = `building`. The reason shown is the same `why` text Claude
  accounts shows.
- **Models per account.** New optional `perAccount.<name>.fable` (true/false; missing = auto) in claude-workers@1.
  Precedence: hand setting > a fresh probe > the plan. `claude-workers.mjs fable <name> on|off|auto` and
  `building <name> <n>|default` set it, and Claude accounts shows "Fable (set by hand)" on the row.
- **Duplicates removed.** `parallelPerAccount`, `useConsoleAccount`, `apiOverflow` and `apiAccounts` are gone from
  pipeline-settings@1. `pipeline.mjs set` and `POST /pipeline/settings` refuse them with where they live now.
  `accounts.json` keeps only Fable probes, which are measurements, not settings.
- **Migration.** `pipeline.mjs migrate` (also first thing in every tick, idempotent) moves the old values:
  - `apiOverflow: true` becomes the rule "API fallback when subscriptions are busy" (to api, `subs: busy`, accounts =
    `apiAccounts`), unless an enabled rule like that already exists.
  - Per-account `parallel` becomes `building`, and `fable` becomes `perAccount.fable`.
  - `use: false` becomes Stop worker for a subscription, or API worker off for an API account.

  It then cleans `settings.json` and `accounts.json`, logs `migrated` and posts an info alert listing what moved.
- **Same status in both places.** The Pipeline tab's accounts come from the same rows, with the same reasons. The API
  overflow switch is replaced by a read-only "API fallback on/off" chip and a **Job routing** button that opens Claude
  accounts settings. A "Job routing: …" line lists the API rules. Toggle use is now "Stop taking jobs" / "Take jobs",
  and it writes workers.json.

## How each part is reached (API rule)
- **State.** REST `GET /pipeline` now has `routing` (`source`, `apiFallback`, `lines`, `rules`, `interactiveTakesJobs`,
  `limits`) next to `accounts`. MCP `pipeline-status`. CLI `pipeline.mjs status` / `accounts` / `settings`. Voice goes
  through the same MCP action.
- **Account edits.** REST `POST /pipeline/account` {name, fable, parallel, use}. New MCP action `pipeline-account`.
  CLI `pipeline.mjs account <name> --fable on|off|auto --parallel n --use on|off`. All of these write workers.json.
  In Claude accounts the same edits are `claude-workers.mjs fable|building|worker|api on|off`.
- **Routing rules and the fallback.** Claude accounts → Job routing (unchanged UI and REST), or
  `claude-workers.mjs rule …`.
- **Migration.** `pipeline.mjs migrate [--json]`, and automatically on every tick.
- **Deep link.** The Pipeline tab's Job routing button dispatches `settings.open:claude-accounts`.

## Checked
- On the VPS with this branch, `pipeline.mjs status` (read-only) now shows `account-5 [API]` and `mossesx-api [API]`,
  plus "Job routing (Claude accounts): API fallback when subscriptions are busy: on (account-5, mossesx-api)".
- Tests: `pipeline.test.mjs` 36 (including a new end-to-end one-source test: migration, the API worker visible, the
  fallback rule, account edits landing in workers.json, the old setting refused). `test.py` 31. `worker-routing.test.mjs`
  46. `claude-workers.test.mjs` 68. claude-accounts `test.py` 89. `tsc --noEmit` for console-web is clean, and
  check-theme, check-controls and check-toolbars pass.

## Notes and gaps
- The live dispatcher still runs main's code until this lands. Its first tick after that does the migration.
- The Claude setting `builds.maxParallel` no longer feeds the dispatcher: the per-account `building` cap in Claude
  accounts is the one number.
- Behaviour change: the console's own account now takes builds after the workers when `interactiveTakesJobs` is on
  (Claude accounts' rule). Before, the pipeline used it only when no worker existed. Turn it off in Claude accounts →
  Job routing to keep it out.
- UI Review shots were not taken: this headless session has no running console on this branch. The Pipeline tab change
  is small (a switch replaced by a chip, a button and a text line). It should be shot from the PR preview.
- No Android/Kotlin twin. The orchestrator and claude-workers are VPS-side only.
