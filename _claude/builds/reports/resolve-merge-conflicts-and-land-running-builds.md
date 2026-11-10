# resolve-merge-conflicts-and-land-running-builds (Opus) — Nov 10 2026

Brett: "When I tell you to do something, you do it till you get it right."

Two finished builds could not land because they clashed with main. Both are now merged with main, tested, and
pushed. A third problem was blocking every PR, and that is fixed too.

## 1. claude/running-builds-watchdog (PR #400) → 4c5939f03

Conflicts in build-orchestrator `pipeline-core.mjs`, `pipeline.mjs`, `server/__init__.py`, `web/pipeline.tsx`.
Main's code is the base. The watchdog is added back on top of it.

Kept from main: API overflow settings (`apiOverflow`, `apiAccounts`, Brett-click gate), the dispatcher self-check
(`selfcheck` CLI, alert, status fields), `accountsFrom`, `afterTick` hooks + shipped manifests, `request` / `setRoute`,
new imports (`dispatch-gate`, `shipped`, `build-priority`, `reap`, login `paths`).

Re-applied from the branch: `WATCHDOG_DEFAULTS` / limits / settings normalisation, the `watchdog` alert kind, the
in-tick `watchdogCheck` (stays before planning, so the plan sees what it fixed; main's `afterTick` hook runs after
launches and would act one tick late), `watchdog` in `tick()` and `status()` output, the `watchdog [check [--dry]]`
CLI, the dead-login check in `checkEnds` (`markLimit` import), watchdog keys in the server's settings whitelist, and
`Watchdog` type + `TextField` in the console line.

The automatic merge dropped `watchdog: watchdogView()` from `status()`, which would have hidden the console's watchdog
line. I put it back.

Tests: watchdog 25/25, pipeline 38/38, build-orchestrator 33/33, claude-workers 72/72, console-web `tsc` clean,
check-theme and check-controls pass.

## 2. claude/amberx-approvals-fix (PR #353) → aef84ced3

The "Merge with strategy ort failed" came from 305 untracked files in the build's worktree (hub-sync copies) that
main also tracks. I did not delete them. They were moved to `/root/axf-builds/_backup-amberx-approvals-fix-untracked`
(78 of the 91 listed were byte-identical to main). After that, 7 real conflicts were left.

Main already has its own in-place approve/decline, built separately: Java `approvalDecide` + `isDecision`, `deny.ts`
`decideFromPhone` with the AmberX server fallback, and the console's own review dialog. Main's versions win, and the
branch's versions of the same thing are dropped.

Re-applied from the branch: the watch alarm (`HubRules.watchDelayMs`, `feedFresh`; `WatchAlarm`, static `poll` were
already reconciled by the branch's earlier merge), `phoneHealth` / `phoneFix` (Java + `native.ts` + browser stubs),
the notification cleared after a native decision, `decidedReply` as a thin helper over main's `approvedReply` /
`declinedReply` (its unit test stays), and Deny / Approve-now for **held** calls in the console review dialog (main's
dialog only decided waiting approvals). `approvals-banner` 0.6.1. The AmberX test that pinned the old dialog text
now checks main's structure (`onDecide={decide}`, the held path, "Open on axHub").

Tests: amberx-droid 2331/2331 (tsx, as CI runs it), approvals-banner 18/18 + relay 58, console-web and amberx-droid
`tsc` clean, check-theme and check-controls pass. No JDK on the VPS, so the Java compiles in CI only (android.yml).

## 3. Why nothing could land: `builds-store verify` was red on main

Every PR's light check runs `node framework/cli/builds-store.mjs verify`. It failed on main, so no PR could pass.
There has been no green android.yml run in the last 60.

- `framework/plan/profiles/breakroom/` came back in f4ee124c1 ("shipped-features-fable: commit leftover work"), after
  the one-profile merge (8eb21fb69) had removed the old folders. The registry has only `all`. Removed on this branch.
- `framework/plan/pending.json` still has the old step lists for `orchestrator-gate`, `console-android-app-tabs`, and
  `owner-only-settings-brett-s-admin-console-login-counts-as-owner`. All three were re-split later in the store. The
  old step texts are now kept as notes on those builds (orchestrator `note`, live on main as 2e0ec7de7). Nothing is
  lost and pending.json is unchanged.

Result: `verify` → 14718 checks, everything from the old files is in the store.

## Landing

Both branches are pushed and their PRs are open. This session has no axHub token, so `vps.build_land` could not be
called from here. The merge queue lands them: once this build's PR is on main, the light check goes green for #400
and #353 as soon as main is pulled into them.

## Pre-existing, not from this build

- systems-check `test.py`: "ask first: red with its Auto fix offered" fails on main too. It reacts to the real disk.
- `plugin-lifecycle check approvals-banner`: stale references in `framework/spec/fixtures/shipped-manifest.json`, the
  same on main.
- The VPS disk was 100% full (12 MB free) at the start. I pruned the unused Docker build cache (8.8 GB), vacuumed the
  journal, and cleaned the apt cache, which left 6.8 GB free. 218 build worktrees under `/root/axf-builds` hold most of
  the disk. I did not delete them.

## API

This build adds no UI. Everything here is reachable through the existing CLI and API surfaces: `pipeline.mjs watchdog
[check]`, `GET /api/.../pipeline/watchdog`, pipeline settings, `approvals.view` / `approvals.review` console actions.
