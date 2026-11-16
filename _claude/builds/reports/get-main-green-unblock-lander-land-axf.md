# Get main green, unblock the lander, land axf-data and Postgres

Build: `get-main-green-unblock-lander-land-axf` · Phase 1 (Opus) · status: **draft**

Brett said (2026-11-16 16:22):
> We gotta migrate to Postgres to get this going, finish the migration for Postgres. Is the auto-lander fixed?

## Triage list: red CI on main (s1, 2026-11-16)

The last completed CI run on `main` is red: run 43710482736 on 56503d108, 2026-11-15 11:45
(merge of `claude/console-look-becomes-default-axhub-skin`). Since then:

- 43718779704 (2026-11-15 13:23) and 43755167656 (2026-11-15 19:56, head 2cf47a634) were **cancelled** after 1–2 s with
  "Canceling since a higher priority waiting request for ci-refs/heads/main exists". They are not failures, but main has
  had no completed CI run since 11-15 11:45. The `ci-${{ github.ref }}` concurrency group only queues one pending run, so
  when merges land close together, a pending run gets replaced.
- Everything after 2cf47a634 on main is `[skip ci]` builds-live commits, so no new run started.

| # | Check (job) | First error line | Broken by |
|---|---|---|---|
| 1 | Web Dev Console (React/TS) + Python API, step "amberx-droid — re-bake the framework into it and build it" | `[vite]: Rollup failed to resolve import "@console/api" from "apps/console-web/plugins/wake-listener/web/flow.ts"` | c2cab438f (Wake listener s2, 2026-11-13; landed in #694 on 11-15 05:39). It only showed up at 56503d108, the first main run whose CI scope rebuilt amberx-droid. `apps/amberx-droid/vite.config.ts` aliases `@console/axf/*`, `@console/plugins`, `@console/pluginLifecycle`, `@console/watchLive`, `@console/changeBatch` and `@console/emptyState`, but not `@console/api`. |
| 2 | AmberX — web app in the Capacitor Android shell (APK + native unit tests), step "Build the web app, copy it into the shell" | same as #1 | same as #1 |
| 3 | Build engine sweep (Node) | passed on 56503d108 | — (check again locally in s3; recent branch dispatches fail on branch-only problems: help `entries[312].target` id, a walkthrough README `submit` without `--name`, a GateView page head with no description) |
| 4 | Gradle — framework modules, kernel tests, console APK | passed on 56503d108 | — |

Branch dispatches on 11-16 (`console-look-becomes-default-axhub-skin`, `demo-video-series-three-minute-browser`,
`console-android-app-thin-webview-wrapper`) all hit #1 too. Every open branch that merges main stays red until #1 is fixed.
That is why the auto-lander has nothing green to land.

## Disk-full damage check (s2, 2026-11-16)

Disk-full damage is **not** behind the red CI.

- `df -h /`: 387 G, 294 G used, **94 G free (76 %)**. Not low, so the builder cache was not pruned.
- `docker system df`: images 16.8 G (3.2 G reclaimable), volumes 2.7 G, build cache **78.5 G, of which 4.0 G is reclaimable** (401 of 428 entries active). Worth a prune when space gets tight, not now.
- `git fsck --connectivity-only`: **clean** (exit 0, no missing or broken objects). A full content fsck of the whole object store took more than 5 min and was stopped.
- Zero-byte tracked files (excluding `.gitkeep`/`__init__.py`): **none**.
- JSON under `_claude/builds/` and `framework/schemas/`: **all parse**.
- JSONL under `_claude/builds/`: `journal/2026-11-p7.jsonl` has **2 truncated lines**: line 461 (rev 4521, 2026-11-13, 2.2 MB, `pipeline:alias`) and line 1437 (rev 2960, 2026-11-10, 1.3 MB, `pipeline:plan`). Each stops mid-string, which looks like a cut-off write. The journal is append-only history, and every reader (`builds-store.mjs` `journalOf`, builds-live union) skips unparseable lines, so no check fails on them. The two revisions can't be recovered from `history`/`restore`. They are left as they are, because rewriting journal history would fight builds-live's union merge.

## Build engine sweep, reproduced locally (s3, branch `fix/main-green`)

All 75 single-line sweep commands were run with `AXF_DATA_DIR=off AXF_BUILD_PROFILE=all CI=true`. Results:

- **No data or fixture failures**: `validate --framework`, `tracker.mjs --check`, `check-build-steps`, `check-builds-store`, `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` and `check-skin-coverage` all pass on main.
- **Real failure:** `check-plugin-pages`: `apps/console-web/plugins/gate/web/GateView.tsx:36  page head has no one-sentence description`. It came in with the build-rules merge (2cf47a634, whose main run was cancelled, so CI never reported it). **Fixed** on `fix/main-green`: the page head now carries a `fx-muted` one-line description.
- **Not real, local environment only:**
  - `check-agent-slots`, `claude-token-save`, `session-checkin` failed only because this session's own env vars leaked in (dispatch token, Claude account `mossesx-max-`). All pass under `env -i`.
  - `shipped-features` (`node:sqlite`) and `claude-workers` need Node 22; the VPS has Node 20. Both pass in `node:22`.
  - `deploy/claude-login.test.mjs` has no change in `deploy/` since its last green CI run (56503d108).
- Side effect seen: running the sweep rewrites `framework/plan/{pending,build-queue,plan}.json`, `tracker.json` and `framework/catalog/libraries.json` (projections). Those were restored and not committed.

## Rest of the Build engine sweep (s4)

- Multi-line steps: `bash -n` on the deploy scripts is clean. Init of every template and boilerplate, `install browser`, `import-ui` and `validate` all pass (551 assets).
- **Real failure:** the plugin-lifecycle loop (`plugin-lifecycle.mjs check ui-review`) flagged two "stale references" in the gate plugin: `gate-store.mjs:91` and `web/RulesTab.tsx:20`. Both use `'ui-review'` as a **gate rule kind**, not the plugin. **Fixed** on `fix/main-green` with the check's own opt-out marker `axf-not-plugin:ui-review` on both lines. The gate's 21 tests still pass.
- `help-coverage --check`, `check-console-control`, the glossary checks and the ratchet baselines (`check-chrome-assets`) all pass.
- With both fixes, the whole local sweep is green except for the environment-only cases listed in s3.
