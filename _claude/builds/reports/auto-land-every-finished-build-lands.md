# Auto-land: every finished build lands itself immediately

**Brett said (Nov 13 2026, 20:44):** "I keep telling you over and over, stuff ends up thousands of commits behind; what's it
gonna take to get you to merge and land what's completed"

Build `auto-land-every-finished-build-lands`, branch `claude/auto-land-every-finished-build-lands`, Opus. Everything is in
the push banner plugin's `land/` runner (plain Node, no model calls) and its server; no shared schema or contract changed.

## What it takes (s9: the answer)

On Nov 13 at 20:48 the landing machinery was running every 3 minutes and landing nothing:

| Cause | What it did |
|---|---|
| **Auto-land was switched off** (`autoLand: false` since Nov 4, "Stop merging these things one at a time") | No finished build got main merged in, nobody fixed a clash, and blocked builds were never retried. 18 finished builds sat in `land.json`, some since Nov 3. |
| **Main's own CI is red** (`Build engine sweep (Node)` → `check-profiles.mjs`: `_claude/builds/profiles/test-sandbox/` is not a registered profile) | The merge queue tests every PR on top of main, so every PR "broke CI on top of main" and was kicked out. 14 kicked out, and nobody acted on the kick. |
| **Stale PR checks** | 27 PRs held for red PR checks and 24 whose checks never ran. In `stack` mode (the live setting) they never join the queue. |
| **Landings racing outside the queue** | 24 "Merge origin/main into claude/…" commits went straight onto main in 3 days, plus a revert. Two git processes updating `origin/main` at once is the "cannot lock ref" failure. |
| Leftover temp files | 264 zero-byte `*.tmp-*` files in the push banner data folder (rounds killed by the cron's `timeout 900` mid-write). |

What this build changes, so a finished build can't sit unlanded:

1. Auto-land is **on for every build**. The Nov 4 off is read as on (`autoLandRev 2`). Each build still has its own switch.
2. A build lands **the moment it finishes**: a build-hook@1 listener puts it first in line and starts a round for it.
3. **One serial landing line**. Each round holds one lock, and any other lander can join the line with `land.mjs serial -- <cmd>`. A fetch or push that loses a ref lock is retried.
4. A clash or red tests gets a **P0 "Merge main and land <build>" fix build**, queued through the orchestrator. It is retried until the build lands, with an FYI alert to Brett per attempt (information, not a question).
5. **Running builds get main merged in every 30 minutes**, so a build never falls far behind.
6. A **sweeper runs every 10 minutes**. A queue kick-out gets its fix build; a build stuck on a push, PR or failed round for 30 minutes goes first in line again; temp files are cleared.
7. The **Landing chip** shows "Landing: N · M stuck", and the landing line lists what's stuck and why.

Filed during this build: **`main-ci-red-test-sandbox-profile-export`** (P0, queued). It fixes main's red CI. Until that
lands, no PR can pass the queue's test on top of main, and that includes this one.

Still needs Brett:
- axHub's `vps.build_land` pushes branch merges straight onto main. Route it through the queue, or at least through
  `node apps/console-web/plugins/push-banner/land/land.mjs serial -- …`. That code lives in the axHub repo, not here.
- The live merge queue is in `stack` mode, where PRs with stale red PR checks never join. `batch` mode (the default since
  Nov 10) lets them join behind the green ones: `node apps/console-web/plugins/push-banner/land/merge-queue.mjs settings --mode batch`.
  With auto-land on, red heads also get fix builds, so either mode works once main is green.
