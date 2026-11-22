# p2-lander: Pipeline 2.0 part 2 of 4 (one-PR lander, size cap, merge queue view)

Branch `claude/p2-lander` (pushed, not merged, no PR of its own: the four parts merge into one PR). Nov 19 2026, Opus.

## What shipped

1. **New lander `deploy/lander/run.mjs`** (systemd `axf-lander.timer`, every minute, own lock). On `build-complete` it
   takes the one build and runs `merging-pr` (every step branch merged into `lander/<build>`, one PR opened, each step
   `in-pr` with its `prNumber`), `pr-pulling-main`, `running-ci` (CI once, then the gate's build rules on the same
   green head), `merging-main` (GitHub merge, sha pinned), then `landed`. Every status goes to the builds store as it
   changes, with `at` and `by`.
   Files: `lander-core.mjs` (pure rules), `git.mjs` (git and GitHub), `store.mjs` (the one seam to the store),
   `land-rules.mjs` (merge rules ported from push-banner `land-core.mjs`), `config.json`, tests in `test/`.
2. **Size cap**: `sizeCapLines` (default 4000 lines, insertions + deletions, tracking files left out) in
   `deploy/lander/config.json`. The data folder's `config.json`, the env var `AXF_LANDER_SIZE_CAP`, the Gate settings
   panel and MCP `gate_auto_lander_settings_set` can override it. Over the cap, steps are grouped in order into as few
   PRs as fit (`lander/<build>-2`, `-3`, …). Those PRs land one at a time, in order. Steps that share a branch always
   stay in the same PR.
3. **Failure rules ported** (push-banner `land.mjs` and `land-core.mjs`, plus `deploy/auto-lander` `decide()`):
   - Data conflicts resolve by themselves: tracking files, builds files, union files, union-json files, and generated
     files that get regenerated.
   - A code clash between two steps splits the PR, one PR per step.
   - A code clash with main starts a fix session (`agent-job.mjs land-build`) on the PR branch.
   - Red CI gets one re-run of the failed jobs on the same head (flaky checks). If it is still red, a group of two or
     more steps splits; a single step gets a fix session.
   - Failing build rules start a fix session.
   - A merge GitHub refuses means main is pulled in again.
   - Infra errors retry the same phase.
   - CI that never started gets dispatched once per head. CI that runs too long counts as a failure.
   Every failure is `failed` with `attempt: N` and a `failure` record. After a capped backoff (2, 4, 8 … 30 min) the
   next tick retries forward by itself. Nothing escalates to a person. From attempt 3 on, each attempt is posted to the
   crew chat and shows on the systems check (`gate-auto-lander`, amber, "nobody needs to act").
   One addition: a head with only light PR checks gets one full `workflow_dispatch` run, and only the full run counts.
4. **Push banner uninstalled** (`plugin-lifecycle uninstall push-banner --code`; `check --after-uninstall` is clean).
   - Its cron line is gone from `deploy/install-console.sh`, and every deploy now runs `rm -f /etc/cron.d/axf-auto-land`.
   - The queue-hold deploy prelude is gone too.
   - `deploy/auto-lander/` (auto-lander@1) is retired. `axf_lander_install` replaces `axf_auto_lander_install`: it
     installs `axf-lander.{service,timer}` and stops and removes the old `axf-auto-lander` timer.
5. **Gate**: the command checks of `before` and `after` build rules (for example `one-builds-store` ⇒
   `builds-store.mjs verify`) never run at launch or at the end hook any more. They run at the gate, which the lander
   runs once per green PR head inside `running-ci`, in a temporary worktree of the PR branch. Fixers (home card, help
   stub, THREADS row) stay in their phase.
   The gate's Auto-lander routes, systems-check item, CLI bridge, Server panel and settings now read the lander.
