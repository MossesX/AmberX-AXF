# Stale-row watchdog on the VPS (orchestrator-stale-row-watchdog-vps)

Brett, Nov 16 2026: "I want a server fucking watchdog on the VPS to do that."

## What it does
Every 5 minutes (cron `axf-stale-watchdog`, flock + run.lock, never two at once) the VPS reads every builds list —
Pending / Queue / Building (builds store), the merge queue (service:axf.merge-queue@1) and UI Review (service:ui-review@1) —
gathers the facts once (origin/main merges and squash subjects, branch heads, GitHub PR states through an ETag cache:
an unchanged run costs 0 rate limit), classifies each row with stale-row@1 (phase 1, Fable) and cleans:

| List | complete (PR merged / on main / build complete) | remove (PR closed / build dead) |
| --- | --- | --- |
| Builds store | PR + mergedAt recorded, status settles by the store's own rule (complete only when every step is ticked) | archived |
| Merge queue | `land.mjs queue remove` (skipped while the PR is open) | `queue remove` |
| UI Review | item closed as landed (`item.landed`, status kept, never approved; skipped while the PR is open) | closed as removed |

Guards: running / waiting builds are never written; a row whose build moved since the read is skipped; a second run is a
no-op (queue removals pinned to the head, closed items and settled builds drop out). Every builds write is one
`withStore` (store lock, journal, live to main).

Each applied action: a stale-row-log@1 record in `.axf-console/plugins/build-orchestrator/watchdog/log.jsonl`
(rotated to `log-YYYY-MM.jsonl` monthly), a build note, one closed Codebase changes entry per cleaning run, and one
batched FYI to AmberX (notify type `watchdog.cleaned`, Notifications panel controls it).

## How each part is reached
| Part | REST (/api/plugins/build-orchestrator) | MCP (plugin-commands) | CLI | Voice / console action |
| --- | --- | --- | --- | --- |
| Status, last runs, log | GET /watchdog | watchdog-status | `axf watchdog status` | orchestrator.watchdog.status |
| Cleanup log | GET /watchdog/log | watchdog-log | `axf watchdog log [--kind] [--action] [--build]` | orchestrator.watchdog.log |
| Run now | POST /watchdog/run | watchdog-run | `axf watchdog run [--force]` | orchestrator.watchdog.run (confirms) |
| Dry run | POST /watchdog/dry-run | watchdog-dry-run | `axf watchdog run --dry-run` | orchestrator.watchdog.dry-run |
| Settings | PUT /watchdog/settings | watchdog-settings | `axf watchdog set <key> <value>` | orchestrator.watchdog.set:<key>:<value> |
| The card | — | console_show `panel:build-orchestrator.watchdog` | — | orchestrator.watchdog.open[:settings\|runs\|log] |

Settings targets: `setting:orchestrator.watchdog.{enabled,intervalMin,dryRun,tables.builds,tables.merge-queue,tables.ui-review,notify}`.
UI: Settings → Plugins → Build orchestrator → Watchdog (TabGroup `build-orchestrator.watchdog.tabs`: Settings, Last runs, Cleanups log).
Health: systems check item `orchestrator-watchdog` (red when on and the last run failed or is older than 3 intervals; Auto fix reinstalls the cron on the VPS and reruns it).

