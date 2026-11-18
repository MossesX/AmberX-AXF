# Build split: one build at a time, split to fill every slot

Since Nov 18 2026 (Brett; build `one-build-time-always-split-to-fill`, PR #846). The contract is `split-plan@1`:
`framework/spec/BUILD-SPLIT.md`, reference `framework/core/build-split.mjs`, fixture `framework/spec/fixtures/build-split.json`.
This page covers how it runs on the VPS and how to reach every part of it.

## What changed

- **One build at a time.** The dispatcher starts no other build while a run is active or main is locked
  (`main-lock@1` in the store's `meta`). This replaces the old rule of up to 4 unrelated builds side by side, one per slot.
- **Always split to fill.** On intake, `pipeline.mjs` sets every Pending or Queued build with no current plan to
  `splitting` (the Pending row reads **Splitting** with the animated split badge). The step splitter runs if the build
  has no steps, then the part planner plans as many parts as there are free agent slots. Parts never share a file. The
  plan and its split id (`<build>.r<n>`) go in the store and the build returns to the status it had. This replaces the
  old `orchestrator-auto-split-tab` path, which had no record in the builds store, so there was nothing to mark superseded.
- **Dispatch.** When a split build's turn comes, `launchSplit` locks main on origin/main's sha. Every part gets its own
  branch (`claude/<build>--r<n>-p<k>`) from that sha, its own worktree, and its own agent slot with `--account`
  routing. `AXF_BUILD_ID`, `AXF_SPLIT_ID` and `AXF_PART_ID` are set in the part's env.
- **Part status.** A part session reports `waiting | building | testing | rebuilding | failed | done` through
  `node framework/cli/builds-live.mjs part <split>/<part> <status> [--head sha] [--why "…"]`, with a slot heartbeat.
- **All or nothing.** When every part is done, `combine.mjs` merges the part branches onto the locked base, into the
  build branch `claude/<build>` (status `combining`). A clash, or any part failed for good (out of rebuilds), fails the
  whole run: nothing lands and main unlocks.
- **Landing.** The combine branch is one PR in the landing line with one CI run. The run state follows
  `ci → merging → merged → live → finished`. Main unlocks at `finished` or `failed`.
- **Gate.** Gate rule `require-split-id` (Gate & rules, on by default, `framework/core/gate-rules.mjs`) works with the
  server-gate build's rule set rather than duplicating it. `deploy/claude-headless.sh` → `model-gate.mjs launch` refuses
  any build start with no orchestrator build id or no valid split id (exit 3, with the reason). The refusal is written
  to the store (`gate-rejection@1`: who, when, reason, what was missing; journalled `gate:rejected`, by
  `framework/cli/split-gate-reject.mjs`) and the build shows on the orchestrator **Failed** tab with its gate reason.

## Where it shows

- **Pending:** one row per build. While it splits, the status is **Splitting** with the split badge
  (`plugins/build-orchestrator/assets/badge/split-splitting.json`; motion uses `--fx-motion` tokens).
- **Queue / Active:** a split build is ONE expandable DataGrid row. The main row shows the status rolled up from the
  parts (Queued, Building k/n, Combining, CI, Merging, Merged, Live, Finished, Failed). Expanded, it lists every part
  with its slot, branch, account, steps and a live badge (`split-part-status-pill|dot|icon`). The badge animates only
  while the part is waiting, building, testing or rebuilding. The views poll the orchestrator feed, so they change
  without a reload.
- **Gate & rules:** the `require-split-id` rule with its description and an on/off switch.

## How to reach it

| What | Deep link / control@1 | REST (`/api/plugins/build-orchestrator/…`) | MCP plugin command | CLI (`pipeline.mjs …`) | Voice (AmberX) |
|---|---|---|---|---|---|
| Pending tab (Splitting rows) | `view:builds/tab:pending` | `GET pipeline` (tabs) | `pipeline-status` | `status` | "open the pending tab" |
| A build's split | `row:<build>` (open expands it) | `GET split/<build>` | `pipeline-split-show` | `split <id>` | "show the split of <build>" |
| One part | `row:<build>/part:<pN>` | `GET split/<build>` (parts) | `pipeline-split-show` | `split <id>` | "how are the parts of <build> doing" |
| The active run + main lock | — | `GET run/active` | `pipeline-run-status` | `run` | "what is building now" |
| Split / re-split | — | `POST pipeline/split`, `POST split/<build>/resplit` | `pipeline-split`, `pipeline-resplit` | `split <id> --request`, `resplit <id>` | "split <build>", "resplit <build>" |
| Cancel a run (destructive) | — | `POST run/<build>/cancel {confirm: true}` | `pipeline-cancel` (confirm) | `cancel <id> --confirm` | "cancel the run of <build>" (says how to confirm; voice never confirms) |
| Gate rule | Gate & rules switch | `GET` / `PUT split-gate {enabled}` | `pipeline-split-gate`, `pipeline-split-gate-set` | `split-gate [on\|off]` | "is the split gate on", "turn the split gate on/off" |

Console actions with the same names: `build-orchestrator.run-status`, `.split-show:<build>`, `.split:<build>`,
`.resplit:<build>`, `.cancel-run:<build>|confirm`, `.split-gate[:on|off]`. Voice phrases are in
`plugins/build-orchestrator/voice.json`. A `{build}` phrase is spelled out for every build in Pending, the Queue and
Active, because AmberX matches phrases literally.

## Tests and checks

- `node framework/spec/check-build-split.mjs`: the contract (ids, planner, state machines, roll-up, all or nothing, migration)
- `node apps/console-web/plugins/build-orchestrator/test/pipeline-split.test.mjs`: intake auto-split, one at a time,
  part launches on a locked main, the gate into Failed, all or nothing, roll-up through finished, cancel
- `node apps/console-web/plugins/build-orchestrator/test/combine.test.mjs`: the git-level combine and the landing walk
- `node framework/spec/check-gate-rules.mjs`, `node framework/spec/check-landing-line.mjs`, `node framework/cli/builds-store.mjs verify`
- Console control: `node framework/cli/check-console-control.mjs`, `npx -y tsx framework/spec/check-console-control.mts`
  (the address kind `part` was added, append-only)

## Known gaps

- No Kotlin twin: this is build tooling (`framework/spec/PORTING.md`). The `part` address kind's twin is deferred
  along with the rest of console-control.
- `apps/console-web/scripts/console-control-parity.mjs` fails intermittently on a loaded VPS (`fetch failed` on a
  different case each run, the same on clean main), so it is unrelated to this build.