6. **Merge queue 2.0** is the new plugin `merge-queue-view` (`view:merge-queue`, `service:axf.merge-queue@2`). It is a
   read-only view of the builds store: status (failed shows the attempt), time in status, PRs, and steps ("added to PR
   #N", model, slot). It has no state, no actions, no buttons and one GET route.

## Checks run (all green)

Node 20.20.2 on this VPS.

| Check | Result |
|---|---|
| `node --test deploy/lander/test/` | 21/21 (real git, bare origin, fake GitHub, in-memory store) |
| `node apps/console-web/plugins/merge-queue-view/test.mjs` | 12 |
| gate `test.mjs` | 21 |
| gate `test/test.build-rules.mjs` | 8 (new: command checks deferred to the gate) |
| gate `toolbar.test.mjs` | 28 buttons |
| gate `server/test_routes.py` | 34 |
| gate `test_auto_lander.py` | 45 (rewritten for the lander) |
| `framework/deploy/test.sh` | 58 |
| `check-landing-line` / `check-gate-rules` | 32 / 38 |
| `check-json-data-writes` | ok |
| ref-links / build-breaker tests | 19 / 14 |
| `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` | ok |
| `plugin-lifecycle check` | gate, merge-queue-view and push-banner `--after-uninstall` clean |
| console-web `npm run build` (tsc + vite, heavy slot) | ok |

The only `tsc` error outside the build is the generated `src/control/inventory.json`, which is missing before
`npm run build` (environment). A dry tick against the live store finds nothing to land, because no build has the new
statuses yet.

## UI Review

Submitted, single option (existing layouts re-pointed at new data), group "p2-lander - Nov 19 12:45 PM", desktop and
phone shots for each:
- Gate → Auto-lander → Server
- Merge queue

They were submitted to the local review store. `--console` needs `AXF_CONSOLE_URL`/`AXF_TOKEN`, which this headless
session doesn't have. Shots come from `apps/console-web/scripts/auto-lander-shots.mjs`.

## FOR FABLE REVIEW: contract changes and assumptions

1. **The builds store must hold the lander's statuses and fields (p2-status-core).** Today `normBuild` maps an unknown
   status to `pending` and drops unknown fields, so on the current schema every lander write is lost.
   `store.mjs` reads each write back and stops the tick with `store: the builds store did not keep …`, so the failure
   is never silent.
   - Build fields written: `status`, `statusAt`, `statusBy`, `statusLog[{status, at, by, attempt?, note?}]`,
     `attempt`, `failure`, `pr`, `landedAt`, `notes`.
   - `landing { split, merged[pr], closed[pr], reruns{head,n}, rules{head,ok,failing}, ciKick{head,at}, fullKick }`.
   - Step fields written: `status`, `prNumber`, `statusAt`, `statusBy`, `statusLog`.
   - Step field read: `branch`. A step's own branch is used if present, else the build's branch.
   If status-core names these differently, only `store.mjs` (applyChange/lost) and `lander-core.mjs`
   (groupState/landingOf) need to change.
2. **`failure` shape collides** with the existing done-means-merged `failure` (normFailure). The lander's record is
   `{kind, status, why, head, pr, at, retry, notBefore, failing?, runIds?, fix?}`, where `status` is the phase it failed
   in. The lander treats a `failed` build whose `failure.status` is a landing phase as its own.
3. **Forward-only interpretation.** Per PR group the status only moves forward. A later group (size cap, or after a
   split) starts its own run at `merging-pr`; `canMove(…, {group:true})` allows that. From `failed`, a retry continues
   at any landing phase, and the climbing attempt counter is what marks it as a retry. A step goes `in-pr` → `in-pr`
   with a new `prNumber` after a split.
4. **`service:axf.merge-queue@1` is gone**; the new view provides `merge-queue@2` (read-only, no data folder writes).
   The old readers now get nothing:
   - build-orchestrator `pipeline.mjs` (land.json), `server/__init__.py` (`mergeQueue`, `pulls`) and
     `watchdog/tables/merge-queue.mjs` (owned by p2-watchdog / p2-ui)
   - the gate's legacy "Merge line" sub-tab, `lander.*` tools and header buttons Land now / Pause lander / Resume lander
     (`gate-store` `landerDir`). They read empty and the mode switch answers "unavailable". I left them in place to
     keep the toolbar contract; they should be removed in a follow-up.
5. **build-rules@1 semantics**: `rulesFor(store, 'before'|'after')` no longer returns vps rules with a command check,
   and `rulesFor(store, 'gate')` now includes them (`deferredToGate`).
6. **`/api/plugins/gate/auto-lander*` answers `lander-status@1`** instead of `auto-lander-state@1`. Fields: `service`,
   `current`, `queue`, `builds` = merge-queue rows, `failing`, `escalations: []`, `settings`.
   - The settings keys changed: `maxAttempts`, `attemptTimeoutMin` and `pushOnEscalation` are gone; `sizeCapLines`,
     `flakyReruns`, `ciNoneKickMin`, `ciTimeoutMin`, `fixTimeoutMin`, `notifyAfterAttempts`, `workflow` and
     `mergeMethod` are new.
   - The MCP input schema in gate `plugin.json` is updated to match.
   - `retry` and `fix` make a failed build's next attempt due now. They no longer reset anything.
7. **Shared rule replaced**: `_claude/shared/rules/RULES.md`. The lifecycle strip removed "Only the merge queue merges"
   and "Automatic merge". One rule, "Only the lander merges", replaces them and keeps "every change through a PR" and
   the builds-live status-only exception. Please check the wording.
8. **PR branches** are `lander/<build>[-k]`. They are rebuilt and force-pushed while no PR exists, and deleted after
   the merge. The merge method is `merge` (config).

## Decisions made without asking

- **Never escalate to a person.** The old `maxAttempts` escalation is gone (Brett: "absolutely no human intervention,
  ever"). The backoff caps at 30 min and attempts keep going. Repeated failures show on the systems check as amber,
  not red.
- **No UI Review hold before merging**, for the same reason. I briefly added a setting for it and removed it, because
  it would need a person.
- **Host-local files** in `.axf-console/lander/`: `service.json` heartbeat, `control.json` pause and run-request,
  `gh-cache.json` ETag cache, `config.json` local settings. They are operational, not build state, and are marked
  `axf-data: not data`.
- **Plugin folder is `merge-queue-view`, not `merge-queue`.** The lifecycle stale check flags every "merge-queue"
  word in other code (row kinds, table ids). The view id is still `merge-queue`.
- **Fixed collateral of the removal outside my files** (one line each):
  - build-breaker's Build menu entry "Branches not on main" (the deleted `push-banner.check`) now opens the Merge queue
  - ref-links test/sample data no longer names push-banner
  - `src/lazyEngine.ts` drops `push-banner`
  - `framework/deploy` installer and its self-test
- **Push banner features lost with it**: the auto-PR for every branch, axHub/Build-Pilot auto-merge, and the
  6-hourly branch protection check. The new rule says other repos land one deliberate merge at a time. Branch
  protection upkeep has no owner now.

## Not done / follow-ups

- **Build `p2-lander` is not in the builds store**, so there were no steps to tick and nothing to `builds-live link`.
- Remove the gate's legacy Merge line sub-tab and the `lander.*` mode switch (item 4 above).
- `_claude/memory/docs/auto-lander.md` still describes auto-lander@1. I didn't rewrite it.
- Repo variable `AXF_MERGE_QUEUE` can be switched off now. Until then the lander dispatches the full run itself, so
  nothing waits on it.
