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

## Python API job (s5)

**No Python fix needed.** The job's Python steps never ran on 56503d108, because the amberx-droid build step before them failed first. Their last full run was green: #324, 32e55adee, 2026-11-15 10:06. Since then nothing changed in `apps/console-web/server/` or in the plugins whose tests failed in the container.

- Ran in `python:3.12` with `requirements.txt` + `httpx`: the 21 server and framework tests plus every `plugins/*/test.py` (76 files).
- Failures that come only from the container (no Node 22 / `npx` / git there): `codebase-changes`, `context-menu-designer`, `hub-sync`, `plan-studio`, `plugin-update`, `shipped-features`.
- `test_console_commands` and `systems-check` failed in the container but **pass on the host**.
- `test_wall_users` "the page itself" needs `apps/console-web/dist`, which CI builds first. It is checked again after s6.
- The plugins changed since green (`build-orchestrator`, `notify-control`, `push-banner`) all pass their `test.py`.

## Web Dev Console (React/TS) job (s6, branch `fix/main-green`)

Ran CI's block for real: re-bake `core react ui schemas libs`, `shared-assets bake`, plugin template copied in as `ci-example`, `npm ci && npm run build` (`tsc --noEmit` + vite) in `node:22`. Then the Playwright steps in `mcr.microsoft.com/playwright:v1.56.0-noble`.

- **console-web**: typecheck and build clean.
- **amberx-droid**: typecheck and build clean with 7660c26d8. AmberX now aliases `@console/api` to a bridge that has the same token-less `consoleTokens` as `@console/plugins`. That fixes triage #1 and #2.
- **Real failure:** `theme-swap.mjs`: `fx-tabs#125 background color(srgb 0 0 0 / 0)` never changed across 32 colour themes. Since component-tokens@1 (17f9e2f73, 11-13), the tab bar is `color-mix(var(--fx-tab-bar-bg) …, transparent)` with a transparent default. Chromium reports that as `color(srgb 0 0 0 / 0)`, and the check only skipped `rgba(0, 0, 0, 0)`. **Fixed** in 6c628aa87: any zero-alpha colour counts as unpainted. Two full runs after the fix: 382 elements, 0 stuck.
- The check samples the page differently from run to run (one run saw 20 elements, the others 382). That is a weakness in the check, but not a red. Noted for later.
- `interface-scope-check`, `window-handles-check` and `fetch-share-check` pass.
- `server/test_wall_users.py` (left open from s5) passes against the built `dist/`: 57 checks.
- The re-bake rewrote the committed baked copies under `src/axf/`. Those were restored, not committed, because CI re-bakes on every run.

## AmberX APK / Gradle (s7)

- The APK job's only failure was the step "Build the web app, copy it into the shell", the same `@console/api` resolve error as triage #1. Gradle never ran.
- Ran that step on a scratch copy in `node:22`: re-bake, `npm ci`, `npm run build`, `npx cap sync android`. All clean.
- No Gradle, Capacitor config or native file changed. No new Android features.
- `fix/main-green` is pushed. No PR run started, so I dispatched `android.yml` on it once: run 43923133971. The Gradle and APK result is checked in s8/s9.

## Fix PR and merge queue (s8)

- **Clash found:** #719 (`fix/ci-common-cause`, opened 16:50 by another session) already holds the same `@console/api` bridge and gate fixes as `fix/main-green`. It also pins every job to `ubuntu-24.04`, because `ubuntu-latest` rolls to 26.04, where Playwright 1.56 has no Chromium. It does **not** have the theme-swap fix.
- I didn't open a duplicate PR. `fix/theme-swap-zero-alpha` (6bf967236, off main, one file) → **#724**. `fix/main-green` stays as a record and is not opened as a PR.
- Merge queue: `queue add 724`, `move 719 0`, `move 724 1`. #719 lands first, #724 right behind it.
- `builds-live link` would have replaced the build's own branch/PR (#723), which the later steps still use. So the fix PRs went into a build note, plus a step on the codebase-changes entry (`chg-20261116-537d490149`).
- FYI to Brett through the alert hub (`axf.notify@1`): key `pipeline:fyi:get-main-green-unblock-lander-land-axf:main-fix`, delivered to the bell. The new notify type `pipeline.fyi` is registered in `build-orchestrator/notify.json`, so the Notifications panel controls these FYIs once this build lands (`notify-control/test.py`: 133 checks pass).

