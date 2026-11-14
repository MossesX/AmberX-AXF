# Land batch: merge main into each finished build and land

Build `land-batch-merge-main-each-finished` (Brett, Nov 13 2026: "what else finished; land it").

## Notes: the resolver and the regenerate commands (s1)

`/opt/axf-batch/resolve.py` (vps.build_land's resolver) already hands over to the repo's copy,
`framework/cli/land-resolve.py`, read from the tree being merged (else `/opt/axf`). That script is driven by the
generated-files@1 manifest `framework/spec/generated-files.json`, the same list the merge queue reads
(`apps/console-web/plugins/push-banner/land/land-core.mjs`). A `regen` clash takes main's copy, reruns the generator
on the merged tree, stages its outputs, then runs the generator's check and the manifest's tests. Anything outside
the manifest that is not JSON / text is a real source clash: `UNRESOLVED: <files>`, exit 1, nothing committed.

| Generated file | Rule | Regenerate command | Check |
| --- | --- | --- | --- |
| `apps/<app>/axf.lock.json` (and `apps/<app>/src/axf/**`) | regen, generator `rebake` (optional) | `node framework/cli/rebake.mjs apply apps/<app>` | none; if rebake refuses (baked files edited in place) main's copy stands and the refusal is logged |
| `apps/console-web/src/control/inventory.json` | regen, generator `control-inventory` | `node apps/console-web/scripts/control-inventory.mjs` | `node apps/console-web/scripts/control-inventory.mjs --check` |
| `apps/<app>/src/assets/help/framework.json` (any baked help pack) | regen, generator `help-sync` | `node framework/cli/help-coverage.mjs --sync` | none |
| `framework/assets/help/*.json` (help source packs) | union-json | (no generator: both sides' keys, main wins a scalar) | |
| `framework/spec/fixtures/*.json` | regen, generator `fixtures` | `npx -y tsx framework/spec/gen-fixtures.mts` | `node framework/spec/check-project-fixtures.mjs` |
| `tracker.json` | regen, generator `tracker` | `node framework/cli/tracker.mjs` | `node framework/cli/tracker.mjs --check` |

Tests after any regen or union: `control-inventory.mjs --check`, `check-project-fixtures.mjs`.

Host repair before the batch (Nov 13, 23:5x): `/opt/axf/.git` had lost the objects behind 15 branch refs (the
four batch worktrees icon-map, per-instance-settings, token-registry, lander-regenerates among them; `git fetch` and
auto-gc failed with "bad object"). Every lost tip still matched GitHub, so nothing was lost; the objects were
fetched back into the store.

## The deployed resolver (s2)

- Repo copy: `deploy/axf-batch/resolve.py`, installed as `/opt/axf-batch/resolve.py` by `bash deploy/axf-batch/install.sh`
  (installed Nov 14, 00:0x; the previous host file is kept as `resolve.py.bak-2026-11-13-2358`).
- It holds no merge rules any more: the legacy JSON / text merge copy is gone. It runs
  `framework/cli/land-resolve.py` from the checkout being landed (cwd), else `$AXF_ROOT` (default `/opt/axf`), and
  with neither it exits 1 with `UNRESOLVED: no resolver …` instead of guessing.
- So a generated-file clash is regenerated from the merged sources and staged (rules above); a real source clash still
  stops with `UNRESOLVED: <files>`.

## Resolver check (s3)

`node framework/spec/check-land-resolve.mjs`: a scratch repo (its own `git init`, nothing shared with `/opt/axf`,
which was damaged at the time) with the deployed shim, the repo resolver and the real generated-files@1 file rules
(generators stubbed to write from the merged sources). Clash in `apps/console-web/axf.lock.json`,
`apps/console-web/src/control/inventory.json` and `apps/console-web/src/assets/help/framework.json`: all three
regenerated from both sides' sources and staged, exit 0. Source clash in `src/app.mjs`: exit 1,
`UNRESOLVED: src/app.mjs`, no generator run. Result: 13/13 ok.

## Branches (s4–s16)

Each branch is merged in a scratch worktree (`/tmp/lb-wt/<branch>`, detached at the pushed branch), so the build
sessions' own worktrees are untouched. Sweep, run with `AXF_DATA_DIR=off` (the repo copies, as CI reads them):
`axf validate --framework`, `tracker --check`, `check-theme`, `check-controls`, `check-toolbars`,
`check-project-fixtures`, `control-inventory --check`, plus the branch's extra checks and the tests of every plugin
it touches. Known on main, not caused by the merges: every baked app (console-web, axhub-web, …) is already
"edited" by `rebake status`, so the resolver keeps main's `axf.lock.json` instead of re-baking (by design); and the
host data copy of `framework/catalog/status.json` was missing `ui.opacity.surfaces` (fixed on the host, backup
`status.json.bak-lb`), which made a local `tracker --check` fail while CI passed.

| Step | Branch | PR | Merge | Sweep | Pushed |
| --- | --- | --- | --- | --- | --- |
| s4 | toolbar-widgets-attach-any-banner-style | #656 | 174 behind; clash in console-web `axf.lock.json`, `control/inventory.json`: inventory regenerated, lock = main's (rebake refused, edited app) | all green + check-banner-widgets | `e6255aa433` |
