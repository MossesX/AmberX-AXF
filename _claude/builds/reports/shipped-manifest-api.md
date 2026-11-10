# Shipped Features: orchestrator manifest + API

Brett said:

> Isn't it part of the pipeline? ... You put an API on it? ... The orchestrator should send a manifest with the information on the shipped feature. Including the prompt that created it and everything.

Branch `claude/shipped-manifest-api`, Opus, one session.

## Why builds went missing

- Shipped features hears only build-hook@1 events, fired by builds store writes. A build session writes the store in its
  own worktree; that change reaches the console checkout through builds-live (`adoptStore` on pull, `toConsole` on
  publish), and **neither fired hooks**. The orchestrator-only build sat at Planned for that reason.
- Builds started outside the store (direct `vps.build_start`) had no record at all.
- Fixed both: `adoptStore` and `toConsole` now emit the events of the builds they take (into the console's own outbox
  for `toConsole`), and every landed build gets a manifest whether or not the store had it.

## What was built

- **shipped-manifest@1** (`framework/core/shipped-manifest.mjs`, pure + `.d.mts`): build id/title, Brett's verbatim
  words (+ addenda) and the full brief, models, accounts, runs, steps with estimates and actual times, branch, PR,
  landed commit, the branch's own commits, files grouped by area, tests, UI Review items, cost and tokens, report,
  what is still open. Normaliser, field-named validation, `manifestFromBuild`, `toLedger`, summaries, JSON Schema.
- **Sender** (`framework/cli/shipped.mjs`): gathers from the store, git (landing commit for PR merges, first-parent
  merges and build_land fast-forwards), headless session events and meters, UI Review, the report and the worktree
  brief; writes the sidecar `_claude/builds/shipped/<build>.json` and puts a small `shipped` ref on the build through
  the builds store, so build-hook@1 fires the new `shipped` event. A build the store never had is created from its
  manifest. A build with open steps keeps its status; its manifest lists them.
- **Orchestrator**: an after-tick hook in `pipeline.mjs` ships every build that landed in the last 3 days and has no
  manifest (3 per tick, `AXF_SHIPPED=off` to stop).
- **Ledger**: migration 003 (`manifests`), `ledger/manifest.mjs` applies a manifest (features → Merged with commit, PR,
  files, model, report; his words kept, a paraphrase never replaces them; a build with no feature gets one), the
  `shipped` event handler, and `sync` applies any sidecar the ledger hasn't taken.
- **UI**: each entry shows the manifest: the prompt first and highlighted, then collapsible sections (brief, steps,
  models and accounts, branch / PR / commits, files and areas, tests, UI Review, cost and tokens, report, still open).
  Deep link `?shipped=<build or feature id>`; action `shipped-features.show <id>`.
- **API** (MCP, axHub, `axf control`, voice through plugin-commands@1): search, manifests, manifest, manifest-put,
  ship, link, backfill. Writes run the Node sender, so the builds store stays the one writer.
- **builds-live** publishes the sidecar of each build in a batch with its store change.
- **Backfill**: `node framework/cli/shipped.mjs backfill --since <date> [--dry]`.

## Backfilled tonight

- `urgent-amberx-veto-notice-alarm-too-loud-approve`: landed 661901740 (PR #397), commits 864ab0549 + 44862718a,
  18 files, 5 test lines pass, $5.05, 4 open.
- `one-way-to-start-builds-the-orchestrator-dispatc` (branch `orchestrator-only-launcher`): landed e15e52876,
  commit 8710fed63, 30 files, $9.62, s3 still open (UI Review shots / PR were left to build_land).
- Both are in the live ledger now (Merged, with their landed commits). The dry run since Nov 8 18:00 also lists
  `urgent-rebuild-pipeline-orchestrator-ids-splits-`, `workers-api-routing`, `brief-only-headless` and
  `amberx-notify-panel`; the tick ships the first three after this lands, `backfill` takes the fourth.
  `approve-button-fix` is refused: marked complete, but nothing shows what landed (its work went in through the rebase build).

## Tests

- `node framework/spec/check-shipped-manifest.mjs`: 35 checks pass (fixture, validation, landing in a scratch git repo, ship, backfill, tick, adoptStore hooks).
- `node framework/spec/check-build-hook.mjs`: 26 checks pass (new `shipped` cases; fixture regenerated, older outputs unchanged).
- `apps/console-web/plugins/shipped-features/test.mjs` (Node 22): 10 checks pass.
- `apps/console-web/plugins/shipped-features/test.py` (console container): 26 checks pass.
- check-feature-ledger 66, builds-store 40, builds-live 62, build-origin 21, builds-store lock 5, plugin commands 57 pass.
- build-orchestrator pipeline.test.mjs 35, test.mjs 33, test.py 31 pass.
- Console `tsc --noEmit` passes; check-theme, check-controls, check-toolbars, check-chrome-assets, check-plugin-pages, plugin-lifecycle pass.

## Still open

- UI Review: the manifest panel (desktop + phone) is waiting there for Brett.
- `help-coverage --check` is red on main as well (98.2%, claude-accounts help entry 17); this build adds no uncovered control.
- Contract written on Opus: shipped-manifest@1 is a schema, so it should get a Fable review like feature-ledger@1 did.
- Kotlin twin of shipped-manifest@1 deferred (PORTING.md).
- The check-build-hook stale-lock test was flaky (same-millisecond compare); `takeLock` now treats an age equal to the limit as stale.
