# Plugin review: used by and what breaks

Generated 2026-11-12T18:06:26.787Z from deps.json by reverse.mjs. 66 console plugins.

Severity: **hard** = a dependent stops working (required capability, or an action it dispatches); **degrades** = a dependent loses a feature but keeps running (optional or undeclared capability, or an event it listens for; undeclared ones are marked because the Plugin Manager cannot warn before removal); **silenced** = events this plugin listens for go unheard; **shell** = the console shell or framework names the plugin by path.

Core = removal breaks the shell, the framework or another plugin hard; or the plugin provides a framework contract (control@1, plugin-commands@1, console-commands@1); or 5+ plugins use it.

## Summary

| Tier | Count | Plugins |
|---|---|---|
| core | 14 | plugin-switches, agent-manager, ai-assistant, container-access, build-orchestrator, console-terminal, token-control, theme-manager, systems-check, codebase-changes, console-commands, plugin-commands, follow-amber, plugin-manager |
| shared | 14 | agent-swarm, claude-settings, agent-voice, ai-keys, snapshot-manager, ui-review, agent-slots, claude-accounts, notify-control, plan-studio, activity, feature-assist, notes-browser, push-banner |
| leaf | 38 | alerts-bell, amberx-listeners, approvals-banner, audio-extract, basic-filter, brand-library, build-breaker, build-profiles, builds-page, changes-grid, chat-viewer, claude-badge, claude-handoff, claude-session, context-menu-designer, crew-live, demonstration-designer, fable-rebuilds, feature-matrix, github-app, glossary-index, hub-sync, main-build-status, maintenance, mcp-client, md-studio, molly-guide, output-recorder, plugin-update, plugins-menu, project-wizard, ref-links, session-checkin, shipped-features, theme-editor, todo-manager, voice-notes, whats-shipped |

