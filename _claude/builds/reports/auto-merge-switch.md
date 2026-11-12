# Report: per-build Auto-merge switch + grouped merge banner (`auto-merge-switch`, Opus, Nov 12 2026)

Brett, Nov 11 2026 (voice): "I need to be able to set a switch for every build in the orchestrator if I want it to auto
merge on its own as soon as it's done … The merge banner needs to group those actions."

## What changed
- **builds@1**: every build carries `autoMerge` (false by default; existing builds read false), `autoMergeAt/By` (Brett
  answered) and `mergeApproval {by, at}` (his Merge). In the store normaliser and the orchestrator@1 projection, so every
  write path keeps them (`framework/plan/builds-store-core.mjs`, `web/orchestrator-core.mjs`).
- **Rules** (`build-orchestrator/auto-merge-core.mjs`, pure): gate, merge banner groups, decisions, Breakroom lines.
- **Off never lands**: the merge queue (push banner `land/merge-queue-core.mjs` `awaitsBrett`, same rule) keeps a finished
  build's PR out until Brett says Merge (or adds the PR back by hand). Green or not.
- **On lands only on green**: the PR joins the queue by itself; the queue merges main in, its one CI run is the test gate,
  green lands. Red or a clash kicks it out (existing behaviour) and now also fires the high-priority `merge.blocked`
  "Landing blocked" push (`land:<build>`), naming the build and what failed.
- **Turning it on and Merge are Brett's yes only**: his signed-in console click (server passes `AXF_APPROVER`), or an
  axHub approval. Sessions, agents and scripts may turn it off or Skip, never on or Merge (CLI + server + act all check).
- **Controls**: right-click "Auto-merge when done" (checkable, multi-select aware) on build rows in every orchestrator
  table (Pending, Queue, Active, Incomplete, Complete, Errors, Archive, All builds grid + list, Approvals); "Auto-merge"
  chip on the row; switch on the build card (pipeline tabs) and build detail (All builds); bulk toolbar Auto-merge on/off.
  API `POST /pipeline/auto-merge`, CLI `pipeline.mjs auto-merge <id…> on|off`, action `build-orchestrator.auto-merge:<ids>:on|off|toggle`,
  voice/MCP `control_act planner.builds <id> auto-merge {on}`.
- **Merge banner** (orchestrator plugin, banner `merge-banner`, order 4.85): Auto-merge? / Ready to merge (tests + clash) /
  Blocked / Merged (last 7 days, commit), each collapsible with a count, select-all and a group toolbar (auto-merge on/off,
  dismiss). Merge stays per build with a second-tap confirm. Hides when empty. `GET /merge-banner`,
  `POST /merge-banner/decide`, `POST /merge-banner/dismiss`.
- **Breakroom**: new capability `axf.group-chat@1` (agent-swarm, action `post-as`); merge results (landed, and auto-merge
  builds blocked) are posted once each as the build's owning employee (Boss when nobody on the roster owns it).

## Choices (no one to ask, headless)
- The "merge banner" did not exist as such; it is a new banner in the orchestrator plugin (the data is the orchestrator's;
  the push banner keeps its branch / PR list). Cross-plugin data only through `axf.merge-queue@1` and `axf.group-chat@1`.
- The merge-review branch (`claude/merge-review-one-by-one-every-built-but-unmerged`) and the main-gate branches are not on
  main yet, so nothing was merged from them. Ready to merge reuses the same three answers (merge / skip / rebuild) and the
  same rule as its `decide merge` (back into the merge queue); once both land, its `answer('merge')` should also set
  `mergeApproval` (one line) so the queue lets that PR in. The test gate is the merge queue's batch CI run on current main.
- Ask group = builds on their way (pending, queued, running, waiting, blocked) with no answer yet; finished builds go
  straight to Ready. Breakroom posts happen when the merge banner is read (the console polls it every minute).
- control@1 contract change (one act) done on Opus; it is additive and the control check passes (369 checks).

## Tests
- `auto-merge.test.mjs` 14 checks (off never lands, on lands only on green, red holds + banner, banner entry per new
  build, grouping moves entries, multi-select enable, Brett-only on / merge, CLI end to end on a scratch store).
- `test.py` +12 server checks (403 for a session turning it on or merging, approver reaches the CLI).
- agent-swarm `post-as` test; pipeline (45), orchestrator (33), merge queue (17), auto-land (92), token-control (21),
  push banner py (183), builds-store (40), builds-live (62), control@1 (369), tsc, theme / controls / toolbars / chrome.

## Open
- Kotlin twins deferred (framework/spec/PORTING.md). No AmberX merge-banner screen yet; blocked pushes reach the phone.
- UI Review: screenshots submitted for the merge banner and the orchestrator switch (see PR).
