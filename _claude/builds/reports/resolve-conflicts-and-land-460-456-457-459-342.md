# Resolve conflicts and land #460, #456, #457, #459, #342

**Brett said (Nov 10 2026, 20:40):** "If anything doesn't work, just fix it. Don't tell me, just tell me when it's fixed."

Build `resolve-conflicts-and-land-460-456-457-459-342`, Opus, branch
`claude/resolve-conflicts-and-land-460-456-457-459-342`.

## What was done (s1)

Each PR's branch got latest `origin/main` merged in (detached worktrees `/root/axf-builds/rc-<n>`; the builds' own
worktrees hold uncommitted builds-store churn and were left alone), conflicts resolved keeping both sides, tests run,
pushed to the PR branch. Nothing was merged by hand: the merge queue lands them (rules: only the queue merges).

| PR | Conflicts | Resolution | Checks |
|---|---|---|---|
| #460 splitter fix | `build-orchestrator/pipeline.mjs` (imports, `probe`) | Main had moved the probe into `callAccount()` + `P.healthOf`; kept that and moved its `claude -p` call onto `P.oneShotArgs()` with the prompt on stdin, the same bug #460 fixes for the split (a prompt after the variadic `--tools ''` is swallowed). Imports: `spawn` (main) + `statfsSync` (#460). | pipeline.test 47, test.mjs 33, test.py 31, check-theme |
| #456 enforce the merge queue | `claude-accounts/help.json` (one `kind`) | Main's value. Marked ready (was a draft). | merge-queue.test 17, push-banner test.py 183, help-coverage, theme, controls |
| #457 merge batching | 10 files against #456 (main merged in cleanly) | #456 and #457 each built batch mode in the same files. #457 is stacked on #456 so it doesn't conflict again after #456 lands, and there is **one** batch runner: #457's (`queue/batch-<n>`, 5 per batch, 1–10, merged as one PR, AI conflict fallback, batch history; #459 builds on it). #456's intent kept on it: `enlist` (every finished build gets a PR), red / missing light checks join behind green ones (`greenFirst`, `notReady(redJoins)`), alerts resolved on landing, `enlisted` + `split` + `items[].inBatch` in `GET /queue`, Merge on AmberX-AXF queues the PR, the builds-store retired-profile fix. One `POST /queue/settings` route (#457's keys) with #456's guard: switching the queue off is Brett's own click (403 otherwise). CLI `settings` takes `--on` too. #456's `landBatch` / `batchMembers` / `batchHolds` / `queue/batch` dropped (same job, other runner). | merge-queue.test 22 (+ redJoins / greenFirst and a new enlist test), push-banner test.py 188 (defaults 5 / 1–10), land.test 92, check-ci-scope 10, help-coverage, theme, controls, plugin-lifecycle |
| #459 red-batch send-back | 4 files against resolved #457 | Union: send-back (`fixJob`, bisect tracking, `autoFix` / `fixTries`) + enlist / green-first / `split` / `enlisted`. Added the missing help entry for the **Red run** link (help coverage was 1602/1603 under the 100% ratchet). | merge-queue.test 25, test.py 192, land.test 92, help-coverage ratchet |
| #342 build optimizer | 8 files (main moved 2,278 commits) | Kept main's tabs, search, priority host, pipeline routes and retired Build manager; added the packager / optimizer actions, dialogs, `builds.toolbar` slot, context menus, Build optimizer settings tab, menu entries. `plugin.json` / `help.json` merged structurally by command / target id (30 commands); version 0.6.0. `builds-store-core`: main's `priority` + `foldRetired`, plus `package` / `optimized` / `packagedInto` and `meta.optimize`. CSS: both blocks. | test.py 54, test.mjs 52, pipeline.test 42, check-builds-store 40, check-builds-live 62, theme, controls, toolbars, chrome-assets, help-coverage |

Console typecheck (`tsc --noEmit`) could not run on the host (no `node_modules` in any checkout); the queue's full CI
run covers it.

### Landing

