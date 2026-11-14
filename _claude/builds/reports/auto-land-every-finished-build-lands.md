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

PR **#660**.

## What changed (push-banner plugin, `land/`, plain Node, no model calls)
| Step | Change |
|---|---|
| s1 | `autoLand` on by default. The Nov 4 off reads as on (`autoLandRev 2`). Per-build switch: `land.mjs off/on <build>`, `POST /land/off|on`. |
| s2 | `land/hook.mjs` (build-hook@1 listener): a finished build goes first in line and a round starts for it at once. After the main merge, settled JSON that doesn't parse takes main's copy (else the merge stops). |
| s3 | One serial landing line: `run` holds one lock (`--wait-lock` waits up to 15 min); `land.mjs serial -- <cmd>` for any other lander; `land.mjs lock`. Fetch / push that lose a ref lock are retried. |
| s4 | Clash or red tests → P0 "Merge main and land <build>" fix build via `POST /land/fix` → `axf.build-dispatch@1` (queued). Retried when the head moves or after 90 min (backing off). FYI alert (severity info) per attempt. The agent job stays as the fallback. |
| s5 | Running builds get origin/main merged into their own clean worktree every 30 min (2 a round). A session mid-edit is skipped; a code clash is aborted. |
| s6 | Sweeper every 10 min (`land.mjs sweep`): queue kick-outs get their fix build, builds stuck 30 min on push / PR / errors go first in line again, leftover `.tmp-*` files are cleared. |
| s7 | Banner chip "Landing: N · M stuck" → landing line (stuck first, with why and the fix build), Sweep now. Per-build Auto-land switch in Settings. |
| s8 | Deep link, help, catalog `cx.buildengine.autoland`. Also drafts the molly-guide tab help that held help coverage under its ratchet. |

## How each part is reached
| What | REST (`/api/plugins/push-banner`) | MCP | CLI (`land/land.mjs`) | Voice |
|---|---|---|---|---|
| Landing line + stuck | `GET /land/line` | `push_banner_land_line` (plugin-commands@1) | `line` | "what's stuck landing" → land-line |
| Every finished build | `GET /land`, `GET /land/blocked` | `push_banner_land_list/_blocked` | `list`, `blocked` | same commands |
| Per-build switch | `POST /land/off`, `/land/on` | `push_banner_land_off/_on` | `off <b>`, `on <b>` | same |
| Sweep now | `POST /land/sweep` | `push_banner_land_sweep` | `sweep` | same |
| Land now / hold / release | `POST /land/now|hold|release` | as before | as before | same |
| Global switch | `PUT /config {autoLand}` | – | – | Settings via console_control |
| Open it | `console_show` / `console_open` target `action:push-banner.land` (Builds menu → Landing line, Settings → Plugins → Push banner → Landing line, banner chip) | | | "open the landing line" |

## Tests
`land.test.mjs` 92 → 151 · `merge-queue.test.mjs` 18 · push-banner `test.py` 185 → 192 · build-orchestrator `test.py` 41 · check-plugin-commands · help-coverage --check · check-theme · check-controls · check-toolbars · plugin-lifecycle · ci-scope · console `tsc --noEmit`: all pass.

## Not done / needs Brett
- **UI Review screenshots of the Landing chip and the landing line are not submitted.** The live console runs main, so this branch's banner can't be captured until it deploys. To do in a follow-up.
- axHub `vps.build_land` (other repo) still pushes merges straight onto main. It should go through the queue, or at least `land.mjs serial --`.
- The live merge queue is in `stack` mode. `merge-queue.mjs settings --mode batch` lets PRs with stale red checks join behind the green ones.
- Nothing here takes effect until this PR lands and the console redeploys, and nothing passes the queue while main is red. The P0 main fix goes first.
