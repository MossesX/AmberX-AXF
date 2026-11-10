# Orchestrator checks each build against main right before queuing it (orchestrator-checks-each-build-against-main-righ)

Built Nov 10 2026 on Opus, branch `claude/orchestrator-checks-each-build-against-main-righ`. Brett: "Instead of checking
all the pending against main, just have the orchestrator check each one at a time before it puts it in the queue."

## What it does
No bulk audit. Right before the orchestrator moves a build from Pending into the Queue (`pipeline.mjs queue`, the console's
Queue button, auto-queue, `request --queue`), it checks that one build against main. The tick checks it again right before
dispatch (cached while main and the build's open steps are unchanged, so an unchanged build costs one `git rev-parse`).

| verdict | when | what happens |
| --- | --- | --- |
| done | every open step has evidence on main, or it landed with nothing open | every step ticked (each with its evidence in the step note), PR / commit linked, archived, **not queued**; AmberX alert `pipeline:main-check:<id>` |
| partial | some open steps have evidence | those steps ticked, a note says which and why, only what is left is queued (at dispatch: the launch waits one tick so the plan sees the new next step) |
| superseded | a landed build with the same title (Shipped features ledger or a complete build in the store), landed after this one was filed | archived with the reason, not queued; AmberX alert |
| open | nothing found | queued as before |
| unknown | main can't be read (no git, e.g. the console container) | queued as before; the dispatch check on the host catches it |

Evidence, plain code first:
- **Shipped features**: the build's own shipped-manifest@1 (its steps listed as done tick the same steps here).
- **Merged PR**: the build's PR number in a first-parent commit on main (`(#N)` / `pull request #N`), or `mergedAt`.
- **Its branch**: the branch head is on main with commits of its own; a step counts when every path it names was changed
  by that branch.
- **Files the steps would touch**: a step counts when every path it says it *creates* ("add / create / write / new x")
  was added on main after the build was filed. Paths a step only reads, reuses or changes are no evidence, and a
  `BRETT …` step is never ticked.
- **The wrap-up step** (tests / report / gates + PR / merge queue) is ticked once the build landed and nothing else is left.
- A merged PR or a landed branch alone never closes a build with open steps: multi-phase builds land phase 1 first.

AI only behind its switch: setting `mainCheck` = `code` (default) | `ai` | `off`. With `ai`, Claude (one tiny call, the
splitter's path) is asked only when code found nothing, and its answer counts only when it cites a commit that is on main.

## Every action, four ways
| what | REST | MCP / voice (plugin commands) | CLI |
| --- | --- | --- | --- |
| queue (checks first) | `POST /api/plugins/build-orchestrator/pipeline/queue {id}` → `mainCheck` in the answer | `pipeline-queue` | `pipeline.mjs queue <id> [--no-main-check]` |
| check one build now | `POST …/pipeline/main-check {id, apply?}` (dry unless `apply`) | `pipeline-main-check` | `pipeline.mjs main-check <id> [--apply]` |
| read every check | `GET …/pipeline/main-check`; also `GET …/pipeline` → `state.mainChecks` | `pipeline-main-checks` | `pipeline.mjs main-check` |
| switch code / ai / off | `POST …/pipeline/settings {mainCheck}` | `pipeline-settings-set` | `pipeline.mjs set mainCheck=ai` |

Deep link: the result shows on the build itself (notes, ticked steps, status), so the orchestrator's existing build links
open it. No new screen: no UI Review item.

## Dry run on the real store (157 Pending builds with steps, main at the time of the build)
- 4 already done, would be closed when queued: `banner-widgets` (PR #352), `ai-keys-console-store` (PR #358),
  `one-way-to-start-builds-the-orchestrator-dispatc` (shipped manifest), `urgent-approval-links-say-method-not-allowed` (PR #403).
- 1 partial: `github-app` (s1, its file changed by the landed branch).
- 152 open. An earlier, looser path rule ticked steps that only *referenced* a file; that is why the create-verb rule exists.
- About 0.5 s per build.
Nothing was applied by this session: the orchestrator closes them one at a time as they are queued, as asked.

## Store changes made here
- `audit-pending-fable-builds-against-main-close-wh` (the bulk audit) archived with a note: replaced by this build.
- `orchestrator-checks-shipped-features-before-spli`: note that its "never build twice" part is merged into this check.
  Still open there: the check at split time, the AmberX conflict notice and the ledger backfill.

## Files
- `apps/console-web/plugins/build-orchestrator/main-check-core.mjs` (pure verdicts), `main-check.mjs` (evidence + store write)
- `pipeline.mjs`: `mainCheck()`, `queue()` checks first, tick re-checks before launch, `main-check` CLI, `state.mainChecks`
- `pipeline-core.mjs`: `mainCheck` setting, `main-check` alert kind
- `server/__init__.py`, `plugin.json`: the routes and commands above
- `main-check.test.mjs` (in CI next to `pipeline.test.mjs`)

## Checks
- `node apps/console-web/plugins/build-orchestrator/main-check.test.mjs`: 25 passed (pure verdicts + end to end on a scratch store and scratch git main)
- `pipeline.test.mjs`: 42 passed · `test.mjs`: 33 passed · `framework/spec/check-plugin-commands.mjs`, `check-ci-scope.mjs`, `check-refs.mjs`: pass
- `plugin-lifecycle.mjs check build-orchestrator` fails on references that predate this build (`framework/cli/dispatch-gate.mjs`
  on main, plus untracked local `.axf-brief.md` / `.axf-focus.json`), none added here.

## Open
- Split-time check and conflict notice (the other build).
- The console container has no git: a queue from the console answers `unknown` and the dispatch check on the host decides.
