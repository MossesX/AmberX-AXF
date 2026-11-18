# Fix CI red on main: watchdog test vs done-means-merged guard, alerts engine job

Build `fix-ci-red-main-watchdog-test-vs-done`. Status: draft.

## Failing runs

### Run 44171482751 (main, #813) — Build engine sweep (Node)

Step `node apps/console-web/plugins/build-orchestrator/test/watchdog.test.mjs`:

```
builds-store: refused q-merged queued → landed: landed needs the merge commit (landed.sha)
✗ run: complete / archive builds under the store lock, remove queue entries, close review items
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'queued'
- 'complete'
    at watchdog.test.mjs:98
```

The watchdog's builds table settles a queued build whose PR merged with `settleStatus`, which derives `landed`
(every step ticked + `mergedAt`). The done-means-merged@1 store guard refuses `landed` without `landed.sha` (and
`landed.ci = success`), so the build snaps back to `queued`. The test still expected the pre-guard `complete`.

### Run 44186908843 (main) — Web Dev Console job, step "Alerts + MCP client + axf_server"

The alert engine checks themselves pass. The step fails later on the token registry check in the same step:

```
✗ apps/console-web/plugins/plan-studio-2/plugin.json: no "tokens" block (token-registry@1): list the --fx-* tokens the UI reads under "uses"
1 token registry problem(s).
```

Locally on current main the same check also flags `apps/console-web/plugins/orchestrator-demo/plugin.json`.
Not engine drift and not a stale fixture: two new plugins landed without the token-registry@1 `tokens` block.

## Reproduction

`AXF_DATA_DIR=off node apps/console-web/plugins/build-orchestrator/test/watchdog.test.mjs` fails locally with the same
refusal. Code path: `watchdog.mjs` `plan()` → `stale-rows` verdict `complete/pr-merged` → `watchdog/tables/builds.mjs`
`apply()` → `settleStatus()` sets `landed` → `builds-store withStore` → `enforceDoneGuard` → `guardStatus`
(`framework/core/build-pipeline.mjs`) refuses: landed needs `landed.sha` and `landed.ci = success`.
