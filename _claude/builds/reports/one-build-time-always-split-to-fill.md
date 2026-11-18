# Report: one build at a time, always split to fill every slot

Build `one-build-time-always-split-to-fill` · branch `claude/one-build-time-always-split-to-fill` · PR #846 · Nov 18 2026.
Phase 1 (Fable): contract, schema, planner, state machines, store fields (s1–s5). Phase 2 (Opus): s6–s27.
Contract `framework/spec/BUILD-SPLIT.md` (split-plan@1). Operator doc `_claude/memory/docs/build-split.md`.

## What changed

- **One build at a time.** The dispatcher plan (`pipeline-core.mjs plan`) launches one build a tick. An active run or a
  held main lock (`main-lock@1` in the store's `meta`) gates every other build. `builds.maxParallel` (the 4-builds rule) is retired.
- **Auto-split on intake** (`pipeline.mjs intake` → `planSplit`). A Pending or Queued build with no current plan goes
  to `splitting` at once. The step splitter runs when there are no steps, then the part planner runs with the free-slot
  count. The plan and its split id (`<build>.r<n>`) go in the store and the build returns to its status. The old
  orchestrator-auto-split-tab path is gone; that build had no store record, so there was nothing to mark superseded.
- **Dispatcher launch** (`launchSplit` / `fillParts`). Main is locked on origin/main's sha. Every part gets a branch
  `claude/<build>--r<n>-p<k>` from that sha, its own worktree, and its own agent slot with `--account` routing. The env
  carries `AXF_BUILD_ID`, `AXF_SPLIT_ID` and `AXF_PART_ID`.
- **Part status** (`builds-live.mjs part <split>/<part> waiting|building|testing|rebuilding|failed|done`) with a slot heartbeat.
- **Combine** (`combine.mjs`). All or nothing onto the locked base, into `claude/<build>` (`combining`). A clash or a
  part that failed for good fails the run: nothing lands and main unlocks.
- **Landing hand-off.** One PR, one CI run. The run follows ci → merging → merged → live → finished, and main
  unlocks at finished or failed.
- **Gate.** Rule `require-split-id` is on by default in the default gate rule set, and works with the server-gate
  build's rule rather than duplicating it. `claude-headless.sh` → `model-gate.mjs launch` refuses a start with no
  orchestrator build id or no valid split id (exit 3, with the reason). The refusal is a journalled `gate-rejection@1`
  record, and the build lands on the Failed tab with `gateReason`.
- **UI.** Pending: one row per build; **Splitting** with the animated split badge. Queue / Active: one expandable
  DataGrid row with the status rolled up from the parts (Building k/n … Finished). Expanded, each part shows its slot,
  branch, account, steps and a live badge (animated only while waiting, building, testing or rebuilding). Failed: the
  gate reason. Gate & rules: the rule with its description and switch. The views poll the orchestrator feed. Every look
  value comes from the badge assets and tokens.
- **Console control.** New address kind `part` (append-only, 14th): `row:<build>/part:<pN>`. The registry, schemas,
  fixture and spec were regenerated. The baked copies in console-web, amberx-droid, molly and axhub-web were synced and
  their lock hashes updated.

## How each feature is reached

| Feature | Deep link (control@1) | REST `/api/plugins/build-orchestrator/…` | MCP plugin command | CLI | Voice (AmberX) |
|---|---|---|---|---|---|
| Pending Splitting rows | `view:builds/tab:pending` | `GET pipeline` | `pipeline-status` | `pipeline.mjs status` | "open the pending tab" |
| A build's split row (expanded) | `row:<build>` (open expands it; state = status, run, badge, expanded) | `GET split/<build>` | `pipeline-split-show` | `pipeline.mjs split <id>` | "show the split of <build>" |
| One part | `row:<build>/part:<pN>` | `GET split/<build>` | `pipeline-split-show` | `pipeline.mjs split <id>` | "how are the parts of <build> doing" |
| Active run + main lock | — | `GET run/active` | `pipeline-run-status` | `pipeline.mjs run` | "what is building now" |
| Split / resplit | — | `POST pipeline/split`, `POST split/<build>/resplit` | `pipeline-split`, `pipeline-resplit` | `split <id> --request`, `resplit <id>` | "split <build>", "resplit <build>" |
| Cancel a run (needs confirm) | — | `POST run/<build>/cancel {confirm: true}` | `pipeline-cancel` | `cancel <id> --confirm` | "cancel the run of <build>" (says how to confirm) |
| Gate rule on / off | Gate & rules switch | `GET` / `PUT split-gate` | `pipeline-split-gate`, `pipeline-split-gate-set` | `split-gate [on\|off]` | "is the split gate on", "turn the split gate on/off" |

The console actions use the same ids (`build-orchestrator.run-status`, `.split-show:<build>`, `.split:<build>`,
`.resplit:<build>`, `.cancel-run:<build>|confirm`, `.split-gate[:on|off]`). AmberX matches phrases literally, so each
`{build}` phrase is spelled out for every build in Pending, the Queue and Active (`voice.json`).

## Tests: before → after

| Check | Before (main) | After |
|---|---|---|
| `framework/spec/check-build-split.mjs` | — (new) | 67 passed |
| `test/pipeline-split.test.mjs` | — (new) | 7 passed |
| `test/combine.test.mjs` | — (new) | 5 passed |
| `pipeline.test.mjs` | passed | 66 passed (the start of a `build-*` session with no build id is now refused by require-split-id first, into Failed) |
| `npx tsx framework/spec/check-console-control.mts` | 13 kinds | 296 checks, 14 kinds, 10 verbs |
| `test.mjs` / `test.py` (plugin) | passed | 35 / 58 passed |
| land-clash, launch-retry, resplit-dedupe, watchdog | passed | 6 / 5 / 8 / 14 passed |
| check-console-control, check-theme, check-controls, check-chrome-assets, check-toolbars | green | green |
| check-gate-rules, check-landing-line, check-done-means-merged, builds-store verify | green | 38 / 32 / 417 / ok |
| console-web `tsc --noEmit` | clean | clean |

CI: `combine.test.mjs` and `pipeline-split.test.mjs` were added to the plugin job. `check-build-split.mjs` was already in the spec job.

## UI Review

Item `r-20261118-81428f6f`, choice set `split-part-status`: 3 options as badge assets
(`plugins/build-orchestrator/assets/badge/split-part-status-pill|dot|icon.json`). Each option has shots of the Pending
Splitting row and the Queue row collapsed and expanded, on desktop and phone (`one-build-time-always-split-to-fill/shots/`).
These are predicted-look captures: the orchestrator's markup and classes with the real assets on the carbon-amber theme.
Pill is what is built now.

## Known gaps

- No Kotlin twin (build tooling; the `part` kind's twin is deferred with the rest of console-control in PORTING.md).
- `apps/console-web/scripts/console-control-parity.mjs` fails intermittently on this VPS (`fetch failed` on a different
  case each run, the same on clean main). This needs a look on a quieter runner and is not caused by this build.
- `framework/cli/builds-live.mjs` has a local, uncommitted pause of live pushes ("push storm", Nov 18) in this worktree.
  It was left as found and is not part of the PR.