Undeclared dependencies (real lookups missing from the consumer's plugin.json): 36.

## Core plugins

| Plugin | Why core | Breaks hard | Cascade |
|---|---|---|---|
| plugin-switches | hard dependents: ai-assistant, basic-filter | ai-assistant (plugin-switches.open), basic-filter (plugin-switches.open) | agent-voice, ai-assistant, basic-filter |
| agent-manager | hard dependents: claude-accounts; used by 11 plugins | claude-accounts (axf.vinny@1, required) | claude-accounts |
| ai-assistant | named by the console shell / framework: apps/console-web/src/axf/core/assistant.ts; hard dependents: agent-voice; used by 8 plugins | agent-voice (ai-assistant.open) | agent-voice |
| container-access | hard dependents: snapshot-manager; used by 6 plugins | snapshot-manager (axf.containers@1, required) | snapshot-manager |
| build-orchestrator | hard dependents: systems-check | systems-check (build-orchestrator.open) | systems-check |
| console-terminal | hard dependents: claude-accounts | claude-accounts (axf.headless@1, required), claude-accounts (terminal.claude) | claude-accounts |
| token-control | hard dependents: claude-settings; provides framework contract control@1 | claude-settings (control@1, required) | claude-settings |
| theme-manager | hard dependents: theme-editor | theme-editor (axf.token-tree@1, required) | theme-editor |
| systems-check | used by 11 plugins | - | - |
| codebase-changes | used by 5 plugins | - | - |
| console-commands | provides framework contract console-commands@1 | - | - |
| plugin-commands | provides framework contract plugin-commands@1 | - | - |
| follow-amber | named by the console shell / framework: apps/console-web/server/mcp_server.py | - | - |
| plugin-manager | named by the console shell / framework: apps/console-web/src/pluginLoader.tsx | - | - |

## Reverse map

| Plugin | Tier | Used by | Hard | Degrades |
|---|---|---|---|---|
| plugin-switches | core | 2 | 2 | 0 |
| agent-manager | core | 11 | 1 | 13 |
| ai-assistant | core | 8 | 1 | 7 |
| container-access | core | 6 | 1 | 5 |
| build-orchestrator | core | 4 | 1 | 4 |
| console-terminal | core | 3 | 2 | 2 |
| token-control | core | 3 | 1 | 2 |
| theme-manager | core | 1 | 1 | 0 |
| systems-check | core | 11 | 0 | 13 |
| codebase-changes | core | 5 | 0 | 5 |
| console-commands | core | 4 | 0 | 4 |
| plugin-commands | core | 1 | 0 | 1 |
| follow-amber | core | 0 | 0 | 0 |
| plugin-manager | core | 0 | 0 | 0 |
| agent-swarm | shared | 4 | 0 | 4 |
| claude-settings | shared | 4 | 0 | 4 |
| agent-voice | shared | 3 | 0 | 3 |
| ai-keys | shared | 3 | 0 | 3 |
| snapshot-manager | shared | 3 | 0 | 3 |
| ui-review | shared | 3 | 0 | 3 |
| agent-slots | shared | 2 | 0 | 2 |
| claude-accounts | shared | 2 | 0 | 2 |
| notify-control | shared | 2 | 0 | 2 |
| plan-studio | shared | 2 | 0 | 2 |
| activity | shared | 1 | 0 | 1 |
| feature-assist | shared | 1 | 0 | 1 |
| notes-browser | shared | 1 | 0 | 1 |
| push-banner | shared | 1 | 0 | 1 |
| alerts-bell | leaf | 0 | 0 | 0 |
| amberx-listeners | leaf | 0 | 0 | 0 |
| approvals-banner | leaf | 0 | 0 | 0 |
| audio-extract | leaf | 0 | 0 | 0 |
| basic-filter | leaf | 0 | 0 | 0 |
| brand-library | leaf | 0 | 0 | 0 |
| build-breaker | leaf | 0 | 0 | 0 |
| build-profiles | leaf | 0 | 0 | 0 |
| builds-page | leaf | 0 | 0 | 0 |
| changes-grid | leaf | 0 | 0 | 0 |
| chat-viewer | leaf | 0 | 0 | 0 |
| claude-badge | leaf | 0 | 0 | 0 |
| claude-handoff | leaf | 0 | 0 | 0 |
| claude-session | leaf | 0 | 0 | 0 |
| context-menu-designer | leaf | 0 | 0 | 0 |
| crew-live | leaf | 0 | 0 | 0 |
| demonstration-designer | leaf | 0 | 0 | 0 |
| fable-rebuilds | leaf | 0 | 0 | 0 |
| feature-matrix | leaf | 0 | 0 | 0 |
| github-app | leaf | 0 | 0 | 0 |
| glossary-index | leaf | 0 | 0 | 0 |
| hub-sync | leaf | 0 | 0 | 0 |
| main-build-status | leaf | 0 | 0 | 0 |
| maintenance | leaf | 0 | 0 | 0 |
| mcp-client | leaf | 0 | 0 | 0 |
| md-studio | leaf | 0 | 0 | 0 |
| molly-guide | leaf | 0 | 0 | 0 |
| output-recorder | leaf | 0 | 0 | 0 |
| plugin-update | leaf | 0 | 0 | 0 |
| plugins-menu | leaf | 0 | 0 | 0 |
| project-wizard | leaf | 0 | 0 | 0 |
| ref-links | leaf | 0 | 0 | 0 |
| session-checkin | leaf | 0 | 0 | 0 |
| shipped-features | leaf | 0 | 0 | 0 |
| theme-editor | leaf | 0 | 0 | 0 |
| todo-manager | leaf | 0 | 0 | 0 |
| voice-notes | leaf | 0 | 0 | 0 |
| whats-shipped | leaf | 0 | 0 | 0 |

## Per plugin

### plugin-switches (core)

Plugin switches. Tier: core.

| | |
|---|---|
| Why core | hard dependents: ai-assistant, basic-filter |
| Used by | ai-assistant, basic-filter |
| Breaks: hard | ai-assistant (plugin-switches.open), basic-filter (plugin-switches.open) |
| Cascade | agent-voice, ai-assistant, basic-filter |
| Fix / check | folder word quoted in apps/console-web/server/test_plugin_catalog.py (check by hand) |

### agent-manager (core)

Agent manager. Tier: core. Provides axf.agents@1, axf.hub-runs@1, axf.vinny@1.

| | |
|---|---|
| Why core | hard dependents: claude-accounts; used by 11 plugins |
| Used by | agent-voice, ai-assistant, ai-keys, claude-accounts, claude-badge, console-terminal, feature-assist, molly-guide, push-banner, ref-links, systems-check |
| Breaks: hard | claude-accounts (axf.vinny@1, required) |
| Breaks: degrades | agent-voice (axf.agents@1), ai-assistant (axf.agents@1), ai-keys (axf.vinny@1), claude-badge (axf.vinny@1), console-terminal (axf.hub-runs@1, undeclared), feature-assist (axf.agents@1), molly-guide (axf.agents@1, undeclared), molly-guide (axf.vinny@1, undeclared), push-banner (axf.agents@1, undeclared), push-banner (axf.vinny@1, undeclared), ref-links (axf.agents@1), systems-check (axf.agents@1), systems-check (axf.vinny@1, undeclared) |
| Cascade | claude-accounts |
| Fix / check | console-terminal uses axf.hub-runs@1 without declaring it; molly-guide uses axf.agents@1 without declaring it; molly-guide uses axf.vinny@1 without declaring it; push-banner uses axf.agents@1 without declaring it; push-banner uses axf.vinny@1 without declaring it; systems-check uses axf.vinny@1 without declaring it; provides axf.hub-runs@1 in code but not in plugin.json; provides axf.vinny@1 in code but not in plugin.json; folder word quoted in framework/core/engines/card-rules.mjs (check by hand) |

### ai-assistant (core)

AI assistant. Tier: core. Provides axf.llm@1, axf.live-sessions@1.

| | |
|---|---|
| Why core | named by the console shell / framework: apps/console-web/src/axf/core/assistant.ts; hard dependents: agent-voice; used by 8 plugins |
| Used by | activity, agent-manager, agent-voice, claude-badge, feature-assist, maintenance, plan-studio, systems-check |
| Breaks: shell / framework | apps/console-web/src/axf/core/assistant.ts: 18: * module/plugin — in the console, plugins/ai-assistant (capability `axf.llm@1`). Nothing here is / 451: /** base URL of the assistant API, e.g. `/api/plugins/ai-assistant` (no trailing slash) */ |
| Breaks: hard | agent-voice (ai-assistant.open) |
| Breaks: degrades | activity (axf.live-sessions@1), agent-manager (axf.llm@1), claude-badge (axf.llm@1), feature-assist (axf.llm@1), maintenance (axf.llm@1, undeclared), plan-studio (axf.llm@1), systems-check (axf.llm@1) |
| Silenced | axf:assistant.focus from agent-voice |
| Cascade | agent-voice |
| Fix / check | maintenance uses axf.llm@1 without declaring it; folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand); folder word quoted in apps/console-web/server/plugin_services.py (check by hand); folder word quoted in framework/core/engines/card-rules.mjs (check by hand) |

