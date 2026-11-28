# Plan Studio receives a valid shipped-feature manifest

Brett said:

> Make sure it creates the plant studio, make sure it gets all the, the correct information, the fields of the manifest are sent to the plant studio. So the plant studio's gotta receive a manifest too. It has to be valid.

Build `plan-studio-receives-a-valid-shipped-feature-man`, branch `claude/plan-studio-receives-a-valid-shipped-feature-man`.
Follow-up to `shipped-manifest-api` (shipped-manifest@1).

## Attempt 2: rebuilt on Plan Studio 2.0

The first attempt (PR #404) was built on Plan Studio 1.0 (`apps/console-web/plugins/plan-studio`). While it waited,
main removed 1.0 (commit `644dfa4d7`, "Plan Studio 2.0 is the one Plan Studio"), so #404 was closed and could never
land. This attempt does the same job on Plan Studio 2.0 (`plan-studio-2`), following 2.0's rule from Brett
(Nov 16 2026): "I don't want anything synced with Plan Studio". So:

- **Only a plan that was sent from Plan Studio receives a manifest.** The build's `planRef` in the builds store names
  the plan item. A build that no plan sent is never written into the tree; asking for one is a 404 / `not_found`.
  1.0 created a plan for every shipped build, but 2.0 starts empty and stays that way.

## What was built

- **The plan receives the same manifest Shipped features gets.** When a build ships, `framework/cli/shipped.mjs` writes
  the sidecar and puts the `shipped` ref on the build record. build-hook@1 fires `shipped`, and Plan Studio 2.0's
  `build-hook.mjs` runs `sync`. `tree.mjs receivePending` finds each sent build whose ref the plan does not have yet,
  reads the sidecar and hands it to the plan. Every read runs the same sync, so a missed event fixes itself on the
  next read.
- **Validation from the shared module, no copy** (`shipped.mjs receive`, pure). It runs
  `framework/core/shipped-manifest.mjs validateManifest` on the manifest as given.
  - **Valid:** the normalised manifest is stored on the item as `shipped`, every field. The item gets a `shipped` link
    to the build and a `url` link to the PR, and is marked done when it landed with every step done.
  - **Invalid:** refused. Nothing of it is stored as the plan's manifest; a valid one already there stays. The item
    is flagged with `shippedProblem` (plan-shipped-problem@1: the field errors, when, from where, id, rev). A later
    valid manifest clears the flag.
  - **Idempotent:** the same id and rev again changes nothing, and an older rev is ignored.
- **A copy is a new plan:** duplicate and import drop `shipped` / `shippedProblem` (tree-core `unshipped`).
- **Every surface, the same answer:**
  - REST: `POST /api/plugins/plan-studio-2/shipped` ({build} | {manifest}, optional {id}; 400 with the field errors
    when refused), `GET shipped/{id}` (item id, words or build id), `GET shipped-log`, `GET check-shipped`.
  - plugin-commands@1: `shipped`, `shipped-get`, `shipped-log`, `check-shipped`. These become MCP tools, `axf control`
    commands and voice commands with the same ids.
  - CLI: `tree.mjs shipped <build | file.json | -> [--item]` (exit 2 with the field lines when refused),
    `shipped-show <item> | --build <b>`, `shipped-log [n]`, `check-shipped` (exit 1 on any problem).
  - Receipts go to `shipped-receipts.jsonl` beside the tree.
- **UI** (`web/shipped.tsx`, tokens only): every plan that has a manifest or a refusal gets a Shipped box in both the
  editor and the sent-plan editor.
  - Contents: Brett's words first (verbatim or paraphrased chip), then the landed commit, PR, branch and time, a totals
    line (steps, estimated vs actual minutes, files, tests, cost, models, still open), and collapsible Steps, Files,
    Tests, Still open and Brief.
  - A refused manifest shows as a danger note listing every field error.
  - Tree rows carry a `shipped` (green) or `refused` (red) chip.
  - Help entries for both.

## Tests

- `node apps/console-web/plugins/plan-studio-2/shipped.test.mjs` (new, in CI): 8 checks.
  - Pure: every field stored, the links, done, survives normalize; same rev, stale rev, newer rev; refused with its
    field errors, flagged, the valid one kept, the flag cleared; copies drop the manifest; check-shipped.
  - End to end on scratch stores: send a plan → the build lands → `shipped.mjs ship` → build-hook@1 delivers `shipped`
    → the tree file carries the sidecar manifest field for field, valid. Then shipped-show, a no-op re-receive,
    check-shipped green and the receipt log.
  - An invalid file refused at the CLI (exit 2, `said.text` and `landedCommit` named) and the plan flagged;
    check-shipped red, then green once the valid one comes back.
  - A build no plan sent never reaches the tree.
- `server/test_orchestrate.py`: 25 checks (was 20). The routes refuse an invalid manifest with 400 and the fields named,
  `shipped/{build}` finds the plan, a valid one clears the flag, a build no plan sent is a 404, and check-shipped and
  the log answer.
- `test.mjs` 19, `live.test.mjs` 18, `toolbar.test.mjs` pass. Console `tsc --noEmit` passes. `check-theme`,
  `check-toolbars`, `check-chrome-assets`, `check-console-control`, `help-coverage --check`,
  `plugin-commands.mjs check plan-studio-2` and `plugin-lifecycle.mjs check plan-studio-2` pass.

## Still open

- Plans already sent and landed before this lands pick up their manifest on the next read of Plan Studio 2.0, once the
  console runs this code (sync receives every shipped ref a plan has not taken).
- No Kotlin twin: this is plugin code, not a framework engine. AmberX loads the plugin's web code unchanged.
