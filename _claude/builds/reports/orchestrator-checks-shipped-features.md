# Orchestrator checks Shipped features before splitting any job

Brett said (verbatim):

> when he get receives a job, he splits it up into steps. And when he does that, he needs to make sure he needs to check with the shipped features... he needs to make sure he's not doing something twice or fucking up something that's already been done and if it's gonna conflict with something or change something that's already built he's gonna let me know

## What changed

- **Check before every split** (`apps/console-web/plugins/build-orchestrator/pipeline-core.mjs`, `pipeline.mjs`). `splitBuild` reads the Shipped features ledger first, which is every landed build's shipped-manifest@1 in `_claude/builds/shipped/`:
  - `shippedContext()` picks up to 12 shipped builds related to the job (word similarity on title and Brett's words; the job's own build is left out). They go into the split prompt with their titles, Brett's words, landing date, PR and own files. Claude is told not to plan anything twice and not to redo or break shipped work. It flags any step that changes, removes or conflicts with a shipped feature (`"shipped":[{id,kind,why}]`), or answers `alreadyShipped` for the whole job.
  - `shippedCheck()` gives a verdict (shipped-check@1, `clear` or `needs-brett`). It combines Claude's flags with the orchestrator's own matching: a job title or step that matches a shipped build's title, or the same title and same words. Shared files are listed as `touches` but never hold a build on their own. Bookkeeping files such as THREADS, reports, the store and fixtures are ignored.
  - When the verdict is `needs-brett`, Brett gets an AmberX alert (`pipeline:shipped:<id>`, notify type `pipeline.shipped`, push, high). The alert lists each step and the shipped build it hits. The build does not start until he gives the go-ahead (`shipped-ack`): `plan()` makes it wait with the reason, and auto-queue skips it. The go-ahead is written into the build notes with who gave it and why.
  - Checks are stored in the pipeline's own data (`<pipeDir>/shipped-checks.json`), so no builds@1 or build-pipeline@1 contract changed.
- **Ledger complete** (`framework/cli/shipped.mjs`). The backfill now covers builds marked complete that have no commit, PR or merge date: older chat and console builds that failed before. Their finish time stands in as the landing time, marked inferred, and the store's `mergedAt` is never touched. The backfill ran: **319 manifests added, 331 total, all on main through builds-live**. The tick's `shipLanded` uses the same path, so every future landing gets a manifest.
- **Standing rule** added to the rules-brief seed (`framework/schemas/rules-briefs.json`): only the orchestrator launches builds, picks the model and account, owns Pending and the Queue and watches status. Voice and chat sessions only hand it requests. The hub's rules-briefs document overrides the seed; add the same line there if it already exists.

## API (all four the same)

- CLI: `pipeline.mjs shipped-check <id> [--run]`, `pipeline.mjs shipped-ack <id> [--why w]`. `status`/`show` rows carry `shipped: { verdict, line, holds, findings, touches, ackedBy }`.
- REST: `GET /pipeline/shipped-check?id=`, `POST /pipeline/shipped-check {id}` (re-check), `POST /pipeline/shipped-ack {id, why}`.
- MCP / plugin commands: `pipeline-shipped-check`, `pipeline-shipped-recheck`, `pipeline-shipped-ack`.
- Voice (AmberX): through the same plugin commands ("does the icon browser build touch anything shipped?", "go ahead with the icon browser build"). The alert itself says how to give the go-ahead.
- No UI change in this build. The wait reason shows in the existing Queue table.

## Tests

- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 50 checks passed (new: context, prompt block, parseSplit flags and alreadyShipped, verdict rules, plan wait and go-ahead, alert; end to end: split, flag, Queue wait, go-ahead, a second go-ahead refused).
- `node apps/console-web/plugins/build-orchestrator/test.mjs`: 33 checks passed.
- `node framework/spec/check-shipped-manifest.mjs`: 35 checks passed.
- Calibration on the real ledger (331 manifests): 0 holds across the 81 live Pending and Queue builds; 60/60 shipped builds re-filed as new jobs were caught as duplicates. An earlier rule held 6 spin-off builds that only share their parent's words; that rule was tightened.

## Still open

- `apps/console-web/plugins/shipped-features/test.mjs` needs Node 22 (`node:sqlite`). This host runs Node 20, so it was not run here. CI covers it.
- `plugin-lifecycle.mjs check build-orchestrator` reports only stale references that were already there (`framework/spec/check-build-limit.mjs` imports the plugin by path) plus local untracked worktree files.
- Builds split before this change have no check record. `shipped-check <id> --run` checks one on demand.
- No Kotlin or Android twin: this is plugin-side orchestration, not a framework engine.