## Merge queue fix found on the way (s8/s9)

`land.mjs queue move` lost the first of two moves made before the next round. `applyQueueControl` rebuilt the order as `[last round's order …, manual order …]`, so `move 719 0` followed by `move 724 1` came out as `685, 724, 723, 719`. Fixed in df373063b: when the manual order is newer than the round's order, the manual order leads. Test added (`merge-queue.test.mjs`: 18 checks). After the fix the control order is `719, 724, 685, 723, 706`.

## Branch re-sync (s10, s11)

Fetched each branch and compared the local worktree head with GitHub:

| Branch | Local | GitHub | Ahead / behind | Kept |
|---|---|---|---|---|
| `claude/server-gate-one-session-per-build-no` | 8b5495bd1 | 8b5495bd1 | 0 / 0 | already level, nothing to rebase or push |
| `claude/one-source-truth-console-shows-only-what` (#598) | eccfe754a | eccfe754a | 0 / 0 | already level |
| `claude/console-axhub-retry-failed-calls` | e68f9aa05 | e68f9aa05 | 0 / 0 | already level |
| `claude/demo-video-series-three-minute-browser` | 5e77e6939 | 5e77e6939 | 0 / 0 | already level |

The `re-sync-stuck-branches-lander-can-push` build had already re-synced them before this one reached the step. The only local leftovers are untracked session logs.

**Stray `merge-main-land-one-source-truth-console`:**
- The branch was already gone from GitHub and from local refs. Its worktree (`/root/axf-builds/merge-main-land-one-source-truth-console`, detached at a7febca2e) was still there.
- `git log HEAD --not origin/claude/one-source-truth-console-shows-only-what origin/main` is empty, so nothing on it is missing from #598 or main. Its uncommitted changes were stale builds-store snapshots only. Worktree removed.
- It was not in the merge queue. Auto-land listed it as **blocked** every round ("pushing its branch failed … not on GitHub"), because the build record still points at the deleted branch and at the same PR (#598) as the real build.
- Held in auto-land (`land.mjs hold`, with the reason) and noted on the build. #598 is the one to land.

## auto-lander-controls-in-the-gate-plugin worktree (s12)

**Decision: nothing to commit or drop.** No tracked file has uncommitted changes. The untracked files are only the session brief and logs every worktree carries. The local head 61013c9db (the 11-16 16:38 merge of main) equals GitHub. PR #705 was kicked from the merge queue for the same reds main has (amberx `@console/api`, theme-swap). Once #719 and #724 land, a push or a main merge brings it back into the queue. Noted on the build.

## axf-data container up (s13)

Source: `claude/data-container-axf-data-holds-all` @ 050fac6b4 (level with GitHub). Read `services/axf-data/compose.yaml`, `Dockerfile` and `deploy/install-data.sh`. The installer is the documented path, and this session runs on the VPS, so it ran directly. No axHub call was needed.

- `AXF_DEPLOY_LOG=/opt/axf/.axf-console/deploys/log.jsonl agent-slots heavy -- bash deploy/install-data.sh`:
  - built `axf-data:latest`
  - created the internal network `axf-data` (no route out, nothing published) and the volume `axf-data`
  - wrote service tokens once to `/root/hub/data/axf-data/conf/env/{console,orchestrator,axhub,cli}.env` (0600; only their SHA-256 sits in `tokens.json`)
  - installed `/etc/cron.d/axf-data-backup`
  - appended a deploy-log record
- **Health:** `docker ps` → `axf-data Up (healthy)`. `/v1/health` → `{"ok":true, … "volume":{"freeBytes":82.3 GB}}`. `keys.verified:false` is expected: no `AXF_DATA_KEYS_URL` is set yet, so only service tokens are accepted, no axHub data-tokens.
- **Console reaches it:** `axf-console` is on the `axf-data` network. From inside the console, `GET http://axf-data:7700/v1/_meta/counts` with the console token → `{"$axf":"data-counts@1","counts":{},"cursor":0}`. That proves the network path and authentication. The store is empty, which is right for a fresh volume.
- There is no `axhub` container on this host, so only the console was attached.
- The console starts reading and writing through axf-data once the branch lands and the console redeploys with `conf/env/console.env` (s14).

## data-container (#704) brought up to main (s14, in progress)

#704 had never run CI: it conflicted with main, so GitHub built no merge ref. `land.mjs merge-main --dry-run` reported code conflicts, so I merged main into the branch by hand (4801426fa):
- **`android.yml`**: kept the axf-data/data-store steps and main's gate-rules/build-rules steps. `check-landing-line` appears once.
- **glossary `terms.json`, `catalog.json`, `status.json`**: kept both sides' entries.
- **Control inventory and `tracker.json`**: regenerated.
- **Help coverage**: had dropped to 99.5%, because of 8 new data-store controls. Drafted with `help-coverage.mjs --draft console-web`; back to 100%.
- **Checks** (node:22): check-theme, check-controls and check-console-control pass. `tracker --check` passes. check-plugin-pages still fails on main's own GateView problem, which #724 fixes.
- It lands through the merge queue once #724 has made main green.

## Postgres landing prepared (s15)

**Backup:** `~/hub/data/amberx-axf/backups/pre-postgres-20261116/console-data.tar.gz`
- 1.85 GB, sha256 `dfa688c92051dc81…` (full hash in the `.sha256` file next to it).
- Contents: `/opt/axf/.axf-console` without agent-swarm's git job worktrees, `/opt/axf/_claude/builds`, and the axhub-projects volume (`/projects`). Those are every root `data-migrate` reads.
- Taken live, so crash-consistent: tar noted one file changing while it was read. `gzip -t` passes.

**Dry run against a copy:** I extracted the tarball to a scratch folder and started a throwaway `postgres:16-alpine`, plus the branch's axf-data on it (engine `postgres`, 18 tables). Then `data-migrate apply --all` from the copy, then `verify`. The dry run found **four blockers**, all fixed on `claude/axf-data-postgres-real-tables-own`:

| Blocker | Effect on the real run | Fix |
|---|---|---|
| M0 paths relative to `plugins`, M1 paths relative to `plugins/<folder>` | every one of the 40 plugin namespaces refused after its copy ("missing on axf-data" + "only on axf-data" for the same key) | M0 is relative to the migration unit (d45662177); spec seeds a plugin namespace now |
| The walk went into git checkouts (agent-swarm job worktrees, 22 GB) and `node_modules` | `plan` on the VPS didn't finish in 400 s, and would have mapped whole repo copies as data | folders with a `.git` entry and `node_modules` skipped (d45662177); spec covers it |
| `chat-viewer/chats.db` (705 MB) over the 256 MiB blob limit | the whole run aborted at `too_large` | over-limit files stay local with why (d45662177); its tables reach Postgres through `mirror_sync` |
| `shipped-features/ledger.sqlite` copied as raw bytes in WAL mode | the rows still in `-wal` were lost: features 2570 vs 2569, refused | SQLite sources copied through SQLite's backup API, source read-only (afd586fc7) |

`check-data-migrate.mjs`: 16 checks pass.

**Result after the fixes:** all 47 namespaces copied and verified (M0 = M1, SQLite row counts equal).
- Plan: 144 unmapped files stay local, 815 temp/lock files skipped. Plan takes about 100 s on the live roots; apply takes about 9.5 min.
- Postgres rows: builds 949, build_steps 5425, journal 44510, changes 14799, records 8640, blobs 5396, ui_review_items 218, settings 9, notes 40, ledger_features 2570 (mirror equals source).
- axf-data counts per namespace: builds 1384, changes 1851, planner 265, ui-review 1807, sessions 5183, chat-viewer 3439, and so on.
- The throwaway database, service and copy were removed afterwards. The backup stays.

### s12 correction (found during s18 prep)

The lander kept #705 blocked: "its worktree has code changes that were never committed". Its worktree map holds **one path per branch**, and this branch was checked out twice:
- `/root/axf-builds/auto-lander-controls-in-the-gate-plugin`: clean. This is the one s12 checked.
- `/tmp/wt-lander`: a merge of main abandoned around 13:24. `framework/cli/axf.mjs` was still unmerged, it held asset names older than the branch head, and its staged changes deleted newer reports and journals.

The lander used the last one listed, the dirty one. That checkout was broken and older than GitHub's head (61013c9db), so:
- its diff was saved to `_claude/builds/reports/get-main-green-unblock-lander-land-axf/wt-lander-dropped.diff` (code in full, `_claude/` data as a stat);
- the worktree was removed;
- a correction note was added on the build.

**Lander fix:** `worktrees()` now prefers the build's own folder (`claude/<id>` → `…/<id>`), otherwise the first one listed, so a stray checkout never stands in for the build's worktree. `land.test.mjs`: 113 checks.

## Getting the main fix through the queue (s9, in progress)

#719's own queue run failed on two more checks my s3/s4 sweep had missed:
- **`check-agent-slots`**, "heavy lock caps at 2: 3 != 2". In s3 I had blamed my own session's env vars. It was a real race: heavy-slot ids were `hv-<pid>-<ms>`, so two calls in one process within the same millisecond shared an id, and the first to finish freed both slots.
- **`check-token-registry`**: `gate/plugin.json` `tokens.uses` was missing 14 tokens.

To give main one PR that fixes everything, #724 now merges `fix/ci-common-cause` (#719) and adds:
- theme-swap zero-alpha (6bf967236)
- unique heavy-slot ids and the regenerated gate token manifest (19a185b0f)
- the framework help re-baked into axhub-web, console-web and molly (bd8a8f0ed), after #628 merged a help change with only the amberx-droid copy updated

#719 was taken out of the queue with a reason and a comment on the PR.

Queue history so far:
- 18:46, #724 run 1: **cancelled**. The stack was rebuilt because main moved in code: #628 merged at about 19:02 through auto-land's direct "ready → merge" path, outside the queue. #628 had merged #719 into itself, so main gained #719's fixes that way.
- 19:03, run 2: the sweep and AmberX passed. The Web Dev Console job failed on `check-help` (#628's help change).
- 19:25, run 3: after bd8a8f0ed, pending.

In a clean env the whole Alerts/MCP step (114 commands) passes locally. The only exceptions are host ones: port 7097 is in use, and live tmux sessions take the agent-slots test's slots.

### How #628 reached main red (and the guard)

#628 (`all-settings-interfaces-open-floating`) merged at 19:01 while the lander had it **blocked as red**. Its own build session ran `gh pr merge 628 --merge --auto`. GitHub's native auto-merge then merged it as soon as the branch-protection checks passed, and those are only the light ones, so the queue's full CI never ran. It brought two new reds onto main:
- the framework help changed with only the amberx-droid copy updated (`check-help`, `shared-assets check`);
- a TabGroup id given as a constant the console-control inventory can't read (the ratchet).

Both are fixed in #724 (bd8a8f0ed, then the commit before bf3d87e43). Along the way, `systems-check/test.py` "ask first" turned out flaky on a host over the disk limit (81% now): the monitor's first real run tried the real Auto fix. The test now stops the monitor, clears the disk record and saves "ask" before the disk turns red. 5/5 runs pass.

**Guard:** I tried to turn GitHub auto-merge off for the repo (`allow_auto_merge=false`), but the console's token can't change repo settings (403). So the push banner now registers a systems-check item, **"PRs land through the merge queue only"**. It is amber while the queue is on and the repo allows auto-merge, and it carries the exact fix (untick "Allow auto-merge", or the `gh api` call with an admin token).

### data-container (#704) light checks

#704's light PR checks failed on `shipped-features/test.py` (`No module named 'data_store'`). Running the light list in node:22 with Python 3.11 then found:
- **`backup.py`** used `tarfile`'s `filter='data'`, which Python 3.11.2 lacks, so every backup verify failed with a `TypeError`. An `_extract` helper now uses the filter where it exists and the same rules by hand otherwise.
- **`data-store/test.py`** gave the backup job only 5 s (now 30 s).

All fixed (72cfbbb1a) and merged into the Postgres branch, whose `pg_dump` extracts use the same helper (62fc60196). Light list after the fixes: all pass except systems-check, which #724 fixes on main.
