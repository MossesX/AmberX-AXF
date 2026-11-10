# Orchestrator: merge-first switch + Mergers / Builders counts; merges assigned like builds

Build `orchestrator-merge-first-switch-separate-merger` · Opus · branch `claude/orchestrator-merge-first-switch-separate-merger`

Brett (Nov 10 2026): "I need a switch in the orchestrator to set the number of mergers and the number of builders. It needs to assign merges to an employee just like builds. Put all my processing power towards merging."

## What changed (all in `apps/console-web/plugins/build-orchestrator/`)
- **Settings** (pipeline-settings@1): `mergeFirst` (default on), `mergers` 0-12 (default 12), `builders` 0-12 (default 12). Both kinds share the account slot pool.
- **Dispatcher plan** (`pipeline-core.mjs plan()`): with Merge first on, free slots go to waiting merge jobs before Queue builds; Mergers / Builders cap each kind. Waits say why (`every merger is busy`, `Builders is set to 0`, `merges go first`). Idle detection counts running merges.
- **Merge jobs** (merge-job@1 in the pipeline data dir, `merges.json`): a built build whose PR the merge queue flags (conflicts, red checks, kicked out) opens a job automatically; Brett can also give any built PR to a merger by hand. The dispatcher assigns it to a Claude account exactly like a build (same routing: subscriptions first, then API overflow), launches a headless Opus session in the build's worktree with a merge brief: rebase on main → fix conflicts → test → push. The merge queue lands it (nobody merges by hand). Session ends: exit 0 = done; otherwise retried up to maxRuns, then failed.
- **Stages + AmberX**: the session reports each stage (`pipeline.mjs merge-stage <build> rebase|conflicts|test|push|landing`); every stage, open, launch, end and failure posts an alert (`pipeline:merge:<build>`, notify type `pipeline.merge`, pushed to the phone).
- **Merge queue feed**: the console reads `axf.merge-queue@1` (capability service, no folder names) and hands the flagged PRs to the dispatcher (`merge-needs.json`) whenever the crew endpoint is read.
- **UI**: crew toolbar on every pipeline tab (Merge first switch, Mergers / Builders counts with fewer/more, "All on merging" = Merge first on, Mergers 12, Builders 0); new **Merging** tab (jobs, stage, account, why it waits, Cancel / Merge again); running merges also show on **Active**; "Merge it" on built cards with a PR.

## API (all four the same)
| Thing | REST | MCP (plugin command) | CLI | Voice / deep link |
|---|---|---|---|---|
| Read crew + jobs | `GET /api/plugins/build-orchestrator/pipeline/crew` | `pipeline-crew` | `pipeline.mjs merges` | "how are the merges going" → `pipeline-crew` |
| Set switch / counts | `POST …/pipeline/crew {mergeFirst, mergers, builders}` (also `POST …/pipeline/settings`) | `pipeline-crew-set` | `pipeline.mjs crew --merge-first on --mergers n --builders n` | "put everything on merging" |
| Give a PR to a merger | `POST …/pipeline/merge {id, reason?}` | `pipeline-merge` | `pipeline.mjs merge <build>` | action `build-orchestrator.merge:<build>` |
| Cancel a merge job | `POST …/pipeline/merge/cancel {id}` | `pipeline-merge-cancel` | `pipeline.mjs merge-cancel <build>` | — |
| Merging tab | `GET …/pipeline/tab/merging` | `pipeline-tab {name: merging}` | `pipeline.mjs tab merging` | `build-orchestrator.tab:merging` |

## Decisions (no one to ask)
- "Employee" = the Claude account the dispatcher assigns, the same unit builds go to.
- Defaults: Merge first **on**, Mergers 12, Builders 12. That gives merging every slot it can use while builds still run in what is left. I did not set Builders 0 on the live dispatcher: that would stop every build with no merge work waiting. "All on merging" does it in one tap (or `pipeline.mjs crew --builders 0`).
- "Move this build to the front of the queue": it was already running when this session started, so there was nothing to move.
- Merge sessions run on Opus (merge work isn't foundation work).

## Checks
- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 46 checks passed (4 new: settings, merge-first order, counts, merge job life cycle), CLI end to end included.
- `node apps/console-web/plugins/build-orchestrator/test.mjs` 33 passed; `test.py` 31 passed.
- `check-theme`, `check-controls`, `check-toolbars` pass; console-web `tsc --noEmit` clean.
- `plugin-lifecycle check build-orchestrator`: only stale-reference findings in untracked session files and `framework/cli/dispatch-gate.mjs` (already there before this build).

## Open
- UI Review: no desktop / phone shots yet. A headless session has no running console on this branch. The PR waits for them.
- The dispatcher on the VPS picks this up with the next console deploy.
