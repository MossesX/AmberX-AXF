# Build manager (console plugin)

Built Oct 21 2026 on Opus; 0.2.0 the same day (Live from every session, Built history, search, Start build now). Plugin `apps/console-web/plugins/build-manager` (`ai.amberx.axf.console.build-manager`). <!-- axf-plugin:build-manager -->
Nav → **Builds → Build manager**. The core view that was labelled "Build" is now **Build queue** everywhere (route `build` unchanged).

## What it shows

**Everything still to build, one list** (one row per build, nothing counted twice):

| Source | What's listed | Steps / estimate read from |
|---|---|---|
| Pending | pending items not complete (pending, unsafe, broken, failed); Fable ones are the Fable rebuilds | item `estimate?`, sub prompts `{text, estimate?, done?, doneAt?}` |
| Queue | build-queue steps not done (queued, in progress, blocked, needs rework) | `StepRecord.estimate?`, `StepRecord.steps?: {text, estimate?, done?, doneAt?}[]` |
| Plan | unbuilt plan features no epic covers (`feature.epic` / `epic.catalog`) | optional `estimate` / `steps` on the feature |

A pending item linked by `planId` replaces the queue step or plan feature with that id (the row keeps the queue position).
Each row: title, source badge, model chip, status, **time left** (its estimate, else its steps added up, minus done steps;
"no estimate" badge when there's none), steps bar (n of m), **needs split** when over 30 min with no steps (rule "Small
steps for big builds"), and a drop-down with details and every step (estimate + tick). Filters: model, status, source,
needs split. Sort: build order, time left (shortest first), model. **Totals by model**: time left on Fable / Opus / Sonnet + all.

**Live tracker** at the top: activity-feed items (capability `axf.activity@1`: GitHub runs, console update, assistant
replies, VPS jobs, Claude Code reports) plus builds marked in progress (plan status `in-progress`, elapsed since its
"Build started" history line). A run is linked to its build by branch `fable/<id>`, `rebuild/<id>` (also `<id>-fable`),
`harvest/<plan id>` (dots = dashes), `pilot/<…>`, or a report naming the id. Each entry: elapsed vs estimate (amber when
over), current step, progress bar, link to the item and the run. Finished entries linger 4 s, then leave.

**Banner** (order 4.5, right after the Activity banner) only while a build from the list is in progress or just
finished; tap opens the Build manager at that item; ✕ hides it until something new starts.

**Settings → Plugins → Build manager**: banner on/off, default sort, which sources; About (totals, tick status); Install & uninstall.

**Hooks**: action `build-manager.open[:<row key | id | planId>]`, `build-manager.refresh`; search provider
`build-manager.items` (every build); default context menu; context target `axf-build-item` on rows; "Open in Build
manager" on Pending builds rows (`axf-pending-item`) and Plan features (`axf-plan-feature`).

## Live, Built, search and Start build now (0.2.0, Oct 21 2026, Opus)

Three tabs under one **search bar** (every word must match; title, id, notes/detail, steps, model, branch, surface,
host, plan id): **Remaining** (the list above, with a **Start** button on every row), **Live**, **Built**.

**Live** = every build any Claude session reported to axHub (change-log@1 with build stats, read through
`axf.changes@1`; see `codebase-changes.md`): VPS, other computers, claude.ai, console launches, subagents (shown under
their parent), plus the activity feed. Each: elapsed vs estimate (amber when over), cost (actual from token usage,
else ~estimate), model, steps, current activity, where it runs (surface + host), branch, links to the item and the log;
**no word for N min** when a running session stopped sending heartbeats for 10 min. Real time: the server's
`GET events` stream says when any entry file changes (checked every 2 s on the shared folder every surface writes
through axHub), the browser refetches `GET changes?since=<stamp>` (answers `{same}` when nothing changed); polling
every 5 s while the stream reconnects. Badge `live` / `polling`. The **banner** shows the first running session build
(title, model, elapsed / estimate, cost, steps, where, current step, progress, +N more).

**Built** = every finished build (backfilled history included): model, date, time (actual or ~estimated), cost
(actual, or ~estimated with an `estimated` badge), failed / verified / broken badges, branch, commits, report/PR links,
Log. Totals overall + by model or by week (estimated part shown), filters model / period (all, 7 d, 30 d, this week) /
cost actual or estimated. "Check nothing broke" on console launches.

**Start build now** (row button, context menu on Build manager rows, Pending builds rows and Plan features, action
`build-manager.start:<key>`): the server plans it with `web/orchestrate.mjs` (pure; run through `web/plan-cli.mjs`):
- dependency closure from plan `dependsOn` + queue `deps`, deepest first (cycles broken and reported); the build
  queue is reordered through the `build-reorder` engine so unbuilt deps come right before it;
- **never twice**: refused when a running entry has the same buildRef or branch;
- **never on top of other work**: "wait" when its areas (entry areas, plan files/modules, plugin folder) overlap any
  running or silent entry's areas (prefix on `/`), naming who and where; a dependency being built → wait;
- model from the item (Fable stays Fable; a queue step takes its strongest unbuilt feature); branch `fable/<id>` or `build/<id>`;
- a brief (detail, steps, deps, do-not-touch list from running entries, rules, the reporting commands, the checks).
It opens a `console-launch` entry (queued, steps: approve / build / verify), then asks axHub `vps.run` for one command:
a fresh worktree of `/opt/axf` on the branch, the brief (base64), `claude -p --model <m>` in the background with
`AXF_SURFACE=console-launch AXF_ADOPT_CHANGE=<id>` (the session's hooks report on that entry). Approval: link + alert at
once, retried 15 s × 10 then every minute (Brett's rule) until approved, rejected or expired (30 min). Never pushes to
main, never merges. **Verify** (`POST verify {changeId}`, "Check nothing broke"): the checks for the touched areas
(plugin self-tests + lifecycle, theme check, menu reach, framework assets/tracker, manifests; the console build runs
only with `AXF_VERIFY_BUILD=1`, CI covers it) + the branch's CI through lib-github → `verify` verified / broken (names
the failures) / pending (CI running). Server routes: `GET changes|events|jobs`, `POST start {key, dryRun?}|verify`;
`dryRun` plans without the VPS.

Logic + tests: `web/history.mjs` (Live/Built/totals/filters/search), `web/orchestrate.mjs` (plan, overlap, brief,
launch command, verify checks); `test.mjs` 83, `test.py` 38 (fake axHub: approval + retries + alert link, rejection,
dry run on real data, refusals, verify; never writes framework/plan).

## Data and ticks

- Logic: `web/merge.mjs` (pure; `buildRows`, `timing`, `totalsByModel`, `filterRows`, `sortRows`, `linkRow`, `liveEntries`), estimates parsed by pending-core's `estimateMinutes` / `formatMinutes`.
- Server part (read-only, console token, 404 when off, never on MCP): `GET /api/plugins/build-manager/live` = the activity feed's running + recently finished items, or `{available: false}` without it. The build list comes from the console's own `/api/pending`, `/api/build-queue`, `/api/plan` (works offline from the page's snapshot). <!-- axf-plugin:build-manager -->
- No data of its own (dataDir stays empty); preferences are browser settings `build-manager.banner|sort|sources`.
- **Step ticks** call `POST /api/pending {action: 'step', id, index, done}` (pending-core `apply`) and `POST /api/build-queue/steps {id, index, done}` (build-queue-core `stepsAction`), both from the small-steps build (`fable/split-steps`); aligned at the wave-2 integration (`tickRequest` / `probeTicks` in `web/merge.mjs`, tested in `test.mjs`). The plugin still probes the shared cores on a throwaway state, so a console without those actions shows ticks read-only instead of failing.

## Tests

`python3 apps/console-web/plugins/build-manager/test.py` (38, runs `test.mjs` too) · `node apps/console-web/plugins/build-manager/test.mjs` (83: timing, no double counting, degrade without new fields, totals, filters, sort, branch/report linking, elapsed vs estimate, real repo data). <!-- axf-plugin:build-manager -->

## Screenshots

Phone:

<img src="build-manager/shots/tracker-phone.png" width="260"> <img src="build-manager/shots/view-phone.png" width="260"> <img src="build-manager/shots/needs-split-phone.png" width="260"> <img src="build-manager/shots/settings-phone.png" width="260">

Desktop:

![Build manager list](build-manager/shots/view-desktop.png)
![Live tracker](build-manager/shots/tracker-desktop.png)
![Banner after the Activity banner](build-manager/shots/banner-desktop.png)
![Needs split filter](build-manager/shots/needs-split-desktop.png)
![Settings → Plugins → Build manager](build-manager/shots/settings-desktop.png)

Re-take: `node framework/cli/rebuild-shots.mjs --repo . --out _claude/memory/docs/build-manager --shots _claude/memory/docs/build-manager/shots/shots.json --label shots` (seeds three reports in the scratch activity feed).
