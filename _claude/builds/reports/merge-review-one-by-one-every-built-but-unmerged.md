# Merge review, one by one (`merge-review-one-by-one-every-built-but-unmerged`)

Brett (Nov 11 2026): "I gotta make sure nothing that's built or that I've written gets overwritten or broken from one of those old branches. Go one by one and I'll tell you to merge it or not."

## What it does
`apps/console-web/plugins/build-orchestrator/merge-review.mjs` (rules: `merge-review-core.mjs`, tests: `merge-review.test.mjs`). Plain Node + git, no model calls. Supersedes the land-all-97 auto landing.

- **scan**: every build in status `built`, oldest first, one per branch. Per build, against current main, scratch only (`git merge-tree`, no worktree or ref touched): commits ahead/behind, patches not yet on main (`git cherry`), code files changed (store/log/THREADS bookkeeping counted apart), files main also changed since the fork (overlap) with the newer main commits that touched them, **lines main added since the fork that the merged result would drop** (overwritten / reverted newer code), files git cannot merge (generated `axf.lock.json` listed apart: the landing tools regenerate it), PR state (open / closed / merged) and PR CI.
- **verdict** (ranks, never decides): gone, landed, closed, conflict, reverts, red, overlap, clean, with advice merge / skip / rebuild.
- **test**: main + the branch merged with conflicts resolved toward main (`-X ours`), in a throwaway worktree, light checks (`ci-scope.mjs light --run`) in the heavy slot. Runs for the build being presented (`next --test`).
- **pause**: every reviewed PR is held out of the merge queue (`merge-queue-control.json` removed, reason "Merge review: waiting for Brett") and auto-land (`land-control.json` hold); `land-all-97-built-but-unmerged-builds-skins-firs` set to blocked with a note. The merge queue setting itself is left on: fresh builds made on current main still land.
- **next**: the oldest undecided build goes out as one console alert (key `merge-review:<build>`, link to Builds) that pushes to AmberX through the new notify type `merge-review.next` (Notifications panel, priority high).
- **decide** (Brett only, `--by` recorded): merge → its PR goes back into the merge queue, which lands it (this tool never merges); skip → build archived, PR stays held; rebuild → build queued again with a note to start from current main and keep every newer change. The REST route presents the next build right after.

## How each part is reached (API)
| Action | REST (`/api/plugins/build-orchestrator`) | MCP (plugin commands) | CLI | Voice (AmberX) |
|---|---|---|---|---|
| List + summary | `GET /merge-review` | `merge-review-list` | `merge-review.mjs list` / `summary` | "where is the merge review" |
| One build's findings | `GET /merge-review/{build}` | `merge-review-show` | `merge-review.mjs show <build>` | via the command |
| Present next | `POST /merge-review/next` | `merge-review-next` | `merge-review.mjs next [--test]` | "next merge review" |
| Answer | `POST /merge-review/decide {build, decision, why?}` | `merge-review-decide` | `merge-review.mjs decide <build> merge\|skip\|rebuild --by <who>` | "merge it" / "skip it" / "rebuild it" |

The card is the console alert (bell + AmberX push, deep link `view:builds`). No new screen: no UI code, so no UI Review shots.