### container-access (core)

Container access. Tier: core. Provides axf.containers@1.

| | |
|---|---|
| Why core | hard dependents: snapshot-manager; used by 6 plugins |
| Used by | agent-manager, ai-assistant, console-terminal, feature-assist, snapshot-manager, systems-check |
| Breaks: hard | snapshot-manager (axf.containers@1, required) |
| Breaks: degrades | agent-manager (axf.containers@1), ai-assistant (axf.containers@1), console-terminal (axf.containers@1), feature-assist (axf.containers@1), systems-check (axf.containers@1, undeclared) |
| Cascade | snapshot-manager |
| Fix / check | systems-check uses axf.containers@1 without declaring it |

### build-orchestrator (core)

Build orchestrator. Tier: core. Provides orchestrator@1, axf.build-dispatch@1, console-focus@1.

| | |
|---|---|
| Why core | hard dependents: systems-check |
| Used by | console-commands, feature-assist, push-banner, systems-check |
| Breaks: hard | systems-check (build-orchestrator.open) |
| Breaks: degrades | console-commands (console-focus@1, undeclared), feature-assist (axf.build-dispatch@1, undeclared), push-banner (axf.build-dispatch@1, undeclared), systems-check (axf.build-dispatch@1, undeclared) |
| Cascade | systems-check |
| Fix / check | console-commands uses console-focus@1 without declaring it; feature-assist uses axf.build-dispatch@1 without declaring it; push-banner uses axf.build-dispatch@1 without declaring it; systems-check uses axf.build-dispatch@1 without declaring it; provides console-focus@1 in code but not in plugin.json; declares orchestrator@1 but no provide call found (check by hand: may be web-side or a data contract); folder word quoted in apps/console-web/server/mcp_server.py (check by hand); folder word quoted in apps/console-web/server/test_mcp_tools.py (check by hand); folder word quoted in framework/core/build-priority.mjs (check by hand); folder word quoted in framework/core/engines/card-rules.mjs (check by hand); folder word quoted in framework/core/headless-context.mjs (check by hand) |

