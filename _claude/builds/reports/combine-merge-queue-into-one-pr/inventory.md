# Combine merge queue: inventory

Taken 2026-11-13 from GitHub (PR, check-runs on the head, files) and `land.mjs queue list` (mode stack, depth 3, queue on).
Base: origin/main at 9bfb04d0a.

| PR | In | Queue pos | State | Head | CI on head | Mergeable | Files | Branch | Title |
|---|---|---|---|---|---|---|---|---|---|
| #513 | in | 6 | open | `e8af33a33` | success | false/dirty | 15 | `claude/x.engine.dev` | Live reload: useDevServer web hot reload, robust axf dev, Android e2e job |
| #515 | in | 7 | open | `ca1ef0cb7` | success | false/dirty | 10 | `claude/orchestrator-checks-shipped-features-before-spli` | Orchestrator checks Shipped features before splitting any job |
| #529 | in | 16 | open | `57b0bce23` | failure: Light PR checks (full run happens once, in the merge queue) | true/unstable | 12 | `claude/new-project-wizard-name-linked-repo-required-starter-code-skin-accounts` | New project wizard: name, linked repo, starter, framework, skin, Claude account, first plan, create and switch |
| #539 | in | 8 | open | `86dd0a3d3` | success | true/clean | 9 | `claude/server-every-failed-merge-alerts-brett-immediately-and-retries-by-itself-until` | Server lander: every failed merge alerts at once and retries until merged |
| #544 | in | 12 | open | `1acb62d14` | success | false/dirty | 16 | `claude/tap-to-confirm-follows-label-visibility-quick-switches-pane-at-top-of-every-ch` | Tap-to-confirm follows label visibility + quick-switches pane in chrome settings |
| #545 | in | 9 | open | `28246078b` | success | false/dirty | 5 | `claude/change-to-one-to-do-notes-and-tasks-plugin-pr-527-brett-notes-tasks-and-to` | Notes & tasks: one item type, nested to any depth (revises #527) |
| #560 | in | 11 | open | `31b744e80` | success | false/dirty | 15 | `claude/server-gate-one-session-per-build-no-duplicate-launches` | Server gate: one session per build, no duplicate launches |
| #562 | in | 3 | open | `779ee6f9b` | success | true/clean | 13 | `claude/one-source-of-truth-console-shows-only-what-the-server-says-is-running` | One source of truth: console shows only what the server says is running |
| #563 | in | 4 | open | `0ad851f39` | success | true/clean | 68 | `claude/every-skin-ships-a-light-and-a-dark-colour-theme` | Every skin ships a light and a dark colour theme (skin-modes@1) |
| #564 | in | 10 | open | `93e99382b` | success | true/clean | 18 | `claude/stop-the-molly-guide-from-popping-up-and-talking-every-time-the-console-loads-n` | Guide never pops up on console load; Molly → Gizmo |
| #566 | in | 5 | open | `0898ade1a` | success | true/clean | 222 | `claude/fix-merge-conflicts-on-pr-557-professional-skins` | Fix merge conflicts on PR #557 (professional skins) with main, run the checks, push and land it; confirm the merge on Gi |
| #568 | in | 13 | open | `c5251a4f9` | success | false/dirty | 39 | `claude/badge-shape-picker-on-the-banners-screen-pill-text-icon-or-dot-for-every-bad` | Badge shape picker on the Banners screen (pill, icon or dot per badge) |
| #570 | in | 14 | open | `fb02b2658` | success | false/dirty | 47 | `claude/unlink-plan-studio-from-builds-delete-all-plan-s` | Plan Studio: delete all plans, unlink from builds |
| #556 | **out** | 2 | open | `c9644fc19` | success | true/clean | 114 | `claude/full-api-and-voice-control-of-the-entire-console-every-tab-screen-setting-bu` | console-control@1: full API and voice control of the console (Phase 1: contract, engine, target registry, scroll, grid focus) |

## Decisions

- **#556 out**: its build (full-api-and-voice-control…) is still running, 27 of 31 steps done (executor tests, parity test, docs and checks open). PR checks are green, but it is not done building. It stays in the queue on its own.
- **#560, #562 in**: Brett named them; code and PR are green. Their builds show only the closing "tests, PR, land" step open; that is what this combine does.
- **#529 in**: its light PR check is red on the head; the combined branch fixes whatever is still red.
- **#554, #571** are in the queue but not on Brett's list: left alone.