## First run (Nov 11 2026, main `0c264baaf`)
113 branches (117 built builds; some share a branch). 110 PRs held; land-all-97 blocked. Card 1/113 (#195 session-history) sent to console + AmberX.

| Risk | Count |
|---|---|
| conflict (code files git can't merge with main) | 57 |
| red (PR CI red, or fails current main's checks) | 37 |
| overlap (merges cleanly, touches files main changed) | 7 |
| clean | 6 |
| closed (PR closed unmerged) | 3 |
| landed (already on main) | 2 |
| reverts (would drop newer lines) | 1 |

Most conflicts sit in the build orchestrator pipeline (`pipeline.mjs` 18, `web/pipeline.tsx` 15), the retired build-manager UI and `_claude/rules/RULES.md`: those branches predate the Nov 10 orchestrator/build-manager rework (#450). Many red CI results date from when main itself was red (fixed in #455); the per-card test on current main is the one to trust.

Card 1, #195 session-history: merges cleanly, but its CSS fails current main's theme check (26 problems), so the advice is rebuild.

## Full list (oldest first)
| # | Build | PR | Built | Risk | Advice | Why |
|---|---|---|---|---|---|---|
| 1 | `session-history` | #195 | 2026-11-03 | red | rebuild | Merges cleanly but fails current main's checks (node framework/cli/check-theme.mjs). |
| 2 | `builds-one-page` | #269 | 2026-11-03 | closed | skip | Its PR was closed without merging (superseded or dropped). |
| 3 | `md-studio` | #271 | 2026-11-03 | landed | skip | Its PR is already merged. |
| 4 | `smart-menus` | #281 | 2026-11-03 | conflict | rebuild | 23 file(s) conflict with main: CLAUDE.md, _claude/shared/rules/RULES.md, apps/console-web/src/axf/core/index.ts, apps/console-web/src/axf/core/runtime.ts. |
| 5 | `plugin-settings-placement` | #329 | 2026-11-03 | conflict | rebuild | 63 file(s) conflict with main: apps/amberx-droid/src/axf/core/engines/console-commands.d.mts, apps/amberx-droid/src/axf/core/engines/console-commands.mjs, apps/amberx-droid/src/axf/libs/settings/index.tsx, apps/amberx-droid/src/axf/react/AppShell.tsx. |
| 6 | `requests-ledger` | #310 | 2026-11-04 | conflict | rebuild | 7 file(s) conflict with main: apps/console-web/plugins/build-breaker/web/ui.tsx, apps/console-web/server/mcp_server.py, changes/2026/11/chg-20261104-5b88419cc3.json, changes/2026/11/chg-20261104-61aaa7618a.json. |
| 7 | `bugs-board` | #311 | 2026-11-04 | conflict | rebuild | 8 file(s) conflict with main: .github/workflows/android.yml, apps/console-web/plugins/README.md, apps/console-web/server/mcp_server.py, changes/2026/11/chg-20261104-532511d5c1.json. |
| 8 | `follow-amber-switch` | #312 | 2026-11-04 | conflict | rebuild | 25 file(s) conflict with main: apps/amberx-droid/src/axf/react/components/Banner.tsx, apps/amberx-droid/src/axf/react/components/BannerStrip.tsx, apps/axhub-web/src/axf/react/components/Banner.tsx, apps/axhub-web/src/axf/react/components/BannerStrip.tsx. |
| 9 | `crew-profiles` | #315 | 2026-11-04 | conflict | rebuild | 8 file(s) conflict with main: _claude/rules/RULES.md, apps/console-web/plugins/agent-manager/web/views.tsx, apps/console-web/plugins/agent-swarm/agents/roster.json, apps/console-web/plugins/agent-swarm/test.mjs. |
| 10 | `profile-lists-home-card` | #318 | 2026-11-04 | conflict | rebuild | 2 file(s) conflict with main: apps/console-web/plugins/builds-page/server/__init__.py, apps/console-web/plugins/builds-page/web/ui.tsx. |
| 11 | `console-wake-finish` | #317 | 2026-11-04 | conflict | rebuild | 7 file(s) conflict with main: apps/console-web/plugins/console-commands/server/__init__.py, apps/console-web/plugins/follow-amber/server/__init__.py, changes/2026/11/chg-20261104-5d61647dc1.json, changes/2026/11/chg-20261104-61aaa7618a.json. |
| 12 | `apps-control-surface` | #322 | 2026-11-04 | conflict | rebuild | 18 file(s) conflict with main: apps/amberx-droid/src/axf/core/engines/console-commands.d.mts, apps/amberx-droid/src/axf/core/engines/console-commands.mjs, apps/console-web/plugins/console-commands/console.mjs, apps/console-web/plugins/console-commands/server/__init__.py. |
| 13 | `jump-menu-asset` | #326 | 2026-11-04 | conflict | rebuild | 9 file(s) conflict with main: apps/console-web/plugins/plan-studio/web/editor.tsx, apps/console-web/src/axf/core/types.ts, apps/console-web/src/axf/react/AppShell.tsx, changes/2026/11/chg-20261104-28b54dcf8c.json. |
| 14 | `molly-multi-instance-tabs` | #328 | 2026-11-04 | conflict | rebuild | 16 file(s) conflict with main: _claude/rules/RULES.md, apps/console-web/src/axf/core/runtime.ts, apps/molly/src/axf/core/runtime.ts, changes/2026/11/chg-20261104-288dd226d9.json. |
| 15 | `app-voice-commands` | #323 | 2026-11-04 | conflict | rebuild | 11 file(s) conflict with main: .github/workflows/android.yml, _claude/rules/RULES.md, apps/console-web/src/axf/core/index.ts, apps/console-web/src/axf/core/types.ts. |
| 16 | `live-sessions-plugin` | #331 | 2026-11-04 | conflict | rebuild | 1 file(s) conflict with main: apps/console-web/server/Dockerfile. |
| 17 | `model-thinking-audit` | #334 | 2026-11-04 | conflict | rebuild | 22 file(s) conflict with main: _claude/rules/RULES.md, apps/console-web/plugins/build-manager/server/__init__.py, apps/console-web/plugins/build-manager/web/merge.d.mts, apps/console-web/plugins/build-manager/web/merge.mjs. |
| 18 | `amberx-live-audio` | #335 | 2026-11-04 | conflict | rebuild | 1 file(s) conflict with main: apps/console-web/server/Dockerfile. |
| 19 | `fable-packager` | #336 | 2026-11-04 | conflict | rebuild | 8 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/help.json, apps/console-web/plugins/build-orchestrator/plugin.json, apps/console-web/plugins/build-orchestrator/test.py, apps/console-web/plugins/build-orchestrator/web/index.tsx. |
| 20 | `readme-rule-every-build` | #337 | 2026-11-04 | conflict | rebuild | 5 file(s) conflict with main: .github/workflows/android.yml, apps/console-web/plugins/build-manager/test.mjs, apps/console-web/plugins/build-manager/web/orchestrate.mjs, apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs. |
| 21 | `handoff-2` | #338 | 2026-11-04 | conflict | rebuild | 19 file(s) conflict with main: CLAUDE.md, _claude/rules/RULES.md, apps/console-web/plugins/agent-swarm/web/chat.tsx, apps/console-web/plugins/build-orchestrator/plugin.json. |
| 22 | `grid-column-hiding` | #340 | 2026-11-04 | conflict | rebuild | 5 file(s) conflict with main: .github/workflows/android.yml, apps/console-web/plugins/build-manager/web/ui.tsx, apps/console-web/plugins/changes-grid/web/index.tsx, apps/console-web/plugins/systems-check/help.json. |
| 23 | `build-optimizer` | #342 | 2026-11-04 | overlap | merge | Merges cleanly; 1 file(s) also changed on main since (framework/cli/builds-store.mjs). |
| 24 | `drag-to-tab` | #344 | 2026-11-04 | conflict | rebuild | 24 file(s) conflict with main: apps/amberx-droid/src/axf/assets/help/framework-drafts.json, apps/axhub-web/src/axf/assets/help/framework-drafts.json, apps/console-web/src/axf/assets/help/framework-drafts.json, apps/molly/src/axf/assets/help/framework-drafts.json. |
| 25 | `follow-amber-flash` | #345 | 2026-11-04 | conflict | rebuild | 3 file(s) conflict with main: apps/console-web/plugins/follow-amber/web/check.mts, apps/console-web/plugins/follow-amber/web/index.tsx, framework/spec/PORTING.md. |
| 26 | `build-docs-walkthroughs` | #346 | 2026-11-04 | conflict | rebuild | 2 file(s) conflict with main: apps/console-web/plugins/README.md, apps/console-web/plugins/build-manager/web/ui.tsx. |
| 27 | `changes-chat-log` | #347 | 2026-11-04 | conflict | rebuild | 9 file(s) conflict with main: apps/console-web/plugins/build-manager/help.json, apps/console-web/plugins/build-manager/web/build-manager.css, apps/console-web/plugins/build-manager/web/index.tsx, apps/console-web/plugins/build-manager/web/store.ts. |
| 28 | `notes-views` | #349 | 2026-11-04 | overlap | merge | Merges cleanly; 11 file(s) also changed on main since (.github/workflows/android.yml, apps/amberx-droid/src/axf/assets/help/framework.json, apps/axhub-web/src/axf/assets/help/framework.json). |
| 29 | `three-layouts-per-screen` | #355 | 2026-11-05 | overlap | merge | Merges cleanly; 1 file(s) also changed on main since (.github/workflows/android.yml). |
| 30 | `headless-session-efficiency-shared-chain-control` | #362 | 2026-11-06 | conflict | rebuild | 11 file(s) conflict with main: _claude/memory/docs/chain-control.md, _claude/rules/RULES.md, apps/console-web/plugins/build-orchestrator/orchestrator.mjs, apps/console-web/plugins/claude-settings/plugin.json. |
| 31 | `notes-tasks-sync` | #363 | 2026-11-06 | conflict | rebuild | 2 file(s) conflict with main: apps/amberx-droid/src/plugins/voice/web/index.tsx, apps/console-web/plugins/ui-review/help.json. |
| 32 | `ui-registry-shortcuts` | #369 | 2026-11-06 | conflict | rebuild | 13 file(s) conflict with main: .github/workflows/android.yml, apps/amberx-droid/src/axf/core/types.ts, apps/axhub-web/src/axf/core/types.ts, apps/console-web/src/axf/core/index.ts. |
| 33 | `settings-sections-everywhere` | #372 | 2026-11-07 | conflict | rebuild | 21 file(s) conflict with main: _claude/rules/RULES.md, apps/amberx-droid/src/axf/assets/help/framework-drafts.json, apps/amberx-droid/src/axf/libs/settings/index.tsx, apps/amberx-droid/src/plugins/companion/web/index.tsx. |
| 34 | `plan-studio-backfill-12h` | #373 | 2026-11-07 | conflict | rebuild | 2 file(s) conflict with main: CLAUDE.md, _claude/rules/RULES.md. |
| 35 | `dataset-bar` | #380 | 2026-11-07 | conflict | rebuild | 9 file(s) conflict with main: apps/amberx-droid/src/axf/core/types.ts, apps/axhub-web/src/axf/core/types.ts, apps/console-web/src/axf/core/types.ts, apps/molly/src/axf/core/types.ts. |
| 36 | `ui-asset-designer` | #376 | 2026-11-07 | overlap | merge | Merges cleanly; 1 file(s) also changed on main since (.github/workflows/android.yml). |
| 37 | `profiles-all-finish` |  | 2026-11-07 | landed | skip | Every change is already on main. |
| 38 | `plan-blueprints` |  | 2026-11-07 | clean | merge | Merges cleanly; main has not touched its files since. |
| 39 | `blueprint-notes-tasks` |  | 2026-11-07 | overlap | merge | Merges cleanly; 6 file(s) also changed on main since (_claude/memory/decisions.md, apps/amberx-droid/test.mjs, apps/expenses/_claude/README.md). |
| 40 | `full-api-control` | #393 | 2026-11-07 | conflict | rebuild | 7 file(s) conflict with main: _claude/rules/RULES.md, apps/console-web/plugins/build-manager/test.mjs, apps/console-web/plugins/build-manager/web/orchestrate.mjs, apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs. |
| 41 | `glossary-walkthrough-generator-investor-demos` | #385 | 2026-11-08 | reverts | rebuild | Would drop 19 newer line(s) in apps/console-web/plugins/glossary-index/plugin.json, apps/console-web/plugins/glossary-index/web/index.tsx, apps/console-web/plugins/glossary-index/web/player.tsx. |
| 42 | `terminal-header-responsive` | #387 | 2026-11-08 | red | rebuild | Merges cleanly but its CI is red. |
| 43 | `memory-restructure-chunked-claude-md-store-memor` | #391 | 2026-11-08 | conflict | rebuild | 3 file(s) conflict with main: .github/workflows/android.yml, apps/console-web/plugins/claude-accounts/plugin.json, framework/cli/plugin-lifecycle.mjs. |
| 44 | `account-failover-notify` | #392 | 2026-11-08 | conflict | rebuild | 2 file(s) conflict with main: apps/console-web/plugins/claude-accounts/help.json, deploy/claude-headless.sh. |
| 45 | `account-health-failover` | #394 | 2026-11-08 | conflict | rebuild | 2 file(s) conflict with main: apps/console-web/plugins/claude-accounts/help.json, deploy/claude-headless.sh. |
| 46 | `orchestrator-api-rule-in-every-brief-plan-studio` | #396 | 2026-11-08 | conflict | rebuild | 2 file(s) conflict with main: apps/console-web/plugins/build-manager/test.mjs, apps/console-web/plugins/build-manager/web/orchestrate.mjs. |
| 47 | `tabs-api-control` | #398 | 2026-11-08 | red | rebuild | Merges cleanly but its CI is red. |
| 48 | `plan-studio-receives-a-valid-shipped-feature-man` | #404 | 2026-11-09 | red | rebuild | Merges cleanly but its CI is red. |
| 49 | `orchestrator-self-check-when-stuck-verify-each-a` | #407 | 2026-11-09 | conflict | rebuild | 6 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline-core.mjs, apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/pipeline.test.mjs, apps/console-web/plugins/build-orchestrator/plugin.json. |
| 50 | `orchestrator-settings-api-account-limits-and-rou` | #408 | 2026-11-09 | conflict | rebuild | 4 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/help.json, apps/console-web/plugins/build-orchestrator/web/index.tsx, apps/console-web/plugins/build-orchestrator/web/orchestrator.css, apps/console-web/plugins/build-orchestrator/web/pipeline.tsx. |
| 51 | `right-click-a-queued-build-to-assign-it-to-a-spe` | #411 | 2026-11-09 | conflict | rebuild | 9 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/help.json, apps/console-web/plugins/build-orchestrator/pipeline-core.mjs, apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/web/index.tsx. |
| 52 | `saved-claude-logins-never-end-up-on-a-spent-refr` | #412 | 2026-11-09 | conflict | rebuild | 1 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline.mjs. |
| 53 | `per-account-queues-long-press-a-queued-build-to` | #413 | 2026-11-09 | conflict | rebuild | 10 file(s) conflict with main: apps/console-web/plugins/build-manager/web/ui.tsx, apps/console-web/plugins/build-orchestrator/help.json, apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/pipeline.test.mjs. |
| 54 | `one-source-of-truth-for-claude-accounts-the-orch` | #414 | 2026-11-09 | conflict | rebuild | 4 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline-core.mjs, apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/pipeline.test.mjs, apps/console-web/plugins/build-orchestrator/web/pipeline.tsx. |
| 55 | `owner-only-settings-brett-s-admin-console-login-counts-as-owner` | #415 | 2026-11-09 | red | rebuild | Merges cleanly but its CI is red. |
| 56 | `fix-owner-check-bug-dead-start-button` | #416 | 2026-11-09 | conflict | rebuild | 4 file(s) conflict with main: apps/console-web/plugins/build-manager/server/__init__.py, apps/console-web/plugins/build-manager/test.py, apps/console-web/plugins/build-manager/web/store.ts, apps/console-web/plugins/build-manager/web/ui.tsx. |
| 57 | `approvals-page-auto-approve-toggle-1-h-2-h-until` | #417 | 2026-11-09 | red | rebuild | Merges cleanly but its CI is red. |
| 58 | `skins-restyle-everything-badges-banner-and-every-visual-element` | #409 | 2026-11-09 | red | rebuild | Merges cleanly but its CI is red. |
| 59 | `fix-log-fyi-phone-notifications-from-claude-sess` | #418 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 60 | `assign-an-employee-to-every-role-action-type-and` | #419 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 61 | `fix-it-yourself-rule-in-every-brief-and-session` | #420 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 62 | `real-time-slot-tracking-stale-data-reaper` | #421 | 2026-11-10 | conflict | rebuild | 3 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/server/__init__.py, apps/console-web/plugins/build-orchestrator/web/pipeline.tsx. |
| 63 | `activity-monitor-plugin-live-plain-english-log-o` | #422 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 64 | `build-statuses-tell-the-truth-orchestrator-list` | #423 | 2026-11-10 | conflict | rebuild | 6 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/pipeline.test.mjs, apps/console-web/plugins/build-orchestrator/web/ui.tsx, apps/console-web/src/axf/core/build-pipeline.d.mts. |
| 65 | `failed-launches-auto-retry-on-another-working-ac` | #424 | 2026-11-10 | conflict | rebuild | 3 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline-core.mjs, apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/web/pipeline.tsx. |
| 66 | `account-failover-chain-subscription-next-subscri` | #425 | 2026-11-10 | conflict | rebuild | 6 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline-core.mjs, apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/web/pipeline.tsx, apps/console-web/src/axf/core/build-pipeline.d.mts. |
| 67 | `orchestrator-and-build-manager-search-bar-collap` | #426 | 2026-11-10 | conflict | rebuild | 8 file(s) conflict with main: apps/console-web/plugins/build-manager/web/build-manager.css, apps/console-web/plugins/build-manager/web/history.mjs, apps/console-web/plugins/build-manager/web/index.tsx, apps/console-web/plugins/build-manager/web/ui.tsx. |
| 68 | `urgent-terminal-pops-up-every-time-the-console-o` | #427 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 69 | `let-voice-api-route-a-build-to-an-api-account-wi` | #428 | 2026-11-10 | conflict | rebuild | 4 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline-core.mjs, apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/pipeline.test.mjs, apps/console-web/plugins/build-orchestrator/web/pipeline.tsx. |
| 70 | `amberx-approvals-fix` | #353 | 2026-11-10 | clean | merge | Merges cleanly; main has not touched its files since. |
| 71 | `vps-orchestrator-only-rule-vps-settings-console` | #431 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 72 | `split-builds-pages-build-manager-pending-complet` | #432 | 2026-11-10 | closed | skip | Its PR was closed without merging (superseded or dropped). |
| 73 | `test-button-on-every-claude-account-subscription` | #434 | 2026-11-10 | conflict | rebuild | 1 file(s) conflict with main: apps/console-web/plugins/claude-accounts/help.json. |
| 74 | `self-healing-build-folders-auto-clear-stale-git` | #435 | 2026-11-10 | conflict | rebuild | 2 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/pipeline.test.mjs. |
| 75 | `one-amberx-build-notification-veto-approval-befo` | #436 | 2026-11-10 | conflict | rebuild | 5 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/help.json, apps/console-web/plugins/build-orchestrator/pipeline-core.mjs, apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/web/index.tsx. |
| 76 | `console-speed-profile-and-cut-axf-console-cpu-pl` | #437 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 77 | `ui-review-timeout-after-1-hour-notify-brett-and` | #439 | 2026-11-10 | conflict | rebuild | 1 file(s) conflict with main: apps/console-web/plugins/ui-review/test.py. |
| 78 | `split-builds-pages-build-manager-pending-complet-3` | #440 | 2026-11-10 | closed | skip | Its PR was closed without merging (superseded or dropped). |
| 79 | `resolve-merge-conflicts-and-land-running-builds` | #441 | 2026-11-10 | overlap | merge | Merges cleanly; 3 file(s) also changed on main since (framework/plan/profiles/breakroom/framework/catalog/status.json, framework/plan/profiles/breakroom/framework/plan/build-queue.json, framework/plan/profiles/breakroom/framework/plan/plan.json). |
| 80 | `resolve-the-conflict-and-land-the-orchestrator-l` | #442 | 2026-11-10 | conflict | rebuild | 5 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/web/ui.tsx, apps/console-web/src/axf/core/build-pipeline.d.mts, framework/core/build-pipeline.d.mts. |
| 81 | `one-vps-plugin-everything-vps-in-one-place-gauge` | #443 | 2026-11-10 | clean | merge | Merges cleanly; main has not touched its files since. |
| 82 | `prompt-caching-and-batch-api-support-in-the-buil` | #444 | 2026-11-10 | conflict | rebuild | 2 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline-core.mjs, apps/console-web/plugins/build-orchestrator/pipeline.mjs. |
| 83 | `file-watchdog-plugin-watch-files-run-scripts-or` | #445 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 84 | `claude-accounts-manager-plugin-one-ordered-list` | #448 | 2026-11-10 | conflict | rebuild | 4 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline-core.mjs, apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/pipeline.test.mjs, apps/console-web/plugins/build-orchestrator/web/pipeline.tsx. |
| 85 | `account-order-switch-custom-drag-and-drop-order` | #449 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 86 | `amberx-open-url-tapping-the-command-waiting-noti` | #454 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 87 | `merge-queue-batching-orchestrator-combines-ready` | #457 | 2026-11-10 | clean | merge | Merges cleanly; main has not touched its files since. |
| 88 | `claude-md-standing-rule-be-proactive-bring-up-th` | #458 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 89 | `merge-batching-add-on-when-a-batch-fails-ci-spli` | #459 | 2026-11-10 | clean | merge | Merges cleanly; main has not touched its files since. |
| 90 | `conversation-rag-index-every-voice-chat-session` | #461 | 2026-11-10 | overlap | merge | Merges cleanly; 1 file(s) also changed on main since (.github/workflows/android.yml). |
| 91 | `conversation-rag-amendment-store-only-short-key` | #462 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 92 | `fix-the-orchestrator-s-splitter-claude-print-get` | #460 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 93 | `appearance-skins-colour-themes-only-remove-design-packs` | #430 | 2026-11-10 | conflict | rebuild | 1 file(s) conflict with main: apps/console-web/plugins/glossary-index/terms.json. |
| 94 | `orchestrator-checks-each-build-against-main-righ` | #464 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 95 | `skin-checker-flags-anything-that-breaks-a-profes` | #466 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 96 | `molly-fable-version-the-one-interface-for-amberx` | #447 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 97 | `molly-flagship-skin-premium-sellable-uncluttered` | #469 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 98 | `resolve-conflicts-and-land-460-456-457-459-342` | #473 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 99 | `inline-element-editing-plugin-right-click-any-el` | #470 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 100 | `finish-and-land-the-git-status-board-every-ready` | #475 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 101 | `no-veto-timer-on-navigation-follow-amber-open-x` | #476 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 102 | `molly-one-shell` | #395 | 2026-11-10 | conflict | rebuild | 1 file(s) conflict with main: apps/molly/src/axf/core/types.ts. |
| 103 | `make-hulu-actually-take-builds-dispatcher-counts` | #478 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 104 | `molly-sign-in-once` | #477 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 105 | `orchestrator-merge-first-switch-separate-merger` | #480 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 106 | `api-accounts-need-no-approval-builds-route-there` | #479 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 107 | `stall-watchdog-detect-when-nothing-is-building-a` | #481 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 108 | `gizmo-opens-by-voice-link-amberx-web-app-android` | #483 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 109 | `ai-assistant-gizmo-moved-to-the-console-remove-t` | #482 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 110 | `auto-requeue-builds-whose-session-stops-early-go` | #484 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 111 | `home-page-build-queue-card-opens-the-orchestrato` | #485 | 2026-11-10 | conflict | rebuild | 5 file(s) conflict with main: apps/console-web/plugins/build-orchestrator/pipeline.mjs, apps/console-web/plugins/build-orchestrator/server/__init__.py, apps/console-web/plugins/build-orchestrator/web/index.tsx, apps/console-web/plugins/build-orchestrator/web/pipeline.tsx. |
| 112 | `convert-every-app-into-a-molly-module-expenses-c` | #486 | 2026-11-10 | red | rebuild | Merges cleanly but its CI is red. |
| 113 | `per-agent-api-control-switch-in-each-employee-s` | #487 | 2026-11-11 | clean | merge | Merges cleanly; main has not touched its files since. |
