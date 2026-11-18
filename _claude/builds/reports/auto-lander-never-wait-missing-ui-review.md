# Auto-lander: never wait on a missing UI Review, and test the real lander

Build `auto-lander-never-wait-missing-ui-review` (Fable, Nov 18 2026). Brett: "If it recorded the test of the pipeline and
didn't merge it on its own, then the test failed. It should have tested itself before it did the demo."

## What was wrong

PR 816 (the orchestrator live demo) sat held for hours. The lander's UI Review hold came from one line in the console's
`/ui-hold` route: anything the review state said that was not `''` held the PR, and a lookup that failed answered
`unknown`, which held it too. The demo's own landing act was a dry run: it recorded what it would merge and merged
nothing, so nothing ever proved the real lander path. Nobody saw a flag, because the only thing that held it was a review
item that was never in the console.

## Before / after

| | Before | After |
| --- | --- | --- |
| UI Review item missing from the console | the PR waits (`unknown` / "waiting" from the land record) | lands when CI is green; verdict `pass` + flag `ui-review-missing`, `reviewFlag: missing` |
| Item exists only in the build's worktree (`submit` without `--console`) | invisible: never approved, PR waits | lands flagged `unposted`; the gate rule `ui-review-posted` posts it; `submit --console` now exits 2 unless the console confirms the item |
| Review lookup fails (console down, plugin error) | hold ("UI Review couldn't be read, so it waits") | never a hold: lands flagged `missing` |
| Item exists and waits / changes asked / rejected | hold | hold (unchanged) |
| How long has it been held? | not recorded | `heldSince`, `holdReason`, `reviewFlag` on every `lander-state@1` record (older records get their last-seen time) |
| Who notices a flagged landing? | nobody | UI Review → Screenshots notice (group `<build id> - missing review`) + a build note; `lander-state@1.flagged[]` |
| A PR held too long | nothing | systems check `held-prs`: red past `heldAlertMin` (60), pushed once, **Land now** per PR |
| The demo's landing | dry run, nothing merged | the lander self-test first (real gate verdict, real lookup, queue in check mode); then the demo PR through the real merge queue; the act passes only when it merged |

## The PR 816 replay (`apps/console-web/plugins/gate/test/test.pr-816-replay.mjs`, in CI)

CI green, build claims a review, the console has no item: the live gate rules pass it flagged, the landing line's lookup
(`land.mjs lookupReview` → `GET /api/plugins/ui-review/state`) is no hold and a console that does not answer is no hold
either, the merge queue takes it (`notReady` empty), the server auto-lander decides `land` with `reviewFlag: missing`.
Held past the limit: `held_prs` lists PR 816 at 360 min over the 60 min limit with the reason; the systems check item is
red with a Land now row; Land now confirms, then `queue add` + `queue move 816 0` with an override note in History, never
a direct merge. A submit the console takes but does not list: `review.mjs submit --console` exits 2.

## What each step shipped

- **s1** `gate-rules@1`: `UI_STATES` + `missing`, `unposted`; `UI_FLAGGED`; `REVIEW_FLAGS`; `VERDICT_FLAGS`; verdict
  `flagged / flags / reviewFlag / notes`; default `holdOn` = waiting, changes, rejected. GATE.md "The UI Review verdict".
- **s2** `lander-state@1`: `heldSince`, `holdReason`, `reviewFlag` on each record (migration: last-seen time), `flagged[]`,
  `heldOlderThan`, `HELD_STATES`. Schema, registry, fixture regenerated.
- **s3** check-gate-rules: 10 new cases (missing / unposted / unknown land flagged; waiting holds; changes / rejected do not
  land; legacy `holdOn` with unknown; red CI + missing review keeps the flag as information; held-age fields; migration).
- **s4** Lander: `land.mjs lookupReview` + `land-core.reviewLookup` (null answer → unknown → flag; none + claimed →
  missing; worktree-only → unposted); `blockReason` holds only on `UI_HOLDS`; land.json records carry `reviewFlag`,
  `heldSince`, `holdReason`; `auto-lander.mjs decide` lands flagged (`reviewFlag` on the action and the build); the VPS
  runner and the gate's snapshot pass it through; push-banner `ui_holds`, `/ui-hold` → `{hold, holds, flag}`.
- **s5** Merge queue: `notReady` holds only on an existing item; `heldEntry` keeps `heldSince` across rounds and writes
  `holdReason`; `flaggedLandings`; landing-line migration turns a hold on a missing review into a waiting entry with the
  flag (never parked) and gives held entries `heldSince`.
- **s6** `flagReview`: Screenshots notice (`<build id> - missing review`) + build note on a flagged landing; `land.json`
  and `merge-queue@1` `flagged[]`.