## Files touched per PR

### #513 (15)

- .github/workflows/android.yml
- .github/workflows/dev-reload-android.yml
- README.md
- apps/demo/src/axf/react/devServer.ts
- apps/demo/src/axf/react/index.ts
- apps/demo/src/main.tsx
- framework/catalog/status.json
- framework/cli/check-dev-server.mjs
- framework/cli/dev-reload-e2e.mjs
- framework/cli/dev-server.mjs
- framework/plan/plan.json
- framework/plan/seed.json
- framework/react/devServer.ts
- framework/react/index.ts
- framework/spec/PORTING.md

### #515 (10)

- _claude/THREADS.md
- _claude/builds/reports/orchestrator-checks-shipped-features-before-spli.md
- apps/console-web/plugins/build-orchestrator/notify.json
- apps/console-web/plugins/build-orchestrator/pipeline-core.mjs
- apps/console-web/plugins/build-orchestrator/pipeline.mjs
- apps/console-web/plugins/build-orchestrator/pipeline.test.mjs
- apps/console-web/plugins/build-orchestrator/plugin.json
- apps/console-web/plugins/build-orchestrator/server/__init__.py
- framework/cli/shipped.mjs
- framework/schemas/rules-briefs.json

### #529 (12)

- .github/workflows/android.yml
- _claude/memory/STATUS.md
- apps/console-web/plugins/project-wizard/help.json
- apps/console-web/plugins/project-wizard/install.mjs
- apps/console-web/plugins/project-wizard/plugin.json
- apps/console-web/plugins/project-wizard/server/__init__.py
- apps/console-web/plugins/project-wizard/test.mjs
- apps/console-web/plugins/project-wizard/uninstall.mjs
- apps/console-web/plugins/project-wizard/web/index.tsx
- apps/console-web/plugins/project-wizard/web/project-wizard.css
- apps/console-web/plugins/project-wizard/web/steps.tsx
- apps/console-web/plugins/project-wizard/wizard.mjs

### #539 (9)

- .github/workflows/android.yml
- _claude/builds/reports/server-every-failed-merge-alerts-brett-immediately-and-retries-by-itself-until.md
- apps/console-web/plugins/push-banner/land/lander.mjs
- apps/console-web/plugins/push-banner/merge-pr.sh
- apps/console-web/plugins/push-banner/notify.json
- apps/console-web/plugins/push-banner/plugin.json
- apps/console-web/plugins/push-banner/server/__init__.py
- apps/console-web/plugins/push-banner/server/lander.py
- apps/console-web/plugins/push-banner/test_lander.py

### #544 (16)

- _claude/builds/reports/tap-to-confirm-follows-label-visibility-quick-switches-pane-at-top-of-every-ch.md
- framework/core/engines/chrome-settings-rules.d.mts
- framework/core/engines/chrome-settings-rules.mjs
- framework/core/engines/tapconfirm.ts
- framework/libs/toolbars/index.tsx
- framework/react/components/Chrome.tsx
- framework/react/components/ChromeContext.tsx
- framework/react/components/Controls.tsx
- framework/react/components/NavTree.tsx
- framework/react/components/TabGroup.tsx
- framework/react/tapConfirm.ts
- framework/schemas/asset-types.json
- framework/spec/PORTING.md
- framework/spec/check-tapconfirm.mts
- framework/spec/fixtures/chrome-settings.json
- framework/ui/axf.css

### #545 (5)

- _claude/THREADS.md
- _claude/builds/reports/change-to-one-to-do-notes-and-tasks-plugin-pr-527-brett-notes-tasks-and-to.md
- apps/console-web/plugins/notes-tasks/DESIGN.md
- apps/console-web/plugins/notes-tasks/schema/notes-tasks.schema.json
- framework/spec/PORTING.md

### #560 (15)