### console-terminal (core)

Terminal. Tier: core. Provides axf.headless@1, axf.session-feed@1.

| | |
|---|---|
| Why core | hard dependents: claude-accounts |
| Used by | claude-accounts, claude-badge, crew-live |
| Breaks: hard | claude-accounts (axf.headless@1, required), claude-accounts (terminal.claude) |
| Breaks: degrades | claude-badge (axf.headless@1), crew-live (axf.headless@1) |
| Cascade | claude-accounts |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |

### token-control (core)

Token control. Tier: core. Provides control@1.

| | |
|---|---|
| Why core | hard dependents: claude-settings; provides framework contract control@1 |
| Used by | claude-settings, notify-control, plugin-commands |
| Breaks: hard | claude-settings (control@1, required) |
| Breaks: degrades | notify-control (control@1), plugin-commands (control@1) |
| Cascade | claude-settings |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |

### theme-manager (core)

Theme manager. Tier: core. Provides axf.token-tree@1.

| | |
|---|---|
| Why core | hard dependents: theme-editor |
| Used by | theme-editor |
| Breaks: hard | theme-editor (axf.token-tree@1, required) |
| Cascade | theme-editor |
| Fix / check | folder word quoted in framework/cli/plugin-instances.mjs (check by hand) |

### systems-check (core)

Systems check banner. Tier: core. Provides axf.syscheck@1, axf.health@1, axf.github@1.

| | |
|---|---|
| Why core | used by 11 plugins |
| Used by | activity, agent-slots, approvals-banner, build-orchestrator, claude-accounts, console-terminal, github-app, maintenance, output-recorder, push-banner, ui-review |
| Breaks: degrades | activity (axf.github@1, undeclared), activity (axf.health@1, undeclared), agent-slots (axf.health@1), approvals-banner (axf.health@1, undeclared), build-orchestrator (axf.health@1, undeclared), claude-accounts (axf.health@1, undeclared), console-terminal (axf.health@1, undeclared), github-app (axf.health@1), maintenance (axf.health@1), output-recorder (axf.health@1, undeclared), push-banner (axf.github@1, undeclared), push-banner (axf.health@1, undeclared), ui-review (axf.health@1, undeclared) |
| Fix / check | activity uses axf.github@1 without declaring it; activity uses axf.health@1 without declaring it; approvals-banner uses axf.health@1 without declaring it; build-orchestrator uses axf.health@1 without declaring it; claude-accounts uses axf.health@1 without declaring it; console-terminal uses axf.health@1 without declaring it; output-recorder uses axf.health@1 without declaring it; push-banner uses axf.github@1 without declaring it; push-banner uses axf.health@1 without declaring it; ui-review uses axf.health@1 without declaring it; declares axf.github@1 but no provide call found (check by hand: may be web-side or a data contract); folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |

### codebase-changes (core)

Codebase changes banner. Tier: core. Provides axf.changes@1.

