# auto-land (Urgent, Opus) — Nov 3 2026

Brett (voice): finished builds land by themselves, **zero tokens for merging**. Reuse the push banner's merge path;
plain scripts only; an agent only when a merge truly needs judgement (a real code conflict, or red CI that needs a
code fix). Relaunch of the stopped `auto-land` run as `auto-land-2` (branch `claude/auto-land-2`). Agent: Earl the Ear.

## s0 — what already existed

- **Push banner auto-merge** (`apps/console-web/plugins/push-banner/server/__init__.py`, console server, every 3 min):
  opens a PR for every branch ahead of main, takes open PRs oldest first, pulls main in through GitHub's
  update-branch, waits for CI on the pinned head, respects UI Review (ui-review@1), merges at most one per round,
  sets branch protection where the token may. No model calls. This is the "batch merge" the pipeline reuses.
- **builds-live** (`framework/cli/builds-live.mjs`): a newer-wins merge driver for the builds files and `heal`
  (merge main into a branch whose only conflicts are builds files).
- **agent-swarm `batchMerge`**: merges a swarm build's jobs into the build's own branch (not PRs into main); not
  part of this path.
- **land-build job type** (`framework/assets/job-type/land-build.json`): an LLM agent that lands a branch. It stays,
  but is now called only for code conflicts and red CI.
- `vps.build_land`: lives on axHub (no code in this repo); not needed by the pipeline.

Why nothing landed by itself:
1. every builds store write goes to main as a `[skip ci]` commit, so every PR was **behind main again within
   minutes**; the banner pulled main in, CI restarted, and the PR never got to "0 behind + green";
2. GitHub's update-branch **conflicts on the builds store** (no merge driver on GitHub);
3. a PR whose only check was a **skipped CodeRabbit** run counted as "CI passed" (#265: no workflow ever ran on it);
4. **main CI was red** (three jobs), so every PR merged with main inherited the failures — fixed, PR #267;
5. claude-sync dropped hundreds of hub copies into finished worktrees.

**PR #265 (crew-retrain)** is not on main. The pipeline's dry run says why: UI Review item r-20261103-5e7f222e is
waiting, and merging main into it now conflicts in code (`apps/console-web/plugins/agent-swarm/jobs.mjs`,
`agent-swarm/test.mjs`, `deploy/claude-headless.sh`). Once this lands, the runner hands that conflict to an agent
(the one case it may) and pushes Brett one line; it merges by itself once he approves the screenshots.

## What was built

| Step | What |
|---|---|
| s1 pipeline | `push-banner/land/land-core.mjs` (pure rules) + `land/land.mjs` (host runner, cron every 3 min via `deploy/install-console.sh`, flock). Per finished build (status `built`, or every step done, with a branch), in dependency order: clean its worktree → merge main in a temporary worktree only when main moved in **code** (status-only commits don't count) or GitHub says it conflicts → push → open the PR → start CI (workflow_dispatch) when nothing ran on the head → write `land.json`. Conflicts: builds files newer-wins (builds-live driver, else main's), THREADS / STATUS / decisions / logs unioned (merge-file --union on real files, no process substitution: the land-everything incident), generated + hub data copies from main then regenerated; any code file aborts. Status commits stay `[skip ci]` and are never made by the runner. |
| s1 merge | Push banner: `_code_behind` (behind only by `[skip ci]` commits under `_claude/` = up to date), skipped/neutral check runs are not CI, finished builds' PRs first in `land.json` order, their main pull-ins left to the host, one merge per round as before. |
| s2 UI gate | UI Review stays the gate (setting **Wait for UI Review**, on): a held PR waits; the round after Brett approves, auto-merge merges it. Off: UI Review never holds a merge. |
| s3 claude-sync | `land.mjs` writes `.claude-sync-hold` in a finished worktree (gitignored); axHub PR **MossesX/axHub#36** makes claude-sync write nothing into such a checkout. Installed on the VPS ahead of the merge (old copy in `/root/archive/auto-land/`). Stray files at landing: synced data the build wrote is committed on its own branch; files identical to their hub copy are backed up to `/root/archive/auto-land/<build>/` and removed / put back; `.brief.md`, top-level `*.log` / `*.jsonl`, `.axf-*` skipped; uncommitted code stops the landing with a reason. Files changed in the last 10 min = the session may still be writing: wait. |
| s4 blocked | One reason per build in plain words (`held`, `code`, `conflict`, `push`, `pr`, `dependency`, `ci` with the failing checks, `ui`), shown on the PR in the banner instead of the generic one, and pushed to Brett once per (reason, head) as a console alert `land:<build>` (resolved when it lands). Only `conflict` and `ci` create an agent job (`agent-job.mjs land-build`, once per head; the router picks the agent). CI running / not started yet is a quiet wait. |
| s5 console | The console said 0 because overview / build queue / plan counted plan features and plan-epic steps only, and the console's profile (Angel) has orchestrator builds but no plan epics. `storeSummary()` (builds store core) rides on the `build-queue` and `plan` engine reads and the MCP `overview` / `build_queue` tools. New systems check **Console sees the builds** (red when Build manager entries are running with a fresh heartbeat and the console reads 0 builds). |
| s6 settings + commands | Settings → Plugins → Push banner → **Auto-land finished builds** (on) and **Wait for UI Review** (on), the list of finished builds with Land now / Hold / Release. Commands declared once in `land-core.mjs` `LAND_COMMANDS`: REST `GET /land`, `GET /land/blocked`, `POST /land/now|hold|release` (the server runs the same `land.mjs` command), MCP + console commands through plugin.json `commands` (plugin-commands@1), CLI `land.mjs list|blocked|now|hold|release`. |
| s7 tests | `land/land.test.mjs` (84 checks, CI step): **fails if anything in the merge pipeline imports or launches a model client**, the rules, and whole rounds on fake builds (real throwaway git origin + worktree, fake GitHub + console; CI and mergeable cached per head so a round costs about one GitHub call). Push banner `test.py` 150 → 167. `build-orchestrator/test.py` (new, 5). |

Not done as asked: Brett said "Settings > Builds". Plugin settings must live in their own plugin's tab (removable
plugins, no folder names across plugins), so the switches are on the push banner's tab next to Auto-merge.

## Also fixed on the way

- **Main CI red** (Build engine sweep, Web alerts step, Gradle kernel tests): `gen-fixtures.mts` imported
  `WIDGET_TYPES` / `WIDGET_TONES` from both the widget and chrome engines and the chrome ones won, so
  `widgets.json` carried the chrome engine's list; Molly's xLayout plugin had `"opens": false`. **PR #267.**

## Checks

`land.test.mjs` 87 ✓ · push-banner `test.py` 167 ✓ · `build-orchestrator/test.py` 5 ✓ · `test_upgrade.py` 12 ✓ ·
`test_mcp_tools.py` 139 ✓ · `check-builds-store` 37 ✓ · `check-build-steps` 44 ✓ · `check-plugin-commands` 57 ✓ ·
`check-help.mts` 228 ✓ · help coverage 100% · check-theme / check-controls / check-plugin-pages ✓ · console `tsc` ✓ ·
plugin lifecycle push-banner clean (apart from local gitignored files).

## Going live

Everything activates when this PR merges: the console's 5-minute update rebuilds the server (banner changes) and
re-runs `install-console.sh`, which installs the `axf-auto-land` cron. First round: `tail /var/log/axf-auto-land.log`;
`node apps/console-web/plugins/push-banner/land/land.mjs list` on the VPS.

Screenshots: `auto-land/shots/` (desktop + phone), in UI Review.
