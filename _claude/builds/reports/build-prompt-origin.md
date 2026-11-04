# What Brett said, on every build (`build-prompt-origin`)

Brett, Nov 3 2026 (voice), verbatim: "All the build entries, like wherever it shows a build in the build manager,
pending, all that, I need it to show the prompt, what I said, the verbatim prompt that kicked it off, that initiated it."

Profile `current`, Opus, one session, agent Janitor Joey (recorded on the build's origin as `by`; `agent-job.mjs assign`
does not exist on this base, so it is not booked on his card). Branch `claude/build-prompt-origin`.

## What changed

### s1 Data: build-origin@1 on every build record
- `framework/core/build-origin.mjs` (+ `.d.mts`): the record and its rules. `origin = { said, at, source
  (voice|chat|console|code), session, link, by, brief, verbatim, from (brief|detail|notes … when backfilled), addenda:
  [{said, at, source, by, verbatim}] }`. `normOrigin`, `mergeOrigin` (verbatim beats backfilled, empty fields filled,
  addenda unioned oldest first), `addAddendum`, `parseBrief`, `fromText`, `saidBlock`, `subtitle`, `originText`.
- Builds store (`framework/plan/builds-store-core.mjs`): `normBuild` keeps `origin` (left out when absent, so existing
  stores stay byte-stable); the orchestrator projection carries it and `absorbOrchestrator` merges instead of
  overwriting; pending items carry it both ways (`itemOfBuild`, `buildFromItem`, `absorbPending`).
- Merges never lose it: `builds-merge-core.mjs` `mergeBuild` unions origin from both copies (live publish, pull, git
  merge driver).
- Older code can't drop it either: `_claude/builds/origins.json` (build-origins@1) keeps every origin keyed by build id.
  `builds-store.mjs` heals records from it on every read and folds new ones in on every write; `builds-live.mjs`
  publishes it to main with the store and merges it on pull; `.gitattributes` routes it through the `axf-builds` driver.

### s2 Capture
- `deploy/claude-headless.sh` runs `framework/cli/build-origin.mjs capture --brief … --name … --by <agent>` before the
  slot: the brief's `## Brett said (verbatim)` block (optional `Source · At · Session · Link` meta line) becomes
  `origin.said`, `## Addendum N (Brett, <date> (<source>))` blocks become `addenda`, the whole brief is kept. Since
  axHub's `vps.build_start` writes the brief and calls this launcher, its builds are covered through the block. A brief
  without the block gets a one-line warning and its first announced quote (marked from the brief).
- Orchestrator `add` takes `said` / `origin`; MCP `pending_change(action="add", said=…)`; the Pending add form has a
  "What Brett said" field; Plan Studio *Turn into a build* takes `said` (and a plan's own `origin`).
- The orchestrator's phase brief now starts with his words.
- Rule: shared `RULES.md` ("Every build carries Brett's exact words") + `CLAUDE.md`; template
  `_claude/builds/BRIEF-TEMPLATE.md`; `_claude/builds/README.md` section.

### s3 UI
- `framework/react/components/BuildOrigin.tsx`: "What Brett said" quote block (speech bubble, source chip with icon,
  date/time, session link, "From the …, may be paraphrased" chip for backfilled words), the brief collapsed below it,
  then the addenda in order. `originSubtitle()` for collapsed rows. Styles in `framework/ui/axf.css` (tokens only).
- Shown at the top of the expanded build in: Build orchestrator (grid detail + cards), Builds page (Builds view detail;
  subtitle on every row; the Steps view's step detail shows the build's first line), Pending builds (every card),
  Build manager (row subtitle, block in the expanded row, search covers his words and addenda), UI Review item detail
  (through `<OriginFor build=…/>` + the console's `GET /api/builds/{id}/origin`).
- Not wired yet (the component and `OriginFor` / `OriginLine` are ready for them): the Build queue view (plan epics carry
  no origin), Build Breaker, What's New banner items, Crew rows, Session browser, PR rows.

### s4 Backfill
`build-origin.mjs backfill --apply` filled 136 builds (store rev at the time; live on main):
106 from the build's detail, 6 from notes, 17 from a brief file in `/root/axf-builds/<id>/.brief.md`, 1 from a brief's
verbatim block, 6 with only the brief text (no quote of Brett found). Everything taken from older text is marked
`verbatim: false` → shown "From the detail/notes/brief, may be paraphrased", unless the text itself said "verbatim".
His real words later replace backfilled ones (`set`); verbatim words are never replaced (an addendum instead).
129 open builds still have no words (`build-origin.mjs missing`).

### s5 Commands (zero tokens)
- CLI: `node framework/cli/build-origin.mjs get <id> | set <id> --said … | addendum <id> --said … | capture --brief f |
  backfill [--apply] | missing | block`, `--json` everywhere.
- REST on the build-orchestrator plugin: `GET /origin/{id}`, `POST /origin/{id}`, `POST /origin/{id}/addendum`, declared
  in its plugin.json `commands` → MCP `build-orchestrator_origin…` + `axf build-orchestrator origin…` (plugin-commands@1).
- Console core: `GET /api/builds/{id}/origin` (any view that only knows a build id).

## Tests
- New `framework/spec/check-build-origin.mjs`: 21 checks (parsing, merge, store projections, mergeBuild/mergeStores,
  CLI set/refuse/addendum/capture, sidecar heal after an old-code rewrite, backfill dry/apply, brief-folder backfill).
  Added to CI next to `check-builds-store.mjs`.
- `check-builds-store.mjs` 37/37, `builds-store.mjs verify` ok (289 records), build-manager test 128/128,
  `check-theme` ✓, `check-controls` ✓, console `tsc --noEmit` clean.
- Pre-existing, not from this build: `build-orchestrator/test.mjs` fails on store data (`kill-patches-pilot`) on clean
  HEAD too; `plan-studio/test.mjs` needs Node 22 (`.ts` imports) and this host has Node 20.

## Known gaps
- Views listed under s3 "Not wired yet".
- axHub's `vps.build_start` has no `origin.said` input of its own (axHub repo); the brief block carries it.
- Android twin of build-origin@1 deferred (Android on hold) — the record is plain JSON on the store.
- `claude-sync` holds `shared:rules/RULES.md` (changed on both sides before this build); the new rule is in the repo copy
  and reaches the hub once Brett picks which copy to keep.