- apps/console-web/plugins/build-orchestrator/pipeline.mjs
- apps/console-web/plugins/build-orchestrator/pipeline.test.mjs
- apps/console-web/plugins/build-orchestrator/plugin.json
- apps/console-web/plugins/build-orchestrator/server/__init__.py
- apps/console-web/plugins/build-orchestrator/web/gate-banner.tsx
- apps/console-web/plugins/build-orchestrator/web/gate-log.tsx
- apps/console-web/plugins/build-orchestrator/web/index.tsx
- apps/console-web/plugins/build-orchestrator/web/menu.ts
- apps/console-web/plugins/push-banner/land/merge-queue.mjs
- apps/console-web/plugins/push-banner/land/merge-queue.test.mjs
- apps/console-web/src/axf/react/components/BannerSettings.tsx
- deploy/claude-headless.sh
- framework/cli/server-gate.mjs
- framework/cli/server-gate.test.mjs
- framework/plan/builds-merge-core.mjs

### #562 (13)

- .github/workflows/android.yml
- apps/console-web/plugins/agent-slots/server/__init__.py
- apps/console-web/plugins/agent-slots/web/index.tsx
- apps/console-web/plugins/build-orchestrator/orchestrator.mjs
- apps/console-web/plugins/build-orchestrator/pipeline.mjs
- apps/console-web/plugins/build-orchestrator/pipeline.test.mjs
- apps/console-web/plugins/build-orchestrator/plugin.json
- apps/console-web/plugins/build-orchestrator/server/__init__.py
- apps/console-web/plugins/build-orchestrator/web/pipeline.tsx
- deploy/install-console.sh
- framework/cli/live-truth.mjs
- framework/plan/live-truth-core.mjs
- framework/spec/check-live-truth.mjs

### #563 (68)

- .github/workflows/android.yml
- _claude/THREADS.md
- _claude/builds/reports/every-skin-ships-a-light-and-a-dark-colour-theme.md
- apps/amberx-droid/src/axf/assets/color-theme/windows-dark.json
- apps/amberx-droid/src/axf/assets/help/framework-drafts.json
- apps/amberx-droid/src/axf/assets/skin/atelier.json
- apps/amberx-droid/src/axf/assets/skin/clinic.json
- apps/amberx-droid/src/axf/assets/skin/control-room.json
- apps/amberx-droid/src/axf/assets/skin/ledger.json
- apps/amberx-droid/src/axf/assets/skin/newsroom.json
- apps/amberx-droid/src/axf/assets/skin/windows.json
- apps/amberx-droid/src/axf/core/engines/skin-modes.d.mts
- apps/amberx-droid/src/axf/core/engines/skin-modes.mjs
- apps/amberx-droid/src/axf/core/runtime.ts
- apps/amberx-droid/src/axf/schemas/json/skin.schema.json
- apps/axhub-web/src/axf/assets/color-theme/windows-dark.json
- apps/axhub-web/src/axf/assets/help/framework-drafts.json
- apps/axhub-web/src/axf/assets/skin/atelier.json
- apps/axhub-web/src/axf/assets/skin/clinic.json
- apps/axhub-web/src/axf/assets/skin/control-room.json
- apps/axhub-web/src/axf/assets/skin/ledger.json
- apps/axhub-web/src/axf/assets/skin/newsroom.json
- apps/axhub-web/src/axf/assets/skin/windows.json
- apps/axhub-web/src/axf/core/engines/skin-modes.d.mts
- apps/axhub-web/src/axf/core/engines/skin-modes.mjs
- apps/axhub-web/src/axf/core/runtime.ts
- apps/axhub-web/src/axf/schemas/json/skin.schema.json
- apps/console-web/plugins/theme-manager/README.md
- apps/console-web/plugins/theme-manager/server/__init__.py
- apps/console-web/plugins/theme-manager/test.py
- apps/console-web/src/axf/assets/color-theme/windows-dark.json
- apps/console-web/src/axf/assets/help/framework-drafts.json
- apps/console-web/src/axf/assets/skin/atelier.json
- apps/console-web/src/axf/assets/skin/clinic.json
- apps/console-web/src/axf/assets/skin/control-room.json
- apps/console-web/src/axf/assets/skin/ledger.json
- apps/console-web/src/axf/assets/skin/newsroom.json
- apps/console-web/src/axf/assets/skin/windows.json
- apps/console-web/src/axf/core/engines/skin-modes.d.mts
- apps/console-web/src/axf/core/engines/skin-modes.mjs
- … and 28 more

### #564 (18)

