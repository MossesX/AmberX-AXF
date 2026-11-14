# full-voice-control-resolve-inventory (Opus, phase 1) — Nov 13 2026

Brett (Nov 13 2026 20:45): "land everything that's completed"

Branch `claude/full-voice-control-resolve-inventory`, PR #655 (supersedes #645 and #627).

## s1 — resolve inventory.json
- Started from `claude/full-voice-control-merge-main-and-land` (#645) and merged origin/main into it.
- The only conflict was `apps/console-web/src/control/inventory.json`, a generated file. I regenerated it with
  `node apps/console-web/scripts/control-inventory.mjs` (61 views, 16 nav, 22 tab groups, 76 tabs, 85 settings,
  230 functions, 62 buttons, 67 plugins). `--check` passes.
- I re-ran everything on the merged branch: `server/tests/test_console_control.py` passed 11/11, console-web
  `sync-data` showed no drift, `tsc --noEmit` passed, and check-console-control, check-theme, check-controls,
  check-toolbars and check-chrome-assets all passed.
- I did not push to main and did not update #645 from main (rules). The merge was made on this build's own branch
  and opened as #655, so the merge queue can land it.

## s2 — land everything that's completed
Dry runs of the merge queue (`push-banner/land/merge-queue.mjs list`) and of auto-land (`land.mjs run --dry-run`)
show why nothing reaches main:

- **The merge queue is empty.** About 50 PRs are open (#597–#655). None of them qualify: their checks are red,
  their checks have not run yet, or they are drafts. #648 was kicked out after breaking CI on top of main.
- **main CI itself is red** (Android framework + console, run 43496449155 on 240263ee9). Every PR tested on top of
  main inherits these failures:
  1. **Build engine sweep:** `check-profiles` fails because `_claude/builds/profiles/test-sandbox/` exists, but
     `test-sandbox` is a project (projects@1, `framework/cli/project-seed.mjs`), not a profile in
     `framework/plan/profiles.json`. The orchestrator keeps rewriting that folder, so deleting it won't hold.
     Fix: either `check-profiles` accepts project ids, or the orchestrator stops writing project state under the
     profiles folder.
  2. **AmberX Capacitor build:** `apps/amberx-droid/src/native.ts:596` passes `overlay` / `overlayCommand` /
     `overlayState` to `setVetoHost`, but the veto host type on main does not have those yet. The type change sits
     in an open overlay PR (#639 / #633). It passes locally only because the local `src/axf` copy is out of date.
  3. **Gradle kernel tests:** `ConformanceTest > theme variables match the reference engine` (ConformanceTest.kt:51).
     The theme fixtures and the Kotlin twin disagree.
  4. **Web Dev Console + Python API:** this also failed in that run. Its log names no single cause; re-check once
     1–3 are fixed.
- Auto-land (`land.mjs`) is **off** (`on: false`), and its item list is from Nov 4, so it is not what lands today's
  PRs. The merge queue (on) is.

Nothing more can land from this session without merging PRs or pushing to main, which this job may not do. Getting
main green is the one change that unblocks the queue. It needs its own build (a real code fix in three areas,
including Kotlin), so it is recorded here and in a build note rather than squeezed into this 10-minute step.

## s3 — wrap-up
- Report (this file), THREADS row, PR #655 linked to the build.
- No UI changes, so nothing goes to UI Review. How the voice and API control features are reached (REST, MCP, CLI,
  voice) is in the PR description, carried over from #645.