## Dry run on the VPS data (Nov 17 2026, nothing changed)
```
watchdog dry run 2026-11-17T12:53:08.239Z · 162 rows · 77 to change · 0 cleaned · 26117 ms
  ✓ Builds store (Pending, Queue, Building): 23 rows
  ✓ Merge queue: 55 rows
  ✓ UI Review: 84 rows
  GitHub: 27 requests, 0 not modified
  …
  · Building x.engine.dev → Remove: Its PR was closed without a merge (PR #513 closed; build x.engine.dev: running; branch claude/x.engine.dev deleted)
  · Building land-round-2 → Complete: Its PR merged on main (PR #313 merged 2026-11-04T17:27:24Z (585c23993d01); on main by merge-commit 585c23993d01; build land-round-2: blocked; branch claude/land-round-2 deleted)
  · Building land-all-97-built-but-unmerged-builds-skins-firs → Complete: Its PR merged on main (PR #474 merged 2026-11-11T00:48:50Z (654c24ce3a57); build land-all-97-built-but-unmerged-builds-skins-firs: blocked; branch claude/land-all-97-built-but-unmerged-builds-skins-firs deleted)
  · Pending build merge-main-land-console-axhub-retry → Remove: Its PR was closed without a merge (PR #589 closed; not on main; build merge-main-land-console-axhub-retry: pending)
  · Pending build axf-data-postgres-real-tables-own → Complete: Its PR merged on main (PR #713 merged 2026-11-17T02:53:56Z (765ca6b513fb); on main by merge-commit 765ca6b513fb; build axf-data-postgres-real-tables-own: pending; branch claude/axf-data-postgres-real-tables-own deleted)
  · Merge queue entry 760 → Remove: The build was cancelled (PR #760 open; not on main; build remove-old-molly-app-project-keep-axf: archived)
  · Merge queue entry 759 → Remove: The build was cancelled (PR #759 open; not on main; build re-sync-stuck-branches-lander-can-push: archived)
  · Merge queue entry 757 → Remove: The build was cancelled (PR #757 open; not on main; build server-gate-one-session-per-build-no: archived)
  · Merge queue entry 756 → Remove: The build was cancelled (PR #756 open; not on main; build orchestrator-table-columns-model-queue-assigned: archived)
  · Merge queue entry 755 → Remove: The build was cancelled (PR #755 open; not on main; build ui-review-filter-and-search-by-pr: archived)
  · Merge queue entry 754 → Remove: The build was cancelled (PR #754 open; not on main; build ui-directory-plugin-self-updating-data: archived)
  · Merge queue entry 753 → Remove: The build was cancelled (PR #753 open; not on main; build per-instance-settings-small-live-preview: archived)
  · Merge queue entry 751 → Remove: The build was cancelled (PR #751 open; not on main; build auto-lander-controls-in-the-gate-plugin: archived)
  · Merge queue entry 750 → Remove: The build was cancelled (PR #750 open; not on main; build console-app-part-2-native-floating-2: archived)
  · Merge queue entry 749 → Remove: The build was cancelled (PR #749 open; not on main; build console-app-part-4-console-side-safe: archived)
  · Merge queue entry 748 → Remove: The build was cancelled (PR #748 open; not on main; build console-app-part-3-native-bridge-mic: archived)
  · Merge queue entry 734 → Remove: The build was cancelled (PR #734 open; not on main; build ui-manager-floating-window-to-select-any: archived)
  · Merge queue entry 690 → Remove: The build was cancelled (PR #690 open; not on main; build themed-native-controls-plugin: archived)
  · (+ 59 UI Review items: closed PRs and merged PRs)
```
Of these, at apply time the two running builds (x.engine.dev, axf-data-postgres-real-tables-own) are skipped (left to
the orchestrator) and blocked builds with open steps only get the merge recorded.

A trial apply on copies of the VPS data cleaned 73 rows (1 build archived, 13 merge-queue entries removed, 59 UI Review
items closed); the second run cleaned 8 more UI Review items whose PRs were only fetched then (25 single-PR lookups per
run beyond the 200 most recent), the third run was a no-op.

## Checks
check-stale-rows (32), watchdog tests (14), builds-store verify, check-theme, check-controls, check-toolbars,
check-console-control, check-chrome-assets, plugin-commands check (71/71), plugin-lifecycle check (build-orchestrator,
ui-review, push-banner, codebase-changes: clean apart from the session's own untracked brief), glossary catalog --check,
orchestrator test.mjs / pipeline.test.mjs / test.py, ui-review test.py, console tsc.

## Open
- UI Review: the 3-option submit did not happen. A local console capture (rebuild-shots, hub off) could not reach
  the card (the scratch console's search found nothing, then its API dropped). The card needs real screenshots from
  the deployed console after landing (`ui-predict.mjs real orchestrator-stale-row-watchdog-vps`).
- `framework/spec/check-done-means-merged.mjs` (named in the brief) exists neither on this branch nor on main: not run.
- Kotlin twin of stale-row@1: deferred (PORTING.md, phase 1).
