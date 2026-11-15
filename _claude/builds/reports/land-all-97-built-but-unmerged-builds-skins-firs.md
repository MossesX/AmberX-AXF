# land-all-97-built-but-unmerged-builds-skins-firs: land every built PR, skins first

Build `land-all-97-built-but-unmerged-builds-skins-firs`, Phase 1 (Opus), Nov 10 2026.
Brett (Nov 10 2026, 20:43): "Let's merge all that shit. Merge them all. Start with the skins and the skin stuff."

## How landing works now

The repo has its own merge queue (push-banner `land/merge-queue.mjs`, every 3 minutes on the VPS). It takes every
open PR whose PR checks are green, that isn't a draft and isn't waiting in UI Review. It tests each one on top of
main and merges the green ones. This session used the queue instead of merging by hand: it made PRs mergeable, got
their checks green and set the queue order. The standing rule (no hand merges, the queue lands everything) and
Brett's "merge them all" both hold that way.

## Why nothing has landed since Nov 7

Main is red, so every PR's light checks are red and the queue has had nothing it could take:

| Main failure | Cause | Fix |
|---|---|---|
| `check-profiles`, `builds-store verify` (light checks on every PR) | the retired `framework/plan/profiles/breakroom/` folder came back on main | #455 (deletes it, store skips retired profiles) |
| `menu-reach` (console job) | shipped-features, glossary-index, demo-designer and book-builder pages reported unknown | #455 |
| help coverage | claude-accounts help entry kind | already fixed on main (`card`); #455's conflict resolved to main's value |
| Kotlin `AppearanceConformanceTest` (Gradle job) | the Kotlin twin's never-a-slot list was only `uac-policy`; the TS engine also excludes `help`, `appearance-package`, `skin` | added to #455 (`AppearanceEngine.NEVER` matches `APPEARANCE_NEVER`) |

**#455 is first in the queue** (`merge-queue.mjs move 455 0`). Once it lands main is green. PRs whose checks went
red only because of main need one fresh check run after that (a push or a re-run). The queue then takes them.

## Skins and appearance (batch 1)

| PR | What | Done here | State |
|---|---|---|---|
| #409 | Skins restyle everything | main merged in; the only conflict was `build-manager.css`, a plugin #450 retired, so the delete wins | pushed; lands after #455 |
| #429 | Colour theme switches inside the active skin | main merged in, no conflicts (its checks had never run) | pushed; lands after #455 |
| #355 | Three layouts per screen | main merged in: CI step, CLAUDE.md, RULES.md, PORTING.md and gen-fixtures kept both sides; lock files re-baked; seven screens that reached main before the check (listeners ×2, demonstration-designer, glossary-index ×3, notify-control) added to `screen-layouts-baseline.json` | pushed; lands after #455 |
| #376 | designer@1 UI asset designer | main merged in: designer + embed types kept with main's demonstration/book/clip/docs types (TS order matches `asset-types.json`, which the Kotlin registry reads); validators, index, build engine and CI steps kept both sides; fixtures regenerated (Node 22), apps re-baked | pushed; local light run green except main's breakroom failure |
| #430 | Appearance = skins only | not touched: a draft, Phase 1 of a multi-phase build (Phase 2 still to run on the branch) | waits for its build |
| #472, #469 | Skins only theme-manager removal; Molly flagship skin | drafts, their builds are running right now | wait for their builds |
| #446, #466 | Skins as packages; Skin checker | screenshots waiting for Brett in UI Review (the queue holds them until he approves) | waits for Brett |
| #377 | Icon Browser + Icon Manager | draft, Phase 2 still to come | waits for its build |

## Closed (superseded)

- **#432, #440** Split builds pages: superseded by #450 (merged Nov 10), which retired the Build manager.
- **#269** Builds page, one page six views: superseded by #450. The orchestrator is the only builds page.

## Found, not fixed

- `framework/spec/fixtures/skin.json` on main is stale: regenerating on a clean main flips `uac-policy`'s
  `covered` from true to false. No check fails on it today; whoever next changes skin coverage regenerates it.
- #456, #457, #459 (merge queue batching, owned by build `resolve-conflicts-and-land-460-456-457-459-342`) are
  being tested on top of the red main and will likely be kicked out until #455 lands.

## Left for the next phase

About 85 PRs are still open. Most are red only because main is red. Order once #455 is on main:
1. one fresh check run on every open non-draft PR (no conflicts → the queue takes it within minutes);
2. PRs the queue kicked out with a code conflict (#411, #379, #378, #374, #373, #372, #371, #362, #347): main
   merged in by hand, keeping both sides;
3. PRs kicked out for a real CI failure on top of main (#441, #369, #363, #360, #349): fix and push.

No UI changed in this phase, so there is nothing for UI Review and no new API surface.