| | |
|---|---|
| Why core | used by 5 plugins |
| Used by | activity, changes-grid, feature-matrix, push-banner, systems-check |
| Breaks: degrades | activity (axf.changes@1), changes-grid (axf.changes@1), feature-matrix (axf.changes@1), push-banner (axf.changes@1, undeclared), systems-check (axf.changes@1, undeclared) |
| Fix / check | push-banner uses axf.changes@1 without declaring it; systems-check uses axf.changes@1 without declaring it; folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand); folder word quoted in framework/core/engines/card-rules.mjs (check by hand); folder word quoted in framework/core/headless-context.mjs (check by hand) |

### console-commands (core)

Console commands. Tier: core. Provides console-commands@1.

| | |
|---|---|
| Why core | provides framework contract console-commands@1 |
| Used by | follow-amber, plugin-commands, ref-links, token-control |
| Breaks: degrades | follow-amber (console-commands@1), plugin-commands (console-commands@1), ref-links (console-commands@1), token-control (console-commands@1, undeclared) |
| Fix / check | token-control uses console-commands@1 without declaring it; folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |

### plugin-commands (core)

Plugin commands. Tier: core. Provides plugin-commands@1.

| | |
|---|---|
| Why core | provides framework contract plugin-commands@1 |
| Used by | token-control |
| Breaks: degrades | token-control (plugin-commands@1, undeclared) |
| Fix / check | token-control uses plugin-commands@1 without declaring it; folder word quoted in apps/console-web/src/views/HomeCards.tsx (check by hand) |

### follow-amber (core)

Follow Amber. Tier: core. Provides follow-amber@1.

| | |
|---|---|
| Why core | named by the console shell / framework: apps/console-web/server/mcp_server.py |
| Used by | nothing |
| Breaks: shell / framework | apps/console-web/server/mcp_server.py: 1062: base = os.environ.get("AXF_CONSOLE_URL", "https://console.amberxai.com").rstrip("/") + "/api/p |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |

### plugin-manager (core)

Plugin Manager. Tier: core.

