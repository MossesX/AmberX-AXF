# Fix CI red on main: watchdog test vs done-means-merged guard, alerts engine job

Build `fix-ci-red-main-watchdog-test-vs-done`. Status: done, PR open (merge queue).

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

## Fix: watchdog (done-means-merged@1)

`watchdog/tables/builds.mjs` `apply()` for a `complete` verdict on a queued/pending build:

- reads the PR's merge commit from the facts the watchdog already gathers through the cached GitHub read
  (`stale-facts.mjs` `readPrs` → `mergeCommit`, or the main-history commit for the PR); `plan()` now passes
  `mergeCommit` (and `ci` when known) on each verdict;
- records the evidence: `pr`, `mergedAt`, `landed = { pr, sha, mergedAt }`;
- moves the build to `landed` when CI on the merge commit is known green, otherwise to `landing` (the lander's
  CI-on-main check takes it on to `landed`); open steps keep the status. `complete` is never set by the watchdog, only
  by the feature verify;
- with no merge commit known, nothing moves: one note (`NO_SHA_NOTE`, written once) says why, and the verdict is
  reported as not applied. No refused transition is attempted.

Test `test/watchdog.test.mjs`: q-merged → landing with `landed.sha = m101`, no "Refused" note; new q-nosha case (PR
merged, no merge commit: stays queued, one note); new direct case (CI green → landed with the evidence; open steps
keep the status). 15 tests green.

## Knock-on (Build engine sweep)

Running the sweep's build/store/landing checks locally (check-builds-store, -lock, -live, pipeline.test,
test-watchdog, check-build-watchdog, check-build-pipeline, check-done-means-merged, check-stale-rows,
check-landing-line, check-gate-rules, check-auto-lander, check-builds-store-data, check-live-demo): all green. Nothing
else depended on the old watchdog → complete path.

Two more sweep checks were red on main behind the watchdog test (CI stops at the first failure):

- `help-coverage.mjs --check`: framework 182/184 (two new ChromeContext buttons). Drafts written and synced.
- `check-plugin-pages.mjs`: the Orchestrator demo page had no `fx-pagehead`. Added the standard page head.

Environment-only failures on the VPS, not CI: check-agent-slots / claude-workers / claude-login /
claude-token-save (the VPS build limit and live accounts), session-checkin (headless run is detected as unattended),
shipped-features and the auto-lander `node --test` glob (need Node 22: both pass under Node 22).

## Alerts + MCP client + axf_server step

All 119 commands of the step run locally. The alert engines (TS `check-alerts.mts`, Python `test_alerts.py`), conflict
detection, the console alert server, web push encryption, the MCP client and axf_server tests all pass: no engine
drift, no stale fixture, so no engine change and no fixture regeneration (s8, s9 not needed).

CI stops at the first failure, so main hid more than the one shown in run 44186908843. Real failures, all from two
plugins that landed without their registry entries:

| Check | Cause | Fix |
|---|---|---|
| `check-token-registry.mjs` | plan-studio-2 and orchestrator-demo have no `tokens` block | `token-registry.mjs manifest <folder> --write` (only the block is new) |
| `check-page-toolbars.mts` | orchestrator-demo ships a page toolbar asset no page draws | `<PageToolbar view="orchestrator-demo" />` on the demo page, replacing the hand-drawn Start / Summary row (the asset has both plus Next, Pause, Resume, Skip, Stop) |
| `check-page-toolbar-voice.mts` | the voice inventory lacks the demo toolbar | `--write`: 7 new phrases, nothing else changed |
| `menu-reach.mts` | orchestrator-demo has a page, dialogs and a settings tab but no `web/menu.ts` | menu.ts: Builds ▸ Start the orchestrator demo…, Plugins ▸ Orchestrator demo settings |
| `shared-assets.mjs check`, axhub-web / amberx-droid tests | baked copies of the help drafts added in s6 | `shared-assets.mjs bake --all` |

Environment-only on the VPS (pass in CI conditions): `test_wall_users.py` (needs the built `dist/`, which CI builds
first), `console-control-parity.mjs` (port 7097 taken by another session; green on another port),
`check-headless-tabs.mts` (this session's `CLAUDE_CODE_DISABLE_CLAUDE_MDS`; green with a clean env),
`refresh-check.mts` and `test_console_commands.py` (timing under load; green on rerun).

## API check (no new UI)

The watchdog adds no screen, setting or action; it now writes `landing` / `landed` (existing done-means-merged@1
statuses) and the `landed` evidence instead of an attempted `complete`. Every existing read path shows it:

- Store / CLI: the write goes through `withStore` (action `stale-watchdog`), so `node framework/cli/builds-store.mjs
  history <id>` lists the revision, and `pending.mjs` / `build-queue.mjs` show the build's status.
- Console: Build orchestrator pipeline view (`pipeline.tsx`, `attempts.tsx`) already draws landing and landed; the
  watchdog's own card, REST, MCP, CLI (`watchdog.mjs status|log`) and voice report the run and each change line,
  including "merge commit unknown: left as is".
- MCP `pending_list` and the orchestrator reads, and voice status (`crew-say.mjs`), read the same store status.

No UI was added or changed for the watchdog. The UI touched in this build is the Orchestrator demo page (page head,
framework page toolbar instead of hand-drawn buttons, menu entries); every button on it was already reachable by deep
link (`?axf-open=orchestrator-demo`), REST (`/api/plugins/orchestrator-demo/*`), MCP (plugin-commands tools, console
actions), the CLI and voice ("press <button> on the orchestrator demo toolbar", now in the voice inventory).

## Before / after

| Check | Before (main) | After (this branch) |
|---|---|---|
| `test/watchdog.test.mjs` | ✗ refused q-merged queued → landed; expected complete | ✓ 15 tests |
| Build engine sweep build/store/landing checks | stopped at the watchdog test | ✓ all (15 run individually) |
| `help-coverage.mjs --check` | ✗ framework 182/184 | ✓ 100% |
| `check-plugin-pages.mjs` | ✗ orchestrator-demo no page head | ✓ |
| Alerts step: `check-token-registry.mjs` | ✗ plan-studio-2 (and orchestrator-demo) no tokens block | ✓ |
| Alerts step: page toolbars, voice inventory, menu-reach, shared assets | ✗ (hidden behind the first failure) | ✓ |
| Alerts step: alert engines TS + Python, MCP client, axf_server, conflict detection, web push | ✓ | ✓ |
| `tracker.mjs --check`, `axf.mjs validate --framework`, `check-done-means-merged.mjs` | ✓ | ✓ |
