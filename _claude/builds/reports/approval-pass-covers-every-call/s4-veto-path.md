# s4: the veto path under a pass

Step s4 of `approval-pass-covers-every-call` (Nov 25 2026). Contract: `framework/spec/AXHUB-PASS.md` §2-3 (step s1).

## Where the change is

The veto countdown is the hub's, so the wiring is in the axHub repo:

- `MossesX/axHub`, branch `claude/approval-pass-covers-every-call--s4`, commit `9596e5c`, cut from axHub `main`.
  No PR was opened. It needs one (or to be folded into the build's axHub PR) before the hub behaves this way.
- This repo: the two log readers (`apps/console-web/src/hubPages/core.ts`, `apps/axhub-web/src/hub/core.ts`) show
  what a covered run skipped (`passSkippedLabel`, a "Skipped" row on the run's details).

## What the hub does now

- A `veto` call covered by an active pass never enters the held list: no countdown, no held job, no veto notice.
  It runs in the same request.
- The pass observation and the approvals-log entry carry `ranUnder` (the pass id) and `policySkipped`
  (`veto`, `confirm`, `always-approve`).
- A covered run that outlasts the sync window becomes a job stamped with `ranUnder` and `policySkipped` when the
  job is created, so a later save can't drop them.
- When the pass ends or is revoked the next call is back on the countdown.

## Choices

- The matcher is untouched (step s3). On axHub `main` a pass for everything already matched `vps.run`; a narrow
  pass naming `vps.run` still doesn't until s3's matcher lands, because `main` excludes shells from narrow passes.
- A call already counting down when a pass is granted keeps its countdown. The contract says a covered call never
  enters the held list; it doesn't say a pass releases what is already held, and releasing would take away the
  owner's chance to deny it.
- `always-approve` is named for an `explicitApproval` tool, or a destructive tool the policy holds at `confirm`.
  A destructive tool on an explicit `veto` policy (`vps.run`) is logged as `veto`.
- The earlier run of this step (axHub `e5973ee` on PR #48) used `skippedPolicy` / `explicit`. This one uses the
  pass@2 names, and PR #48 conflicts with axHub `main`.

## Checks

- axHub, Node 22 in Docker: 628 of 629 tests pass. The one failure, `packages/connectors/ssh/test/build-tools.test.ts`
  (`build_land` merge of `THREADS.md`), passes on the host (24 of 24) and doesn't touch this change.
- axHub `packages/core/test/passes.test.ts`: five new cases for the veto path (runs at once, every veto tool,
  countdown back after revoke or expiry, the job record, the skipped policy names).
- This repo: `npx tsx apps/console-web/src/hubPages/test.mjs`, 240 of 240.