| | |
|---|---|
| Why core | named by the console shell / framework: apps/console-web/src/pluginLoader.tsx |
| Used by | nothing |
| Breaks: shell / framework | apps/console-web/src/pluginLoader.tsx: 487: void fetch('/api/plugins/plugin-manager/lazy/report', { method: 'POST', headers: authHeaders(co / 494: const r = await fetch('/api/plugins/plugin-manager/lazy', { headers: authHeaders(consoleTokens, |
| Fix / check | folder word quoted in apps/console-web/src/axf/core/engines/embed.ts (check by hand); folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand); folder word quoted in framework/cli/rebuild-shots.mjs (check by hand) |

### agent-swarm

Agent swarm. Tier: shared. Provides agent-jobs@1, axf.crew@1, axf.swarm-roster@1, crew-sections@1, axf.crew-sections@1.

| | |
|---|---|
| Used by | claude-session, crew-live, notify-control, systems-check |
| Breaks: degrades | claude-session (axf.crew@1), crew-live (axf.swarm-roster@1), notify-control (axf.crew-sections@1, undeclared), systems-check (axf.crew-sections@1, undeclared) |
| Fix / check | notify-control uses axf.crew-sections@1 without declaring it; systems-check uses axf.crew-sections@1 without declaring it; declares agent-jobs@1 but no provide call found (check by hand: may be web-side or a data contract); declares crew-sections@1 but no provide call found (check by hand: may be web-side or a data contract); folder word quoted in framework/core/engines/card-rules.mjs (check by hand) |

### claude-settings

Claude. Tier: shared. Provides axf.claude-settings@1.

| | |
|---|---|
| Used by | claude-session, notify-control, output-recorder, ui-review |
| Breaks: degrades | claude-session (axf.claude-settings@1, undeclared), notify-control (axf.claude-settings@1), output-recorder (axf.claude-settings@1, undeclared), ui-review (axf.claude-settings@1, undeclared) |
| Fix / check | claude-session uses axf.claude-settings@1 without declaring it; output-recorder uses axf.claude-settings@1 without declaring it; ui-review uses axf.claude-settings@1 without declaring it; folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand); folder word quoted in apps/console-web/server/mcp_server.py (check by hand); folder word quoted in framework/cli/rules-brief.mjs (check by hand) |

### agent-voice

Agent voice. Tier: shared. Provides axf.agent-voice@1, axf.speech@1.

| | |
|---|---|
| Used by | ai-assistant, demonstration-designer, plan-studio |
| Breaks: degrades | ai-assistant (axf:assistant.focus), demonstration-designer (axf.speech@1), plan-studio (axf.agent-voice@1) |
| Silenced | axf:agent-voice.say from plan-studio |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |

### ai-keys

AI keys. Tier: shared. Provides axf.ai-keys@1.

| | |
|---|---|
| Used by | ai-assistant, claude-badge, systems-check |
| Breaks: degrades | ai-assistant (axf.ai-keys@1, undeclared), claude-badge (axf.ai-keys@1), systems-check (axf.ai-keys@1, undeclared) |
| Fix / check | ai-assistant uses axf.ai-keys@1 without declaring it; systems-check uses axf.ai-keys@1 without declaring it |

### snapshot-manager

Snapshot Manager. Tier: shared. Provides axf.snapshots@1.

| | |
|---|---|
| Used by | agent-manager, container-access, feature-assist |
| Breaks: degrades | agent-manager (axf.snapshots@1), container-access (axf.snapshots@1), feature-assist (axf.snapshots@1) |

### ui-review

UI Review. Tier: shared. Provides ui-review@1, ui-screenshots@1.

| | |
|---|---|
| Used by | build-orchestrator, push-banner, ref-links |
| Breaks: degrades | build-orchestrator (ui-review@1), push-banner (ui-review@1, undeclared), ref-links (ui-review@1) |
| Fix / check | push-banner uses ui-review@1 without declaring it; declares ui-screenshots@1 but no provide call found (check by hand: may be web-side or a data contract); folder word quoted in framework/core/build-priority.mjs (check by hand); folder word quoted in framework/core/engines/card-rules.mjs (check by hand); folder word quoted in framework/core/headless-context.mjs (check by hand); folder word quoted in framework/core/ui-predict.mjs (check by hand) |

### agent-slots

Agent cap. Tier: shared. Provides axf.agent-slots@1.

| | |
|---|---|
| Used by | build-orchestrator, claude-session |
| Breaks: degrades | build-orchestrator (axf.agent-slots@1), claude-session (axf.agent-slots@1) |
| Fix / check | folder word quoted in framework/cli/agent-slots.mjs (check by hand); folder word quoted in framework/cli/build-limit.mjs (check by hand) |

### claude-accounts

Claude accounts. Tier: shared. Provides axf.claude-accounts@1.

| | |
|---|---|
| Used by | ai-keys, claude-badge |
| Breaks: degrades | ai-keys (axf.claude-accounts@1), claude-badge (axf.claude-accounts@1) |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |

### notify-control

Notifications. Tier: shared. Provides axf.notify@1.

| | |
|---|---|
| Used by | activity, follow-amber |
| Breaks: degrades | activity (axf.notify@1, undeclared), follow-amber (axf.notify@1, undeclared) |
| Fix / check | activity uses axf.notify@1 without declaring it; follow-amber uses axf.notify@1 without declaring it; folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |

### plan-studio

Plan Studio. Tier: shared. Provides plans@1.

| | |
|---|---|
| Used by | agent-voice, build-orchestrator |
| Breaks: degrades | agent-voice (axf:agent-voice.say), build-orchestrator (plans@1) |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand); folder word quoted in apps/console-web/server/mcp_server.py (check by hand); folder word quoted in framework/core/build-priority.mjs (check by hand) |

### activity

Activity banner. Tier: shared. Provides axf.activity@1.

| | |
|---|---|
| Used by | push-banner |
| Breaks: degrades | push-banner (axf.activity@1) |
| Fix / check | folder word quoted in apps/console-web/src/axf/libs/hubsync/index.tsx (check by hand); folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |

### feature-assist

Feature assistant. Tier: shared.

| | |
|---|---|
| Used by | fable-rebuilds |
| Breaks: degrades | fable-rebuilds (axf:plan-changed) |

### notes-browser

Notes. Tier: shared. Provides axf.notes@1.

| | |
|---|---|
| Used by | md-studio |
| Breaks: degrades | md-studio (axf.notes@1) |
| Fix / check | folder word quoted in framework/core/engines/card-rules.mjs (check by hand) |

### push-banner

Push banner. Tier: shared. Provides axf.merge-queue@1.

| | |
|---|---|
| Used by | build-orchestrator |
| Breaks: degrades | build-orchestrator (axf.merge-queue@1) |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |

### alerts-bell

Alerts bell. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |
| Removal | safe: nothing else breaks |

### amberx-listeners

AmberX listeners. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### approvals-banner

Approvals banner. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand); folder word quoted in framework/core/engines/card-rules.mjs (check by hand) |
| Removal | safe: nothing else breaks |

### audio-extract

Audio Extract. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### basic-filter

Basic filter. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### brand-library

Brand library. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in framework/cli/brand-gen.mjs (check by hand) |
| Removal | safe: nothing else breaks |

### build-breaker

Build Breaker. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### build-profiles

Build profiles. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |
| Removal | safe: nothing else breaks |

### builds-page

Builds. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand); folder word quoted in framework/core/engines/card-rules.mjs (check by hand) |
| Removal | safe: nothing else breaks |

### changes-grid

Changes & features grid. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### chat-viewer

Chat viewer. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### claude-badge

Badges. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |
| Removal | safe: nothing else breaks |

### claude-handoff

Claude handoff banner. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |
| Removal | safe: nothing else breaks |

### claude-session

Claude sessions. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### context-menu-designer

Context menu designer. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### crew-live

Crew. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in apps/console-web/src/axf/core/agent-directory.ts (check by hand) |
| Removal | safe: nothing else breaks |

### demonstration-designer

Demonstration Designer. Tier: leaf. Provides demonstrations@1.

| | |
|---|---|
| Used by | nothing |
| Fix / check | malformed provide string service:demonstrations@1 |
| Removal | safe: nothing else breaks |

### fable-rebuilds

Fable rebuilds. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Silenced | axf:plan-changed from feature-assist |
| Removal | safe: nothing else breaks |

### feature-matrix

Feature matrix. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### github-app

GitHub. Tier: leaf. Provides axf.github-app@1.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in framework/cli/github-app.mjs (check by hand); folder word quoted in framework/cli/github.mjs (check by hand) |
| Removal | safe: nothing else breaks |

### glossary-index

Glossary, Index & Demos. Tier: leaf. Provides glossary@1.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### hub-sync

axHub sync. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### main-build-status

Main build status. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |
| Removal | safe: nothing else breaks |

### maintenance

Maintenance. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in framework/core/engines/card-rules.mjs (check by hand) |
| Removal | safe: nothing else breaks |

### mcp-client

MCP client. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### md-studio

MD Studio. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### molly-guide

Molly guide. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### output-recorder

Audio Output Recorder. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### plugin-update

Plugin Update. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### plugins-menu

Plugins menu. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |
| Removal | safe: nothing else breaks |

### project-wizard

Project wizard. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### ref-links

Reference links. Tier: leaf. Provides ref-links@1.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### session-checkin

Session check-in. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### shipped-features

Shipped features. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |
| Removal | safe: nothing else breaks |

### theme-editor

Theme editor. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### todo-manager

Todo manager. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Removal | safe: nothing else breaks |

### voice-notes

Voice notes. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in framework/core/engines/control-rules.mjs (check by hand) |
| Removal | safe: nothing else breaks |

### whats-shipped

What's new. Tier: leaf.

| | |
|---|---|
| Used by | nothing |
| Fix / check | folder word quoted in apps/console-web/src/lazyEngine.ts (check by hand) |
| Removal | safe: nothing else breaks |
