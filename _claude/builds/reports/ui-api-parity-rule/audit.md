67 UI areas lack full API parity (2549 gaps); at full parity: `glossary-index`.

| UI area | Views / dialogs | Controls | Gaps (actions · state) | Mapped | Deep links |
|---|---|---|---|---|---|
| **Framework (React layer, libs)** | — | 335 | 335 (335 · 0) | 0/0 | — |
| **Dev Console (own screens)** | — | 250 | 250 (250 · 0) | 0/0 | — |
| `agent-manager` Agent manager | agent-manager | 120 | 121 (120 · 1) | 0/1 | yes |
| `console-terminal` Terminal | terminal.connect, terminal.connection | 115 | 117 (115 · 2) | 0/2 | yes |
| `plan-studio` Plan Studio | plan-studio | 112 | 113 (112 · 1) | 0/1 | yes |
| `ai-assistant` AI assistant | ai-assistant, ai-assistant.chat | 87 | 89 (87 · 2) | 0/2 | yes |
| `agent-voice` Agent voice | agent-voice | 84 | 85 (84 · 1) | 0/1 | yes |
| `ui-review` UI Review | ui-review, design-packs | 73 | 75 (73 · 2) | 0/2 | yes |
| `claude-handoff` Claude handoff banner | claude-handoff, claude-handoff-preview | 57 | 59 (57 · 2) | 0/2 | yes |
| `agent-swarm` Agent swarm | agent-swarm | 57 | 58 (57 · 1) | 0/1 | yes |
| `todo-manager` Todo manager | todo-manager, todo-manager.entry | 54 | 56 (54 · 2) | 0/2 | yes |
| `context-menu-designer` Context menu designer | context-menu-designer | 53 | 54 (53 · 1) | 0/1 | yes |
| `chat-viewer` Chat viewer | chat-viewer | 47 | 48 (47 · 1) | 0/1 | yes |
| `md-studio` MD Studio | md-studio | 47 | 48 (47 · 1) | 0/1 | yes |
| `plugin-manager` Plugin Manager | plugin-manager, plugin-manager.window | 45 | 47 (45 · 2) | 0/2 | yes |
| `voice-notes` Voice notes | voice-notes | 46 | 47 (46 · 1) | 0/1 | yes |
| `push-banner` Push banner | — | 46 | 46 (46 · 0) | 0/0 | — |
| `notify-control` Notifications | notify-control | 44 | 45 (44 · 1) | 0/1 | yes |
| `systems-check` Systems check banner | system-check | 44 | 45 (44 · 1) | 0/1 | yes |
| `basic-filter` Basic filter | basic-filter | 41 | 42 (41 · 1) | 0/1 | yes |
| `plugins-menu` Plugins menu | plugins-menu.settings, plugins-menu.install | 40 | 42 (40 · 2) | 0/2 | yes |
| `ai-keys` AI keys | ai-keys, ai-keys.accounts | 39 | 41 (39 · 2) | 0/2 | yes |
| `build-manager` Build manager banner | build-manager | 37 | 38 (37 · 1) | 0/1 | yes |
| `token-control` Token control | token-control | 35 | 36 (35 · 1) | 0/1 | yes |
| `build-orchestrator` Build orchestrator | build-orchestrator | 33 | 34 (33 · 1) | 0/1 | yes |
| `audio-extract` Audio Extract | audio-extract | 29 | 30 (29 · 1) | 0/1 | yes |
| `theme-manager` Theme manager | theme-manager | 29 | 30 (29 · 1) | 0/1 | yes |
| `activity` Activity banner | — | 26 | 26 (26 · 0) | 0/0 | — |
| `feature-assist` Feature assistant | feature-assist.build | 25 | 26 (25 · 1) | 0/1 | yes |
| `project-wizard` Project wizard | project-wizard | 25 | 26 (25 · 1) | 0/1 | yes |
| `builds-page` Builds | builds | 24 | 25 (24 · 1) | 0/1 | yes |
| `codebase-changes` Codebase changes banner | codebase-changes | 22 | 23 (22 · 1) | 0/1 | yes |
| `api-browser` API Browser | api-browser | 21 | 22 (21 · 1) | 0/1 | yes |
| `feature-matrix` Feature matrix | feature-matrix | 20 | 21 (20 · 1) | 0/1 | yes |
| `theme-editor` Theme editor | theme-editor | 20 | 21 (20 · 1) | 0/1 | yes |
| `brand-library` Brand library | brand-library | 18 | 19 (18 · 1) | 0/1 | yes |
| `build-profiles` Build profiles | build-profiles | 17 | 18 (17 · 1) | 0/1 | yes |
| `claude-session` Claude sessions | claude.picker | 16 | 17 (16 · 1) | 0/1 | yes |
| `notes-browser` Notes | notes | 16 | 17 (16 · 1) | 0/1 | yes |
| `session-checkin` Session check-in | sessions | 14 | 15 (14 · 1) | 0/1 | yes |
| `shipped-features` Shipped features | shipped-features | 14 | 15 (14 · 1) | 0/1 | yes |
| `build-breaker` Build Breaker | build-breaker | 13 | 14 (13 · 1) | 0/1 | yes |
| `container-access` Container access | — | 14 | 14 (14 · 0) | 0/0 | — |
| `snapshot-manager` Snapshot Manager | — | 14 | 14 (14 · 0) | 0/0 | — |
| `approvals-banner` Approvals banner | approvals.veto | 12 | 13 (12 · 1) | 0/1 | yes |
| `fable-rebuilds` Fable rebuilds | fable-rebuilds, fable-rebuilds.report | 11 | 13 (11 · 2) | 0/2 | yes |
| `claude-accounts` Claude accounts | claude-accounts, claude-accounts.switch | 10 | 12 (10 · 2) | 0/2 | yes |
| `maintenance` Maintenance | maintenance | 11 | 12 (11 · 1) | 0/1 | yes |
| `whats-shipped` What's new | whats-shipped.panel | 11 | 12 (11 · 1) | 0/1 | yes |
| `crew-live` Crew | crew | 10 | 11 (10 · 1) | 0/1 | yes |
| `main-build-status` Main build status | — | 11 | 11 (11 · 0) | 0/0 | — |
| `output-recorder` Audio Output Recorder | output-recorder | 10 | 11 (10 · 1) | 0/1 | yes |
| `molly-guide` Molly guide | — | 10 | 10 (10 · 0) | 0/0 | — |
| `plugin-commands` Plugin commands | plugin-commands | 9 | 10 (9 · 1) | 0/1 | yes |
| `follow-amber` Follow Amber | follow-amber.approval | 8 | 9 (8 · 1) | 0/1 | yes |
| `plugin-update` Plugin Update | plugin-update | 8 | 9 (8 · 1) | 0/1 | yes |
| `agent-slots` Agent cap | — | 8 | 8 (8 · 0) | 0/0 | — |
| `amberx-listeners` AmberX listeners | amberx-listeners | 7 | 8 (7 · 1) | 0/1 | yes |
| `changes-grid` Changes & features grid | changes-grid | 7 | 8 (7 · 1) | 0/1 | yes |
| `github-app` GitHub | — | 8 | 8 (8 · 0) | 0/0 | — |
| `claude-settings` Claude | claude-settings | 4 | 5 (4 · 1) | 0/1 | yes |
| `plugin-switches` Plugin switches | plugin-switches | 4 | 5 (4 · 1) | 0/1 | yes |
| `console-commands` Console commands | — | 4 | 4 (4 · 0) | 0/0 | — |
| `alerts-bell` Alerts bell | — | 2 | 2 (2 · 0) | 0/0 | — |
| `claude-badge` Badges | — | 2 | 2 (2 · 0) | 0/0 | — |
| `mcp-client` MCP client | mcp | 0 | 1 (0 · 1) | 0/1 | yes |
| `ref-links` Reference links | — | 1 | 1 (1 · 0) | 0/0 | — |
