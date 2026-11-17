# Fix launcher crash: duplicate steps + brief too big

## Duplicate steps: before / after

Cleanup run on the live store Nov 17 2026 (`builds-store.mjs dedupe-steps --apply --from <pre-fix snapshot>`), one journalled revision per build, published to main through builds-live.

| Build | Before | After |
|---|---:|---:|
| api-fully-drives-every-field-type-forms | 2682 | 18 |
| dispatcher-split-builds-evenly-across | 2171 | 13 |
| vps-sets-every-build-status-manifest | 750 | 15 |
| one-true-source-for-every-setting | 720 | 20 |
| auto-lander-never-wait-missing-ui-review | 544 | 17 |
| fix-launcher-crash-duplicate-steps-brief | 240 | 16 |
| remove-amberx-app-code-once-phone | 224 | 7 |
| terminal-main-tab-streaming-console-s | 168 | 14 |
| molly-console-commands | 112 | 7 |
| auto-lander-settings-log-placeholder | 108 | 9 |
| profile-filter-tables | 96 | 4 |
| settings-fix-part-2-blank-toolbars | 84 | 21 |
| headless-session-efficiency-shared-chain-control | 32 | 16 |
| always-fill-every-slot-when-slots-are | 30 | 27 |
| server-watchdog-orchestrator-auto-recovers-stuck | 25 | 22 |
| every-plugin-screen-gets-a-settings-gear | 24 | 21 |
| server-rule-done-means-merged-working | 18 | 17 |
| stop-auto-lander-committing-tracking | 16 | 15 |
| context-menus-plugin-one-true-source | 12 | 9 |
| pass-approval-hook-deep-link-amberx-notification | 11 | 10 |
| running-builds-follow-the-active-claude-account-fail-over-when-it-dies | 10 | 5 |
| grindr-ai-wingman | 10 | 5 |
| new-app-wizard | 10 | 5 |
| orchestrator-settings-collapsible-split | 10 | 9 |
| molly-ri-court-records | 8 | 4 |
| fix-step-splitter-claude-exit-1-input | 8 | 4 |
| approvals-no-window-spam-on-approve-veto-only-for-vps-writes-and-account-switc | 6 | 3 |
| group-chat-audio-hear-agents-talk-while | 6 | 5 |
| amberx-open-any-url-apk | 4 | 2 |
| **Total (29 builds)** | **8139** | **340** |