- _claude/THREADS.md
- _claude/builds/reports/stop-the-molly-guide-from-popping-up-and-talking-every-time-the-console-loads-n.md
- apps/amberx-droid/server/main.py
- apps/amberx-droid/walkthrough/README.md
- apps/amberx-droid/walkthrough/script.mjs
- apps/amberx-droid/walkthrough/seed.mts
- apps/amberx-droid/walkthrough/stack.mjs
- apps/console-web/plugins/glossary-index/terms.json
- apps/console-web/plugins/molly-guide/help.json
- apps/console-web/plugins/molly-guide/hooks.mjs
- apps/console-web/plugins/molly-guide/plugin.json
- apps/console-web/plugins/molly-guide/server/__init__.py
- apps/console-web/plugins/molly-guide/test.mts
- apps/console-web/plugins/molly-guide/test.py
- apps/console-web/plugins/molly-guide/web/index.tsx
- apps/console-web/plugins/molly-guide/web/menu.ts
- apps/console-web/plugins/molly-guide/web/walkthrough.ts
- framework/spec/PORTING.md

### #566 (222)

- _claude/THREADS.md
- _claude/builds/reports/fix-merge-conflicts-on-pr-557-professional-skins.md
- _claude/builds/reports/professional-skins-that-rebuild-the-whole-app-fable-ultrathink-every-step-e.md
- apps/amberx-droid/axf.manifest.json
- apps/amberx-droid/src/axf/assets/color-theme/command-phosphor.json
- apps/amberx-droid/src/axf/assets/color-theme/executive-ivory.json
- apps/amberx-droid/src/axf/assets/color-theme/field-day.json
- apps/amberx-droid/src/axf/assets/color-theme/studio-pro-slate.json
- apps/amberx-droid/src/axf/assets/help/framework.json
- apps/amberx-droid/src/axf/assets/layout/command.json
- apps/amberx-droid/src/axf/assets/layout/executive.json
- apps/amberx-droid/src/axf/assets/layout/field.json
- apps/amberx-droid/src/axf/assets/layout/studio-pro.json
- apps/amberx-droid/src/axf/assets/skin/command.json
- apps/amberx-droid/src/axf/assets/skin/executive.json
- apps/amberx-droid/src/axf/assets/skin/field.json
- apps/amberx-droid/src/axf/assets/skin/studio-pro.json
- apps/amberx-droid/src/axf/assets/skin/windows.json
- apps/amberx-droid/src/axf/assets/style-theme/field.json
- apps/amberx-droid/src/axf/assets/style-theme/studio-pro.json
- apps/amberx-droid/src/axf/assets/table/command.json
- apps/amberx-droid/src/axf/assets/table/executive.json
- apps/amberx-droid/src/axf/assets/table/field.json
- apps/amberx-droid/src/axf/assets/table/standard.json
- apps/amberx-droid/src/axf/assets/table/studio-pro.json
- apps/axhub-web/axf.manifest.json
- apps/axhub-web/src/axf/assets/color-theme/command-phosphor.json
- apps/axhub-web/src/axf/assets/color-theme/executive-ivory.json
- apps/axhub-web/src/axf/assets/color-theme/field-day.json
- apps/axhub-web/src/axf/assets/color-theme/studio-pro-slate.json
- apps/axhub-web/src/axf/assets/help/framework.json
- apps/axhub-web/src/axf/assets/layout/command.json
- apps/axhub-web/src/axf/assets/layout/executive.json
- apps/axhub-web/src/axf/assets/layout/field.json
- apps/axhub-web/src/axf/assets/layout/studio-pro.json
- apps/axhub-web/src/axf/assets/skin/command.json
- apps/axhub-web/src/axf/assets/skin/executive.json
- apps/axhub-web/src/axf/assets/skin/field.json
- apps/axhub-web/src/axf/assets/skin/studio-pro.json
- apps/axhub-web/src/axf/assets/skin/windows.json
- … and 182 more

### #568 (39)

