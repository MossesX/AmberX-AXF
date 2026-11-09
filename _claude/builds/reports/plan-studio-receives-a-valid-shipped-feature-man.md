# Plan Studio receives a valid shipped-feature manifest

Brett said:

> Make sure it creates the plant studio, make sure it gets all the, the correct information, the fields of the manifest are sent to the plant studio. So the plant studio's gotta receive a manifest too. It has to be valid.

Build `plan-studio-receives-a-valid-shipped-feature-man`, branch `claude/plan-studio-receives-a-valid-shipped-feature-man`, Fable, one session (s1). Follow-up to `shipped-manifest-api` (shipped-manifest@1).

## What was built

- **The same manifest reaches Plan Studio.** When the orchestrator ships a build (`framework/cli/shipped.mjs` writes the
  sidecar and puts the ref on the builds store record), build-hook@1 fires the `shipped` event. Plan Studio now listens
  (`plugin.json` → `buildHooks: build-hooks.mjs`), reads the same sidecar the Shipped features ledger reads, and
  receives it. No plugin folder is named anywhere: the hook bus is the only coupling.
- **Validation from the shared schema module, no copy.** `plans.mjs receiveManifest` runs
  `framework/core/shipped-manifest.mjs` `validateManifest` on the manifest as given (before normalising). A valid one is
  normalised and applied; an invalid one is **refused**: nothing is stored as the plan's manifest, the plan is **flagged**
  (`shippedProblem`: the field errors, when, from where) and the refusal is shown in the terminal (CLI exit 2 with the
  field lines, the build-hook delivery log, `plans.mjs shipped log`) and on the plan (a red flag box in the Shipped
  section, a red line on the plan row). A later valid manifest clears the flag. A manifest with no build id cannot be
  attached to anything and is refused outright.
- **The build's plan gets every field** (`web/plan-shipped.mjs applyManifest`, pure): plan id = build id (the way
  "Turn into a build" links them), created when missing (title, category `Builds > <category>`, priority, profile,
  `createdBy: orchestrator`). The whole normalised manifest is kept as `shipped`; the plan's own fields are filled from
  it: `origin` (Brett's verbatim words + addenda; a paraphrase never replaces verbatim words already on the plan),
  summary, steps (ticked by id or text, with `estimate`, `startedAt`, `actualMin`; manifest steps the plan lacks are
  added with their model and estimate), links (build, branch, PR, report), `build` (status complete, progress, branch,
  PR, landed commit, landed time, manifest id/rev/source), status (`done` when it landed with every step done; a landed
  build with open steps stays `building`), planned features → have on a complete landing, tag `shipped`, and `actual`
  (metered cost, tokens, actual minutes vs estimate, runs, models, accounts). Plan `cost` stays the estimate summed from
  the steps. Same manifest id + rev twice changes nothing (hook replays); a newer rev updates the plan and keeps its
  own edits (title, summary…).
- **Plan Studio UI**: a **Shipped** section on every plan (jump chip in the editor): the flag when refused; Brett's words
  first and highlighted (verbatim chip, or a warning when they came from the build detail), the landed / PR / branch
  header, a totals strip (steps, estimated vs actual minutes, files, tests, cost, open), then collapsible sections for
  the brief (Markdown), steps estimate vs actual, models / accounts / runs, branch / PR / commits, files by area, tests,
  UI Review, cost and tokens, report, still open. Plan rows show a green `shipped · landed <sha> · PR #n · $x actual`
  line (red when flagged). Tokens only; `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` pass.
- **API control (all four the same)**:
  - Deep links: `?plan=<plan or build id>` opens the plan; `?shipped=<build id>` opens it on its Shipped section (also
    after `#…?`). Console actions `plan-studio.show <id>` and `plan-studio.shipped <id>` (console_show / console_open,
    voice through AmberX).
  - REST (`/api/plugins/plan-studio/`): `POST shipped` ({manifest} or {build}), `GET shipped/{plan}` (the manifest a
    plan carries, its summary, actual cost, the flag), `POST shipped/backfill` ({since, dry}), `GET shipped-log`,
    `GET check-builds`; also as ops of `POST api`. All declared in `plugin.json` commands (plugin-commands@1), so they
    are MCP tools, `axf control` commands and voice commands with the same ids; `plugin-commands.mjs check plan-studio`
    passes (8 commands).
  - CLI: `plans.mjs shipped <build | file.json | ->`, `shipped backfill [--since d] [--dry]`, `shipped show <build>`,
    `shipped log [n]`, `check-builds` (exit 1 when a shipped build has no plan, an old rev, an invalid manifest or a
    plan that disagrees with it; flagged plans are warnings).
  - plans@1 capability: `shipped(manifest, by, source)` for other plugins' server parts.
- **Schema**: `schema/plan.schema.json` documents `shipped` (a `$ref` to the shipped-manifest schema), `shippedProblem`,
  `actual`, `origin`, and the new `build` fields. Help entries for the Shipped section and its collapsibles.

## Backfilled tonight (hub plan store, `/projects/amberx-axf/_data/plan-studio`)

`plans.mjs shipped backfill`: 10 manifests → 10 plans (6 updated, 4 created: urgent-amberx-veto-notice-alarm-too-loud-approve,
amberx-voice-echo-fix, multi-account-headless-workers, merge-profiles-one). `plans.mjs check-builds` on the hub: green
(10 shipped manifests, 10 plans carry one). Builds that land from now on arrive through the hook once this lands and
the console updates; until then `shipped backfill` takes them.

## Tests

- `npx -y tsx apps/console-web/plugins/plan-studio/test.mjs`: 28 checks pass (was 25). New: the pure mapping (every
  field on the plan, verbatim words kept, steps ticked / added, features → have, same rev no change, stale rev, newer
  rev, flag + clear, no build id refused), and the store: the hook listener on the `shipped` event creates the matching
  plan (and ignores other events / a missing sidecar), replay changes nothing, `shipped-get`, an invalid manifest refused
  through the API and the CLI (exit 2, reasons in the terminal) with the plan flagged, the receipt log, `check-builds`
  green → red on a plan-less sidecar → green after backfill, a landed build with an open step stays building, a newer
  rev keeps the plan's own edits.
- `python3 apps/console-web/plugins/plan-studio/test.py`: 28 server checks pass (was 15): the five routes, refusal with
  field errors, the flag, 404s and 400s, plans@1 `shipped`.
- Console `tsc --noEmit` passes. `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`,
  `plugin-lifecycle.mjs check plan-studio`, `plugin-commands.mjs check plan-studio` pass.

## Still open

- UI Review: the Shipped section (desktop + phone) is waiting there for Brett.
- The live console takes the hook only after this lands and `axf-console-update` runs; the backfill above covers
  tonight's builds meanwhile.
- `help-coverage --check` is red on main already (claude-accounts entry); this build adds help entries for its own
  controls.
- No Kotlin twin: the mapping is plugin code (web/plan-shipped.mjs), not a framework engine; AmberX loads the plugin's
  web code unchanged.
