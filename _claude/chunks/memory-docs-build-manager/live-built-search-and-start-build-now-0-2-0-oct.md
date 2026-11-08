<!-- memory-chunk@1 source=_claude/memory/docs/build-manager.md tokens=996 -->
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