- _claude/THREADS.md
- _claude/builds/reports/badge-shape-picker-on-the-banners-screen-pill-text-icon-or-dot-for-every-bad.md
- apps/amberx-droid/src/axf/core/engines/bannerwidgets.ts
- apps/amberx-droid/src/axf/core/runtime.ts
- apps/amberx-droid/src/axf/react/components/BadgeShapes.tsx
- apps/amberx-droid/src/axf/react/components/Banner.tsx
- apps/amberx-droid/src/axf/react/components/BannerSettings.tsx
- apps/amberx-droid/src/axf/react/components/BannerWidgets.tsx
- apps/amberx-droid/src/axf/ui/axf.css
- apps/axhub-web/src/axf/core/engines/bannerwidgets.ts
- apps/axhub-web/src/axf/core/runtime.ts
- apps/axhub-web/src/axf/react/components/BadgeShapes.tsx
- apps/axhub-web/src/axf/react/components/Banner.tsx
- apps/axhub-web/src/axf/react/components/BannerSettings.tsx
- apps/axhub-web/src/axf/react/components/BannerWidgets.tsx
- apps/axhub-web/src/axf/ui/axf.css
- apps/console-web/src/axf/core/engines/bannerwidgets.ts
- apps/console-web/src/axf/core/runtime.ts
- apps/console-web/src/axf/react/components/BadgeShapes.tsx
- apps/console-web/src/axf/react/components/Banner.tsx
- apps/console-web/src/axf/react/components/BannerSettings.tsx
- apps/console-web/src/axf/react/components/BannerWidgets.tsx
- apps/console-web/src/axf/ui/axf.css
- apps/molly/src/axf/core/engines/bannerwidgets.ts
- apps/molly/src/axf/core/runtime.ts
- apps/molly/src/axf/react/components/BadgeShapes.tsx
- apps/molly/src/axf/react/components/Banner.tsx
- apps/molly/src/axf/react/components/BannerSettings.tsx
- apps/molly/src/axf/react/components/BannerWidgets.tsx
- apps/molly/src/axf/ui/axf.css
- framework/core/engines/bannerwidgets.ts
- framework/core/runtime.ts
- framework/react/components/BadgeShapes.tsx
- framework/react/components/Banner.tsx
- framework/react/components/BannerSettings.tsx
- framework/react/components/BannerWidgets.tsx
- framework/spec/PORTING.md
- framework/spec/check-widgets.mts
- framework/ui/axf.css

### #570 (47)

- .github/workflows/android.yml
- _claude/THREADS.md
- _claude/builds/reports/unlink-plan-studio-from-builds-delete-all-plan-s.md
- _claude/memory/STATUS.md
- _claude/memory/docs/plan-studio/README.md
- _claude/memory/docs/priority-tags.md
- _claude/shared/rules/RULES.md
- apps/amberx-droid/axf.lock.json
- apps/amberx-droid/src/axf/core/build-priority.mjs
- apps/console-web/axf.lock.json
- apps/console-web/plugins/README.md
- apps/console-web/plugins/build-orchestrator/plugin.json
- apps/console-web/plugins/build-orchestrator/server/__init__.py
- apps/console-web/plugins/build-orchestrator/test.mjs
- apps/console-web/plugins/plan-studio/catalog.mjs
- apps/console-web/plugins/plan-studio/data/plans/amberx-selling-it.json
- apps/console-web/plugins/plan-studio/data/plans/clipx.json
- apps/console-web/plugins/plan-studio/data/plans/docs-studio.json
- apps/console-web/plugins/plan-studio/help.json
- apps/console-web/plugins/plan-studio/hooks.mjs
- apps/console-web/plugins/plan-studio/install.mjs
- apps/console-web/plugins/plan-studio/plans.mjs
- apps/console-web/plugins/plan-studio/plugin.json
- apps/console-web/plugins/plan-studio/schema/plan.schema.json
- apps/console-web/plugins/plan-studio/server/__init__.py
- apps/console-web/plugins/plan-studio/test.mjs
- apps/console-web/plugins/plan-studio/test.py
- apps/console-web/plugins/plan-studio/web/ai.tsx
- apps/console-web/plugins/plan-studio/web/api.ts
- apps/console-web/plugins/plan-studio/web/catalog.tsx
- apps/console-web/plugins/plan-studio/web/editor.tsx
- apps/console-web/plugins/plan-studio/web/plan-ai.d.mts
- apps/console-web/plugins/plan-studio/web/plan-ai.mjs
- apps/console-web/plugins/plan-studio/web/plan-core.d.mts
- apps/console-web/plugins/plan-studio/web/plan-core.mjs
- apps/console-web/plugins/plan-studio/web/plan-studio.css
- apps/console-web/plugins/plan-studio/web/ui.tsx
- apps/console-web/plugins/plan-studio/web/voice.ts
- apps/console-web/plugins/shipped-features/README.md
- apps/console-web/plugins/token-control/lib/planner.mjs
- … and 7 more