At 21:20 the queue had #456 then #457 testing (stack mode, the mode on main until #456 lands). #460's light checks are
red only because of main's own red `builds-store verify` (retired `breakroom` profile folder), which #456 fixes; once
#456/#457 land and the console redeploys, batch mode lets red light checks join behind green ones and the batch's one
full run decides. #459 and #342 join as their light checks finish. The console redeploys by itself after each landing
(one deploy per batch / stack). AmberX is told when all five are on main.

## s2: fixed along the way

- `plugin-lifecycle check build-orchestrator` failed on main: `framework/cli/dispatch-gate.mjs` named the plugin folder
  (`apps/console-web/plugins/build-orchestrator/pipeline.mjs`). The refusal now names the orchestrator's
  `pipeline-queue` / `pipeline-request` commands (console API, MCP, plugin CLI `pipeline.mjs queue <id>`); pipeline.test
  42 green.
- Every queue run failed on main's own code (seen when #455 + #456 + #457 were tested, run 42905250816):
  `ui-review/test.py` "picked or not, all three stay" (GET /choices/assets also returns real ui-choice assets other
  builds committed; the check now reads only its own choice set) and a `check-build-hook` flake (the lock folder's
  `mtimeMs` has sub-ms precision and can sit past `Date.now()`, so a 0 ms stale limit sometimes missed; floored).
  Both fixes are on this PR and cherry-picked onto #456, the first of the five in the queue, so its run can go green.
- The next queue run (#456 with those two fixes, run 42910008551) showed three more failures on main's own code,
  each hiding the steps behind it:
  - Kernel `AppearanceConformanceTest`: the Kotlin twin's `AppearanceEngine.NEVER` was only `uac-policy`; the
    reference engine's `APPEARANCE_NEVER` is `uac-policy, help, appearance-package, skin` (skins and help added them).
    Synced, so the shared slot types equal the fixture again (82 kernel tests, this was the only red one). A parity
    fix to an existing twin, no new Kotlin work.
  - `theme-editor/test.mts` "no Other for the known tokens": the Windows skin's `scrollbar` style token had no
    category; it is under Layout now.
  - Deploy helpers shellcheck: `done` used as a word (SC1010) quoted in `axf-deploy.sh` and `test.sh`; `! bash`
    (SC2251) replaced with an explicit failure. Self-test 51 green.
- Plugin lifecycle (CI loops every plugin with `set -e`) failed on main for four plugins:
  - `framework/cli/shipped.mjs` found UI Review by folder name: now by capability (`service:ui-review@1` +
    `review.mjs`, data dir from its lifecycle block).
  - Sample data used real plugin names: `approvals-banner` in the shipped-features tests and
    `check-shipped-manifest.mjs` (now `example-banner`, fixture regenerated), `systems-check` in `pipeline.test.mjs`
    (now `health-check`), glossary term id `ui-review` (now `ui-review-queue`).
  - THREADS / RULES lines about the glossary build carry `<!-- axf-plugin:glossary-index -->` and are listed in its
    lifecycle mentions.
  - `plugin-lifecycle.mjs` skips the two generated snapshot fixtures (`shipped-manifest.json`, `demo.json`), like
    the other history files.
  Every plugin's lifecycle check is clean on a fresh checkout; every plugin `test.mts` passes on Node 22 (docker).
  All of this is on this PR and cherry-picked onto #456.
- Main's light checks are red for every PR (`builds-store verify`: retired `breakroom` folder): fixed by #456, which
  is first in the queue.

## API

No new UI in this build. The merge queue's surfaces (from #456 / #457 / #459): `GET /api/plugins/push-banner/queue`,
`GET|POST /queue/settings`, `POST /queue/add|remove|move`; MCP `push_banner_mergequeue_list / _settings / _set / _add /
_remove / _move` (plugin-commands@1); CLI `node apps/console-web/plugins/push-banner/land/merge-queue.mjs list |
settings | add | remove | move`; voice through control@1's plugins domain; deep link `action:push-banner.queue`.
The optimizer (#342): `POST /api/plugins/build-orchestrator/optimize/*`, `package/*`, actions
`build-orchestrator.optimize` / `.package`, settings tab `build-optimizer`.

## Gaps

- UI Review: #457 / #459 / #342 changed screens; their own builds own the UI Review items. Nothing new to review here.
- If the queue kicks one of these out, its reason is on the PR; the next session fixes that branch.
