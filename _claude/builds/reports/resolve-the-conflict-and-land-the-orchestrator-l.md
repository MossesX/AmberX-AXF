# resolve-the-conflict-and-land-the-orchestrator-l

Brett (2026-11-10 04:30): "Why is the queue in categories again? Didn't we change that?"

## Answer
The change was built (build `build-statuses-tell-the-truth-orchestrator-list`, PR #423) but never landed.
PR #423 conflicted with main (main had since gained the dispatcher self-check / stale reaper in
`pipeline.mjs`), so the merge queue could not take it. Main still has the old orchestrator list,
which always groups by category.

## What this build does
- Merges `claude/build-statuses-tell-the-truth-orchestrator-list` onto main in this branch and resolves
  the two conflicts:
  - `pipeline.mjs`: `tick()` returns both `corrected` (reconcileRunning, from the branch) and
    `selfCheck` (from main); the `tick` CLI line prints both.
  - `pipeline.test.mjs`: keeps main's self-check and stale-reaper e2e tests and the branch's truth test.
- Done from a fresh branch on main instead of updating PR #423 from main or pushing to main (merge queue rule).
  PR #423 can be closed as superseded once this lands.

## After it lands
- Orchestrator Builds tab: root rows by default (no categories); Group by (category / status / priority /
  account) is optional and remembered (`orch-group`); deep link `?group=`.
- Builds page: No grouping by default (`builds-group`).
- API: `GET /truth[/<id>]`, plugin commands `build-truth` / `build-truth-one`, CLI `orchestrator.mjs truth`.

## Checks
- pipeline.test.mjs: 41 passed; build-orchestrator test.mjs: 35 passed; check-builds-store: 40 passed.
- `tsc --noEmit` (console-web): clean. check-theme, check-controls: pass.
- Live console not verified yet: it shows main, which gets this only after the merge queue lands it.
