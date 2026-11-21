# Rebuild differences: VPS host services

Rebuild `fable-rebuild-1-2-vps-host-services-move` (Fable, Nov 21 2026) against the version it replaces,
`move-server-side-console-parts-onto-vps` (PR #828, Nov 18 2026, never merged). Build report:
`_claude/builds/reports/fable-rebuild-1-2-vps-host-services-move.md`.

Nothing of #828 was on main, so for apps and the VPS everything here is new. The comparison is with what #828 would
have landed.

## Removed

- The host-service entries `auto-lander`, `pipeline`, `build-watchdog` and the old `stale-row-watchdog` form, with the
  unit files `deploy/systemd/axf-pipeline.*`, `axf-build-watchdog.*`, `axf-stale-row-watchdog.*`. Main retired those
  ticks (Pipeline 2.0); installing #828 would have brought them back beside the new ones.
- The maintenance service's calls into `engine/hostd.py` (from PR #779, closed unmerged) and its "not in this checkout
  yet" answer.
- Cut-over tiers for ten services that were never built (credentials and alerts, terminal, and the rest).
- The edit to `orchestrator-demo` (the plugin is gone on main).
- The manual install step.

## Kept

- host-service@1 as designed: manifest, host API routes, host-error@1, host-service-state@1, the mode file and the
  container → shadow → host migration with guards and rollback.
- The runner `axf-hostd.mjs`, the `axf-host` user, the generated sudo whitelist, `bin/axf-task`, the unit template.
- The six moved services and their workers: builds-live, shipped-features, hub-sync, agent-swarm, systems-check,
  maintenance; and the mode guards in the console's copies.
- The console client, REST `/api/host-services`, the MCP tools, `axf host …`, the voice actions, HostServiceGate, the
  health@1 items, the three page-toolbar option assets.

## Changed

- **Maintenance actions** run their own root task, `deploy/host-services/tasks/maint-docker.mjs`: Clear Docker cache
  (restarts Docker when the cache is stuck, waits for every container, prunes again, reports disk before and after),
  Restart Docker, Status. In #828 these could not run.
- **The installer** skips adopted schedules on install and on uninstall, and is run by `deploy/install-console.sh`
  whenever the host-service files changed.
- **Cut-over tiers**: gateway, publishers (builds-live, hub-sync), independent loops (maintenance, shipped-features),
  host actions (systems-check, agent-swarm), rest.
- **The view** groups rows (moved, already on the host), names what is down in one note, and fits the panel on desktop.
- `builds-live.mjs`: the host-mode guard is placed after main's new `outboxDue` branch, so the console still takes the
  changed builds locally in host mode.

## Added

- **Adopted schedules** in the contract: `adopted: true` (listed and health-checked; never installed, stopped,
  migrated or rolled back from here; mode always reads `host`), `cron: <file in /etc/cron.d>` for a tick cron starts
  (`unit` reads `cron:<file>`; the cron file is its timer, its log's last write its last run), `health.freshness:
  false` for a schedule with a quiet log.
- Twelve adopted manifests: lander, watchdog-l3, build-limit, orchestrator-tick, watchdog-l2, watchdog-audits,
  stale-row-watchdog, reaper, builds-reconcile, claude-token-save, console-nightly, console-update.
- The health item for a missing cron file, with an Auto fix that re-installs the host schedules.
- Logs for a cron schedule (the tail of its log file).

## Contract, API, asset and fixture changes

| What | Change |
|---|---|
| host-service@1 manifest | new optional `cron`, `adopted`, `health.freshness`; `unit` is required unless `cron` is given |
| host-service-state@1 | new optional `cron`, `adopted` |
| Engine | `CRON_PATTERN`, `CRON_DIR`; `serviceState`, `healthItem`, `actionCallErrors`, `controlTargets`, `canChangeMode`, the migration plan and `CUTOVER_TIERS` know adopted schedules |
| Schemas | `framework/schemas/host-service.json`, `schemas/json/host-service.schema.json`, `host-service-state.schema.json` regenerated |
| Fixture | `framework/spec/fixtures/host-services.json` regenerated; new `adopted` block; cut-over order changed |
| Sudoers | no `stop` line for adopted units; no lines for cron schedules; 82 lines |
| REST / MCP / CLI / voice | same routes and tools; adopted rows are in the list; refused calls answer `unknown_action` |
| Assets | none added or changed (the three toolbar options and the home card are as in #828) |

## Migration and compatibility

- No app used #828, so there is nothing to migrate from it.
- On the VPS the console installer creates the `axf-host` user, writes `/etc/sudoers.d/axf-host`, installs seven units
  and mounts `/run/axf-host` into the console. Every service starts in `container` mode: the console keeps doing the
  work, so behaviour does not change until a service is moved with `deploy/host-services/migrate.mjs`.
- Adopted schedules keep running exactly as before; this build only reads them.
- Remove: `bash deploy/install-host-services.sh --uninstall` (data in `_data/host-services` is kept).

## Tests, before and after

| | #828 | This build |
|---|---|---|
| `check-host-services.mjs` | 8 checks, 11 manifests | 9 checks, 19 manifests |
| `test-hostd.mjs` | 25 checks | 31 checks |
| `test-sudoers.mjs` | 6 checks, 84 lines | 6 checks, 82 lines |
| install and rollback drills | 7 + 7 | 7 + 7 |
| console pytest + plugin routes | 5 + 1 | 5 + 1 |
| CI on the PR | never ran to green (2,204 commits behind) | see the PR |

## Known gaps

- Nothing has cut over: every service is in `container` mode until it is moved.
- The console loops do not report their runs for the shadow comparison yet.
- shipped-features on the host needs Node 22 (the VPS shell has 20); it reports degraded until then.
- A cron schedule's failed run reads as up when it still writes its log.
- The loops that stay in the console are listed with reasons in the build report § 1d.
- Kotlin twin deferred (PORTING.md).