- **s7** Gate setting `heldAlertMin` (Settings → Plugins → Gate; `setting:gate.heldAlertMin`).
- **s8** Systems check `held-prs` (`server/held_prs_health.py`, `gate.mjs held_prs`): red past the limit, pushed once.
- **s9** Land now: `gate.mjs land_now` (front of the queue + override note, two-step confirm, releases a hand hold first),
  rows on the item (fix type `prs`), `gate.land-now` action.
- **s10** Console-control: `row:held-prs`, `grid:held-prs`, `grid:held-prs/row:<n>[/button:land-now]` (destructive),
  `row:<check id>` on every banner item; baseline 437 → 436.
- **s11** `review.mjs submit --console` confirms the item (exit 2 otherwise); `confirm <id>`, `posted --build`.
- **s12** Build rule `ui-review-posted` (VPS, gate, `fixers/ui-review-posted.mjs`): check against the live console, fix
  posts the missing items; in the live store (rev 12) through `axf gate build-rules add`.
- **s13** Demo self-test (`orchestrator-demo/selftest.mjs`, `demo-selftest@1`), act `self-test` before the landing; a
  failure stops the run and raises `orchestrator-demo:selftest`; systems check `demo-selftest`.
- **s14** Demo landing for real (`real-landing.mjs`; push-banner `POST /demo-branch`, `/demo-branch/delete`): branch
  `demo/<build>`, one line in `_claude/builds/demo/landings.md`, PR, real merge queue; passes only once merged.
- **s15** The replay above. **s16** Docs. **s17** Checks, this report, THREADS, PR, merge queue.

## How each feature is reached (REST / MCP / CLI / voice / console-control)

| Feature | REST | MCP | CLI | Voice / action | Deep link |
| --- | --- | --- | --- | --- | --- |
| Verdict for a PR | `GET /api/plugins/gate/check?pr=` | `gate_check_pr` | `axf gate check <pr>` | "can 816 land" | `view:gate/tab:gate.tabs=rules` |
| Held PRs (state) | `GET /api/plugins/gate/held-prs[?limitMin=]` | `gate_held_prs` | `axf gate held-prs` | — | `row:held-prs`, `grid:held-prs/row:<n>` |
| Land now | `POST /api/plugins/gate/land-now {pr, note?, confirm?}` | `gate_land_now` | `axf gate land-now <pr>` | `gate.land-now:<pr>` ("land 816 now") | `grid:held-prs/row:<n>/button:land-now` |
| Held PR alert after | `PUT /api/plugins/gate/settings {heldAlertMin}` | `gate_settings_set` | `axf gate settings set heldAlertMin 90` | `gate.setting:heldAlertMin:90` | `setting:gate.heldAlertMin` |
| Waiting PRs with heldSince / reviewFlag | `GET /api/plugins/gate/lander/waiting` | `lander_waiting` | `axf gate lander waiting` | "what's holding 816" | `tab:gate.tabs=auto-lander` |
| Review posted? | `GET /api/plugins/ui-review/items` | — | `review.mjs confirm <id> --console`, `posted --build B --console` | — | `view:ui-review` |
| Build rule ui-review-posted | `GET /api/plugins/gate/build-rules/ui-review-posted` | `gate_build_rules_get` | `axf gate build-rules get ui-review-posted` | — | `tab:gate.tabs=build-rules/row:ui-review-posted` |
| Demo self-test | `POST`/`GET /api/plugins/orchestrator-demo/selftest` | `orchestrator-demo_selftest`, `…_selftest-last` | `axf demo selftest [--last]` | `demo.selftest` ("run the demo self-test") | `row:demo-selftest` |
| Demo real landing | through the demo (`POST /api/plugins/orchestrator-demo/start`) | `orchestrator-demo_start` | `axf demo orchestrator start` | "start the orchestrator demo" | `view:builds` |

## Checks run (s17)

check-gate-rules 48 · check-landing-line 31 · check-auto-lander 28 · check-build-rules 27 · check-live-demo 419 ·
check-console-control (rawButtons 436, lower than before) · control-inventory current · check-theme · check-controls ·
check-toolbars · gate test.mjs 21 · test_held_prs.py 18 · test.build-rules 7 · test.ui-review-posted 6 ·
test.pr-816-replay 7 · orchestrator-demo test.mjs 17 · land.test 140 · merge-queue.test 18 · push-banner test.py 194 ·
ui-review test.mts · console-web `tsc --noEmit`.

## Choices made (nobody to ask)

- The console-control grammar has no `pr` segment and a row sits under a grid, so the brief's `row:held-prs/pr:<n>` is
  `grid:held-prs/row:<n>` (the item itself is `row:held-prs`).
- `changes` / `rejected` stay verdict `fail` (a fix is wanted), not `hold`: both still never land, which is what the
  cases check.
- The seed `_claude/builds/build-rules/seed.json` is the migration's output and is not edited; the rule lives in the live
  store (added through the CLI) and the README says how to add it elsewhere.
- The demo's real landing commits one line under `_claude/builds/demo/` on a `demo/<build>` branch; the push-banner route
  refuses any other branch or path.
