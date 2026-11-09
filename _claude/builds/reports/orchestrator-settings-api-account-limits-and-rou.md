# Orchestrator settings: API account limits and routing rules

Build `orchestrator-settings-api-account-limits-and-rou` (Opus, Phase 1). Branch `claude/orchestrator-settings-api-account-limits-and-rou`.

Brett said (Nov 9 2026, 16:25): "I need the settings in the orchestrator to configure the API limits and the rules."

## What changed

- **Settings → Plugins → Build orchestrator → API limits & routing rules** (new panel, first in the tab):
  - *When builds may use an API account*: the API overflow switch, plus checkboxes for the API accounts the dispatcher may use (none ticked = any). These are saved to pipeline-settings@1 (`apiOverflow`, `apiAccounts`).
  - *API accounts & spend caps*: add or remove an account, set its label, daily and weekly caps in USD and alert level, and turn it on or off.
  - *Routing rules*: add, edit, reorder (up/down), turn on or off, and delete rules. Conditions: job type, model, priority, profile, steps left (min/max), minutes left and subscriptions busy.
  - *Test a job*: preview which account a job would go to.
- The API account and rule editors are the existing Job routing config that the launcher reads, so the orchestrator and Claude accounts screens edit the same data. The orchestrator gets them through the new web capability `axf.job-routing@1` from the Claude accounts plugin (`JobRouting` with an `only` section filter, `useApiAccounts`, `open`). Neither plugin imports the other's folder. If Claude accounts is off, the panel says so and still shows the overflow and allowed-accounts controls.
- The Pipeline tab has a new **API limits & rules** button next to the API overflow switch. It opens the panel.
- Server: `axf.claude-accounts@1` gained `routing()`, a read-only view of API accounts with caps, alert level, on/off, key and spend, plus the rules in order and the alerts. It never returns a credential. The orchestrator adds `GET /pipeline/limits`, which returns the overflow setting, allowed accounts and Job routing in one read.

## How each part is reached without the UI

| What | Deep link | REST | MCP / plugin command | CLI | Voice |
|---|---|---|---|---|---|
| Open the panel | action `build-orchestrator.limits` (console_open) | – | console action | – | "open the orchestrator API limits" |
| Read everything | – | `GET /api/plugins/build-orchestrator/pipeline/limits` | `build-orchestrator.pipeline-limits` | plugin commands runner | "what are the API limits" |
| Overflow and allowed accounts | – | `POST …/build-orchestrator/pipeline/settings {apiOverflow, apiAccounts}` | `build-orchestrator.pipeline-settings-set` | `pipeline.mjs set apiOverflow=… apiAccounts=a,b` | same command |
| API account add/remove/on/off/caps/label | – | `POST …/claude-accounts/routing/api` | `claude-accounts.routing-api` | plugin commands runner | same command |
| Rules add/edit/move/on/off/remove | – | `POST …/claude-accounts/routing/rule` | `claude-accounts.routing-rule` | plugin commands runner | same command |
| Test a job | – | `POST …/claude-accounts/routing/test` | `claude-accounts.routing-test` | plugin commands runner | same command |

The existing safeguards are unchanged. Only Brett's own click can turn API overflow on or raise or add a spend cap. Sessions, MCP and voice can turn overflow off and can lower a cap.

## Checks

- `python3 apps/console-web/plugins/claude-accounts/test.py`: 91 passed (2 new, for `routing()`).
- `python3 apps/console-web/plugins/build-orchestrator/test.py`: 33 passed (2 new, for `/pipeline/limits` with and without Job routing).
- `node apps/console-web/plugins/build-orchestrator/test.mjs` and `node --test pipeline.test.mjs` both pass.
- `tsc --noEmit` (console-web) is clean.
- check-theme, check-controls, check-toolbars, check-chrome-assets and `plugin-commands check` all pass. `plugin-lifecycle check claude-accounts` is clean. `plugin-lifecycle check build-orchestrator` lists only stale references that already existed (`framework/cli/dispatch-gate.mjs`, the untracked session brief).

## Gaps

- **UI Review screenshots are missing.** The VPS had no Playwright browser; I installed Chromium in `~/.cache/ms-playwright`. On the scratch console from `rebuild-shots.mjs` (`AXF_APPEARANCE_HUB=off`), Settings never opened the Plugins → Build orchestrator sub-tab, either through `settings.open:build-orchestrator` or by clicking. So no desktop or phone shot of the panel was taken and nothing went to UI Review. The next session needs to capture it from the live console and submit it.
- No Android or Kotlin work. The console plugin has no Android twin.
