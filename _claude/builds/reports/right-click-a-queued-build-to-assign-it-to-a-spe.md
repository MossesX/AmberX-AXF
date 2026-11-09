# Right-click a build to assign it to a saved account (right-click-a-queued-build-to-assign-it-to-a-spe)

Built Nov 9 2026 on Opus, branch `claude/right-click-a-queued-build-to-assign-it-to-a-spe`.

Brett said (Nov 9 2026 16:03): "I need to be able to right-click jobs in the orchestrator and assign them to one of my
stored accounts."

## What changed
- **Right-click menu.** Right-click (or long-press on a phone) any build card or grid row in the orchestrator (Pipeline
  tab: Pending, Queue and Building; Builds tab) to open **Assign to account: <current>**. The menu lists **Auto (the
  dispatcher picks)**, every saved subscription login (e.g. Hulu, Moses X, brettspend) and every API-key account (e.g.
  Hulu API, Moses X API). Each entry shows what it can take now (Fable or Opus, running/parallel, an API key's state),
  and the current pin is ticked. When two accounts share a label, the saved name is added to tell them apart.
  Builds that have left the pipeline (built, complete) show no entry.
- **The pin** is a new field `pipeline.pin` on the build-pipeline@1 record (`framework/core/build-pipeline.mjs`): `''`
  means Auto, otherwise it holds a saved account name. You can change it while a build is Pending or Queued. On a
  Building build it applies from the next run, and the running session is left alone.
- **Dispatcher** (`pipeline-core.mjs pinnedRoute()`): a pinned build runs only on its account, and the pin wins over
  the route (Auto / API / Subscriptions). If that account is busy, the build waits for its slot ("pinned to X: waiting
  for its slot (1/1 running)") and is never moved to another account. A subscription login takes the build whatever its
  role (worker or the console's own account), unless it is switched off, limited, at its cap, or lacks Fable for a Fable
  phase. An API account also needs its key and room under its daily and weekly caps (`api.usable`). The launch note
  says "(pinned)".
- **On the card:** "on <account>" (accent colour), plus "Next tick: starts on X · pinned". A hint line above the three
  columns explains the right-click.

## API (all four the same)
- **REST:** `POST /api/plugins/build-orchestrator/pipeline/pin {id, account}`. `account` is a saved name, a label or
  an email ("Moses X API" = mossesx-api), or `auto`. The state is readable in `GET /pipeline`
  (`table.*[].pipeline.pin`, `accounts[]`).
- **MCP / control@1:** the plugin command `pipeline-pin` (MCP `build-orchestrator_pipeline-pin`, REST
  `/api/control/build-orchestrator/pipeline-pin`). Voice (AmberX) reaches it through control@1: "assign <build> to
  Moses X".
- **CLI:** `node apps/console-web/plugins/build-orchestrator/pipeline.mjs pin <build> <account|auto>`, or
  `axf build-orchestrator pipeline-pin`.
- **Console action:** `build-orchestrator.assign:<build>:<account|auto>`. The deep link is the orchestrator view
  (`nav:build-orchestrator`, Pipeline tab).
- **Billing guard:** pinning to an API-key account bills per token, so over REST, MCP and voice it is Brett's own
  signed-in console click only, the same rule as route api. Without that click the server passes `--deny-api` and the
  answer is 403. Pinning to a subscription login, or back to Auto, is open to everyone.

## Tests
- `pipeline.test.mjs` (36 checks): pinnedRoute covers any saved login, waiting for its slot, no Fable, the pin winning
  over the route, the API cap, an unknown account, a switched-off account, and two builds pinned to one slot (the
  second waits). normPipeline is covered too. The e2e checks run `pin` by name, `auto` and an unknown account.
- `test.py` (34): the REST pin passes `--deny-api` unless the request is Brett's click.
- `test.mjs` (33), `tsc --noEmit`, check-theme, check-controls, check-toolbars, check-chrome-assets,
  check-plugin-commands and check-plugin-pages all pass.
- Not from this build: `plugin-lifecycle check build-orchestrator` flags references in `framework/cli/dispatch-gate.mjs`
  (already on main) and in the untracked `.axf-brief.md`. `help-coverage` fails on `claude-accounts/help.json` entry 17.

## Screenshots
Desktop and phone screenshots from a scratch console reading the real accounts are in UI Review (r-20261109-156a9d3a). PR #411.

## Deferred
- Android twin: none (no Kotlin work). The pin is a field on the shared record, and the console is the only UI.
