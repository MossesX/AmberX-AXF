# Report: auto-rebuild-failed-merges (r6) - server gate: a build that can't merge fixes or rebuilds itself on fresh main

Brett, Nov 11 2026 (voice, Gizmo): "You gotta redo anything automatically. Make that a server gate. Fix everything. If
something fails, re-pull in main and rebuild it. ... Yellow that it's being rebuilt, green when it passes, red if it fails
three times. And why. ... Blue if it's a full rebuild. ... Clear the reds. ... Some kind of log somewhere."

## What was built
- **Merge gate** (`apps/console-web/plugins/push-banner/land/merge-gate-core.mjs` rules, `merge-gate.mjs` runner). Runs on
  the VPS host inside every auto-land round (`land.mjs run`, cron every 3 min), right after the merge queue. Plain Node,
  node built-ins only, no model calls (land.test.mjs zero-token check covers the new files).
  - Detects: merge queue kick-outs (code conflict with main, red batch), PRs conflicting with main, auto-land conflict /
    red CI, and branches more than `mergeGateBehind` (150) commits behind main.
  - Attempt kinds: **fix** (yellow) = main merged into the branch with the landing data rules, then a fix session filed
    through `pipeline.mjs request --id <build>-fixN --queue` (the orchestrator is the only launcher; the session works on
    and pushes to the old branch only); a data-only conflict needs no session. **rebuild** (blue) = `pipeline.mjs request
    --id <name>-rN` from origin/main with the original brief (Brett's words + detail + origin brief), the old branch name,
    report path and the failure list ("do NOT merge it"); old build gets a "Superseded by" note and is archived, the old
    PR gets a comment and is closed; both are linked in the log (`links.chain`).
  - Rule: a new branch gets a fix first; a failed fix on the same branch, or too far behind, gets a rebuild. Cap 3
    (setting 1-6). After the cap: red, held, one `merge.blocked` push (`land:gate:<build>`, high priority).
  - Green: "Passed" when the PR checks are green on a new head, "Merged" when the queue lands its PR. The gate never
    pushes to main (tested); results go through the normal merge path (queue). Auto-merge per build: off removes the PR
    from the queue until Merge.
  - Every step is posted in the group chat as the `landing` section owner (Merge Max) and the phone notification for the
    build is updated in place (`gate:<build>`, new notify type `merge.gate`).
  - With the gate on, auto-land's own agent-job hand-off stays out (one launcher).
- **Merge log** (`merge-log.json`, merge-log@1, in the push banner data folder; survives restarts; clearing only sets a
  banner flag). Commands go through `merge-gate-control.json` (applied by the next round; clear / restore / archive show
  at once).
- **Console**: push banner groups "Auto-fixing / Rebuilding", "Failed - needs you" (Clear reds), "Fixed and merged"
  (Clear merged), one entry per build with label, why, expandable lines, X per entry, View log. New page **Merge log**
  (view `merge-log`, Builds menu + nav): framework DataGrid, sort, state filters, search, column hide, archived toggle,
  multi-select (Ctrl/Cmd-click) with a command bar, right-click menu (multi-select aware), expandable rows with every
  attempt (why, conflict files, failing checks + error lines, what it changed, fix/rebuild build, Claude account, cost,
  tests), Related links (build, superseded/fix/rebuild builds, branch, PR, old PR, build report in MD Studio, session
  log, Plan Studio, group chat, UI Review) and timeline.
- **API** (every action four ways): REST `GET /api/plugins/push-banner/merge-log`, `GET .../merge-log/entry/{ref}`,
  `POST .../merge-log/{retry|fix|rebuild|merge|skip|automerge|clear|restore|archive}` `{ids}|{group}`,
  `POST .../merge-log/settings` `{on, cap, behind}`; MCP via plugin-commands (`mergegate-*`); CLI
  `node apps/console-web/plugins/push-banner/land/land.mjs gate log|show|retry|…|settings` (or merge-gate.mjs directly);
  console actions `push-banner.merge-log`, `push-banner.gate.<cmd>:<ids>` (no ids: retry / clear act on every red one;
  voice "retry the failed merges", "rebuild X", "clear the reds").
- `pipeline.mjs request --id` (chosen ids for `-rN` / `-fixN`; refused when taken).
- Fixed on the way: `agent-slots/help.json` had help kind `panel` (invalid), which failed `help-coverage --check` on main.

## Tests
- `land/merge-gate.test.mjs` (new, in CI): 14 checks: why text, rules, rebuild ids, groups/clear/restore/archive, commands;
  real git + fake GitHub/orchestrator/console rounds: conflict -> yellow auto-fix with why + fix session; fix ends still
  conflicting -> blue rebuild `feat-r2`, old build archived + noted, old PR closed; pass -> green Passed -> Merged; three
  failures -> red with why per attempt and the error lines, one merge.blocked push, no more attempts; Clear reds keeps
  the log; Retry / Merge / Skip / Auto-merge; off = nothing; never pushes to main.
- `land.test.mjs` 98, `merge-queue.test.mjs` 18, `push-banner/test.py` 195 (12 new merge-log route checks),
  `pipeline.test.mjs` 45. tsc clean; check-theme, check-controls, check-toolbars, check-chrome-assets,
  check-plugin-pages, plugins --check, help-coverage --check, crew-say check, ci-scope, menu-reach all pass.

## Not done / follow-ups
- `control_act` (control@1) has no `merge.log` target: adding one is a control@1 engine + schema change (Fable, with the
  Kotlin twin deferred). The commands are reachable by REST, MCP, CLI and console actions (voice) meanwhile.
- The grouped merge banner of `claude/auto-merge-switch-r4` (Auto-merge? / Ready / Blocked / Merged) is not on main; the
  gate groups live in the push banner today and can move into that banner when it lands.
- The build is not in the builds store (no `auto-rebuild-failed-merges*` id), so steps couldn't be ticked or linked.