### #556 (114)

- .github/workflows/android.yml
- apps/console-web/axf.lock.json
- apps/console-web/package.json
- apps/console-web/plugins/agent-slots/web/index.tsx
- apps/console-web/plugins/agent-swarm/web/jobs.tsx
- apps/console-web/plugins/build-orchestrator/web/index.tsx
- apps/console-web/plugins/build-orchestrator/web/pipeline.tsx
- apps/console-web/plugins/build-orchestrator/web/ui.tsx
- apps/console-web/plugins/chat-viewer/web/ui.tsx
- apps/console-web/plugins/console-commands/server/__init__.py
- apps/console-web/plugins/console-commands/web/index.tsx
- apps/console-web/plugins/plan-studio/web/ui.tsx
- apps/console-web/plugins/ui-review/web/views.tsx
- apps/console-web/scripts/control-inventory.mjs
- apps/console-web/scripts/sync-data.mjs
- apps/console-web/server/console_control.py
- apps/console-web/server/console_control_api.py
- apps/console-web/server/main.py
- apps/console-web/server/mcp_server.py
- apps/console-web/server/tests/test_console_control.py
- apps/console-web/src/App.tsx
- apps/console-web/src/actions/console-control.ts
- apps/console-web/src/actions/voice-control.ts
- apps/console-web/src/axf/assets/help/framework-drafts.json
- apps/console-web/src/axf/core/build-pipeline.mjs
- apps/console-web/src/axf/core/engines/console-commands.d.mts
- apps/console-web/src/axf/core/engines/console-commands.mjs
- apps/console-web/src/axf/core/engines/console-control-rules.d.mts
- apps/console-web/src/axf/core/engines/console-control-rules.mjs
- apps/console-web/src/axf/core/engines/console-control-voice.d.mts
- apps/console-web/src/axf/core/engines/console-control-voice.mjs
- apps/console-web/src/axf/core/engines/console-control.ts
- apps/console-web/src/axf/core/engines/control-rules.mjs
- apps/console-web/src/axf/core/engines/search.ts
- apps/console-web/src/axf/core/index.ts
- apps/console-web/src/axf/libs/datagrid/index.tsx
- apps/console-web/src/axf/libs/settings/index.tsx
- apps/console-web/src/axf/react/AppShell.tsx
- apps/console-web/src/axf/react/AxfProvider.tsx
- apps/console-web/src/axf/react/components/Banner.tsx
- … and 74 more

## Hold (s2)

The merge queue has no pause of its own short of switching it off (Brett's click), so each of the 13 builds is held by
hand in auto-land: `land.mjs hold <build> --why "Combine merge queue …"` (land-control.json `holds`). The queue reads
that hold as `landHeld` and takes the PR out of the line-up at its next round ("held by hand in auto-land"), so none of
them can land one at a time. Nothing is removed from the queue yet. #554, #556 and #571 keep running on their own.
Released in s18 (`land.mjs release <build>`) once the combined PR replaces them.

## Combined branch (s3)

`combine/merge-queue-2026-11-13` from origin/main `501e246f8`, worktree `/root/axf-builds/combine-mq-2026-11-13`, the
builds merge driver installed there (`builds-live.mjs install`). PR heads fetched as `pr/<n>`; all 13 match the table.

## Conflict log

- #513: `framework/spec/PORTING.md` both sides added a Deferred section: kept both (union).
- #515: `build-orchestrator/pipeline-core.mjs` splitPrompt/parseSplit: main's step limit (`STEP_MINUTES`/`maxStep`, 60
  steps max) + #515's shipped-features argument, `alreadyShipped` and flags. `pipeline.mjs`: main's project scope
  (`runnable`, `inProfile`) and crew-chat lines kept, #515's shipped checks (`loadChecks`, `shippedHolds`, alert) added
  to each. #515's new parseSplit test used a 20-min step; main's limit is now 10, so the test's estimate is 10 min.
  pipeline.test.mjs: 51 checks pass.
- #529: merged clean. Its red light check was `project-wizard/test.mjs` "switched into the new project": CI pins
  `AXF_BUILD_PROFILE=all` for the whole workflow, which overrides the profile switch the test makes. The test now drops
  that pin from the wizard's env (reproduced with the pin, passes with the fix).
- #539: merged clean.
