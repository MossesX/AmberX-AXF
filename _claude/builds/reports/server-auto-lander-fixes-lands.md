# Server auto-lander fixes and lands everything on its own (`server-auto-lander-fixes-lands`)

Brett said (Nov 16 2026): "We need the auto lander to bang shit out on its own. It needs to automatically fix it. We
need a server rule to do that. Make the server do it automatically without the console."
Absorbed: `fix-red-ci-blocked-builds-they-land` ("Put fix main on more than one slot, they won't conflict.") and
`get-main-green-unblock-lander-land-axf` ("We gotta migrate to Postgres to get this going, finish the migration for
Postgres. Is the auto-lander fixed?"), both archived; get-main-green's open steps are s24/s25 here.

## Result
The VPS now runs the auto-lander rule by itself: `axf-auto-lander.timer` ticks every minute, no console needed.
- Clash → main merged in a private worktree; generated files from main and regenerated (now including `axf schemas`);
  pushed through the token broker. A hand-written clash goes to a fix session.
- Red CI → failure summary (job, step, first errors, the "CI build errors" issue) → an Opus fix step with Brett's words,
  started through the orchestrator pipeline's own launch on a routed account. Never two sessions for one build.
- Green → `land.mjs queue add`: the merge queue is still the only way to merge.
- 3 failed tries of one kind (backoff 5 / 15 / 45 min) → red systems-check item `gate-auto-lander` with
  Reset and fix now, and exactly one phone push per build (`gate.auto-lander-escalated`). Also red when the service stops.
- Every attempt is logged per build (`<data>/auto-lander/attempts/<build>.jsonl`, auto-lander-attempt@1); a crash resumes
  from the log.

Phase 1 (Fable) made the contract, engine, fixture and gate rule. Phase 2 (Opus, this session) made the runner and
every surface.

## API reach per feature
| Feature | Deep link | REST (`/api/plugins/gate`) | MCP | CLI | Voice (console action) |
| --- | --- | --- | --- | --- | --- |
| Status | `view:gate/tab:gate.tabs=auto-lander/tab:gate.auto-lander.tabs=server`, `panel:gate.auto-lander` | `GET auto-lander` | `gate_auto_lander_status` | `axf gate auto-lander status` | `gate.auto-lander.status` |
| One build's attempt log | `grid:gate.auto-lander/row:<build>`, `gate.auto-lander.open:<build>` | `GET auto-lander/builds/<b>` | `gate_auto_lander_build` | `… show <b>` | `gate.auto-lander.open:<b>` |
| Run now | `button:gate-al-run` | `POST auto-lander/run` | `gate_auto_lander_run` | `… run [--now]` | `gate.auto-lander.run` |
| Retry | `button:gate-al-retry` | `POST auto-lander/retry/<b>` | `gate_auto_lander_retry` | `… retry <b>` | `gate.auto-lander.retry:<b>` |
| Fix (reset + fix session) | `button:gate-al-fix`, systems check Fix | `POST auto-lander/fix/<b>` | `gate_auto_lander_fix` | `… fix <b>` | `gate.auto-lander.fix:<b>` |
| Pause / Resume | `button:gate-al-pause`, `button:gate-al-resume` | `POST auto-lander/pause`, `/resume` | `gate_auto_lander_pause`, `_resume` | `… pause`, `… resume` | `gate.auto-lander.pause`, `.resume` |
| Settings (enabled, maxAttempts, backoff ×3, attemptTimeoutMin, pushOnEscalation) | Settings → Plugins → Gate → Server auto-lander, `setting:gate.autoLander.<key>` | `GET/POST auto-lander/settings` | `gate_auto_lander_settings`, `_settings_set` | `… settings`, `… set <k> <v>` | `gate.auto-lander.set:<k>:<v>` |
| The rule itself (phase 1) | `view:gate`, `row:auto-lander` | `/rules/auto-lander` | `gate_rules_get/set/toggle` | `axf gate rules … auto-lander` | `gate.rule:auto-lander` |

## Files
`deploy/auto-lander/` (auto-lander, attempts, merge-main, ci-status, fix-session, reconcile, escalate, tests + fakes),
`deploy/systemd/axf-auto-lander.{service,timer}`, `framework/deploy/axf-deploy.sh` (axf_systemd_unit,
axf_auto_lander_install), `deploy/install-console.sh`, `framework/deploy/test.sh`, `framework/spec/generated-files.json`
(schemas generator), gate plugin (routes, auto_lander_health.py, notify.json, plugin.json commands, gate.mjs CLI words,
web: AutoLanderTab, AutoLanderSettings, autoLanderState, actions, settingsStore; help, README; assets; test_auto_lander.py),
systems-check `health.py` (`push: false` for a check whose owner pushes itself), CI (`android.yml`).

## Checks run (all green)
check-auto-lander 27 · check-gate-rules 38 · check-landing-line 31 · builds-store verify · tracker --check ·
`node --test deploy/auto-lander/test/` 26 · test_auto_lander.py 55 · gate test_routes 34 · gate test.mjs 21 ·
land.test 110 · deploy test.sh 58 · systems-check 231 · notify-control 133 · check-theme, check-controls,
check-toolbars, check-chrome-assets, check-console-control, control inventory, help coverage 100%, console tsc.

## UI Review
Item `r-20261117-0pcgp01`: three list layouts (grid, cards, compact) for Gate → Auto-lander → Server, desktop + phone
each; assets in `apps/console-web/plugins/gate/assets/settings/`. Non-blocking for the runner.

## Choices made without asking
- The new UI is the Server sub-tab of the existing Auto-lander tab (its own TabGroup), so `tab:gate.tabs=auto-lander`
  keeps working and the merge line stays one tap away.
- MCP names follow the registry's rule: `gate-auto-lander_status` becomes `gate_auto_lander_status`.
- Voice goes through console actions (`gate.auto-lander.*`), the way the gate's other voice commands do.
- `run` from the console asks the service for a tick (within a minute); `axf gate auto-lander run --now` ticks on the host.
- One push per escalation: the health item is registered with `push: false` (a new, backward-compatible health@1 field)
  because the runner sends the per-build push itself.

## Left / follow-ups
- The timer is installed by `install-console.sh` on the next console install / nightly deploy; until then the systems
  check item `gate-auto-lander` is red ("hasn't ticked"), which is the reminder.

## Postgres migration (s24, from get-main-green-unblock-lander-land-axf)
Checked on the VPS on Nov 17 2026 at about 04:40 UTC. Read-only: another actor started the staged move minutes before
(namespaces entered shadow from 04:30 UTC), so I didn't race it with a cut-over.
- `axf-data` runs with `AXF_DATA_ENGINE=shadow` against `axf-data-db` (postgres:16). Postgres holds **15992 keys
  in 48 namespaces**. The service's own SQLite file is empty: everything went straight to Postgres, and
  `migrate_pg.py --verify` therefore reports a mismatch against an empty SQLite file. That is expected, not a data problem.
- Source (the console's local files, `data-migrate.mjs` dry run) compared with Postgres per namespace: **44 of
  47 equal**. The ones that differ are still in `local` mode, so they aren't mirrored yet and drift is expected:
  - `sessions`: source 5710, Postgres 5705
  - `plugins/activity`: source 31, Postgres 78
  - `builds`: source 1699, Postgres 1700
- Console data modes: `changes`, `notes`, `planner` and several plugins are in `shadow`, waiting out the 30-min quiet
  window; `builds`, `console`, `sessions` and others are still `local` (next: `data-migrate apply <ns>`, then shadow).
  The console reads its local files in both modes, so nothing reads the empty SQLite side.
- Spot check: Postgres table `builds` has 985 rows, matching the builds store (`builds-store verify`: 985 records).
  `GET /api/plugins/data-store/tables` answers from the Postgres engine.
- Systems check: `axf-data` is green ("axf-data is up; last backup 1.2 h ago, verified").
- What's left: the move goes namespace by namespace (`data-mode.mjs shadow|cutover <ns>`, quiet window 30 min). Build
  `axf-data-postgres-real-tables-own` owns it and its s3 is still open.

## Main CI and the lander (s25, from get-main-green-unblock-lander-land-axf)
Checked Nov 17 2026, about 04:45 UTC.
- **Main is green.** The last 4 pushes (765ca6b51, 7015af4b8, 92dc0cf86, ec2a35d78) all passed "Android framework +
  console" and "Build and publish site". axf-data (#704) and axf-data Postgres (#713) are on main.
- **The merge queue is landing.** 3 PRs are testing (#769, #768, #766). #774 (this build) waits for its PR checks.
  #767, #765 and #764 are red: until this PR is on main and the timer is installed, nothing fixes them by itself.
- **The server auto-lander starts when this PR lands.** The next console install or nightly deploy installs
  `axf-auto-lander.timer` (`install-console.sh` → `axf_auto_lander_install`). Its first ticks pick up the red PRs (fix
  sessions) and the clashing ones (main merged in), and send the green ones to the merge queue one at a time. Until the
  timer ticks, the systems check item `gate-auto-lander` is red ("hasn't ticked"), so a missed install shows up.
