# Plugin review, step 1: declared and real dependencies

Generated 2026-11-12T18:02:04.454Z by `extract.mjs` from 66 console plugins (read-only). Data: `deps.json` (plugin-review-deps@1).

## Totals

| | Count |
|---|---|
| Plugins | 66 |
| With a server part | 58 |
| With a web part | 66 |
| Provide a capability service (declared) | 29 |
| Look up a capability service in code | 36 |
| Use a service they never declare (requires / optional) | 18 |
| Declare a dependency the code never uses | 4 |
| Call another plugin by folder name (REST route or Python import) | 0 |
| Named by the console shell or framework by folder | 3 |
| Declare a service their code never provides | 4 |
| Missing README | 41 |
| Missing install.mjs or uninstall.mjs | 2 |

## Capability providers

| Capability | Provided by |
|---|---|
| `agent-jobs@1` | agent-swarm |
| `axf.activity@1` | activity |
| `axf.agent-slots@1` | agent-slots |
| `axf.agent-voice@1` | agent-voice |
| `axf.agents@1` | agent-manager |
| `axf.ai-keys@1` | ai-keys |
| `axf.build-dispatch@1` | build-orchestrator |
| `axf.changes@1` | codebase-changes |
| `axf.claude-accounts@1` | claude-accounts |
| `axf.claude-settings@1` | claude-settings |
| `axf.containers@1` | container-access |
| `axf.crew-sections@1` | agent-swarm |
| `axf.crew@1` | agent-swarm |
| `axf.github-app@1` | github-app |
| `axf.github@1` | systems-check |
| `axf.headless@1` | console-terminal |
| `axf.health@1` | systems-check |
| `axf.hub-runs@1` | agent-manager |
| `axf.live-sessions@1` | ai-assistant |
| `axf.llm@1` | ai-assistant |
| `axf.merge-queue@1` | push-banner |
| `axf.notes@1` | notes-browser |
| `axf.notify@1` | notify-control |
| `axf.session-feed@1` | console-terminal |
| `axf.snapshots@1` | snapshot-manager |
| `axf.speech@1` | agent-voice |
| `axf.swarm-roster@1` | agent-swarm |
| `axf.syscheck@1` | systems-check |
| `axf.token-tree@1` | theme-manager |
| `axf.vinny@1` | agent-manager |
| `console-commands@1` | console-commands |
| `console-focus@1` | build-orchestrator |
| `control@1` | token-control |
| `crew-sections@1` | agent-swarm |
| `demonstrations@1` | demonstration-designer |
| `follow-amber@1` | follow-amber |
| `glossary@1` | glossary-index |
| `orchestrator@1` | build-orchestrator |
| `plans@1` | plan-studio |
| `plugin-commands@1` | plugin-commands |
| `ref-links@1` | ref-links |
| `service:demonstrations@1` | demonstration-designer |
| `ui-review@1` | ui-review |
| `ui-screenshots@1` | ui-review |

## Per plugin

Declared = plugin.json requires / optional / dependsOn. Real = what the code looks up or calls. Folder couplings break the capability rule.

| Plugin | Server | Web | Provides (services) | Declared deps | Real service lookups | Undeclared | Declared, unused | Folder couplings | Routes | Commands |
|---|---|---|---|---|---|---|---|---|---|---|
| **activity** | py | tsx | `axf.activity@1` | `axf.changes@1` `axf.live-sessions@1` `axf.syscheck@1` | `axf.changes@1` `axf.github@1` `axf.health@1` `axf.live-sessions@1` `axf.notify@1` | `axf.github@1` `axf.health@1` `axf.notify@1` | `axf.syscheck@1` |  | 11 | auto |
| **agent-manager** | py | tsx | `axf.agents@1` | `axf.llm@1` `axf.containers@1` `axf.snapshots@1` | `axf.containers@1` `axf.llm@1` `axf.snapshots@1` |  |  |  | 50 | auto |
| **agent-slots** | py | tsx | `axf.agent-slots@1` | `axf.health@1` | `axf.health@1` |  |  |  | 7 | auto+2 |
| **agent-swarm** | py | tsx | `agent-jobs@1` `axf.crew@1` `axf.swarm-roster@1` `crew-sections@1` `axf.crew-sections@1` |  |  |  |  |  | 10 | auto |
| **agent-voice** | py | tsx | `axf.agent-voice@1` `axf.speech@1` | `axf.agents@1` | `axf.agents@1` |  |  |  | 13 | auto |
| **ai-assistant** | py | tsx | `axf.llm@1` `axf.live-sessions@1` | `axf.agents@1` `axf.containers@1` `axf.live-host@1` | `axf.agents@1` `axf.ai-keys@1` `axf.containers@1` | `axf.ai-keys@1` | `axf.live-host@1` |  | 39 | auto |
| **ai-keys** | py | tsx | `axf.ai-keys@1` | `axf.llm@1` `axf.vinny@1` `axf.claude-accounts@1` | `axf.claude-accounts@1` `axf.vinny@1` |  | `axf.llm@1` |  | 11 | auto |
| **alerts-bell** |  | tsx |  |  |  |  |  |  | 0 | auto |
| **amberx-listeners** | py | tsx |  |  |  |  |  |  | 6 | auto+6 |
| **approvals-banner** | py | tsx |  |  | `axf.health@1` | `axf.health@1` |  |  | 2 | auto |
| **audio-extract** |  | tsx |  |  |  |  |  |  | 0 | auto |
| **basic-filter** |  | tsx |  |  |  |  |  |  | 0 | auto |
| **brand-library** | py | tsx |  |  |  |  |  |  | 5 | auto |
| **build-breaker** | py | tsx |  |  |  |  |  |  | 1 | auto |
| **build-orchestrator** | py | tsx | `orchestrator@1` `axf.build-dispatch@1` | `axf.agent-slots@1` `axf.merge-queue@1` `plans@1` `ui-review@1` | `axf.agent-slots@1` `axf.health@1` `axf.merge-queue@1` `plans@1` `ui-review@1` | `axf.health@1` |  |  | 24 | auto+20 |
| **build-profiles** |  | tsx |  |  |  |  |  |  | 0 | auto |
| **builds-page** | py | tsx |  |  |  |  |  |  | 9 | auto |
| **changes-grid** | py | tsx |  | `axf.changes@1` | `axf.changes@1` |  |  |  | 2 | auto |
| **chat-viewer** | py | tsx |  |  |  |  |  |  | 22 | auto |
| **claude-accounts** | py | tsx | `axf.claude-accounts@1` | `axf.headless@1` `axf.vinny@1` | `axf.headless@1` `axf.health@1` `axf.vinny@1` | `axf.health@1` |  |  | 14 | auto+14 |
| **claude-badge** | py | tsx |  | `axf.llm@1` `axf.claude-accounts@1` `axf.ai-keys@1` `axf.headless@1` `axf.vinny@1` | `axf.ai-keys@1` `axf.claude-accounts@1` `axf.headless@1` `axf.llm@1` `axf.vinny@1` |  |  |  | 5 | auto |
| **claude-handoff** | py | tsx |  |  |  |  |  |  | 21 | auto |
| **claude-session** | py | tsx |  | `axf.crew@1` `axf.agent-slots@1` | `axf.agent-slots@1` `axf.claude-settings@1` `axf.crew@1` | `axf.claude-settings@1` |  |  | 10 | auto+3 |
| **claude-settings** | py | tsx | `axf.claude-settings@1` | `control@1` | `control@1` |  |  |  | 4 | auto |
| **codebase-changes** | py | tsx | `axf.changes@1` |  |  |  |  |  | 10 | auto |
| **console-commands** | py | tsx | `console-commands@1` |  | `console-focus@1` | `console-focus@1` |  |  | 21 | auto |
| **console-terminal** | py | tsx | `axf.headless@1` `axf.session-feed@1` | `axf.containers@1` | `axf.containers@1` `axf.health@1` `axf.hub-runs@1` | `axf.health@1` `axf.hub-runs@1` |  |  | 26 | auto+8 |
| **container-access** | py | tsx | `axf.containers@1` | `axf.snapshots@1` | `axf.snapshots@1` |  |  |  | 13 | auto |
| **context-menu-designer** | py | tsx |  |  |  |  |  |  | 3 | auto |
| **crew-live** | py | tsx |  | `axf.headless@1` `axf.swarm-roster@1` | `axf.headless@1` `axf.swarm-roster@1` |  |  |  | 6 | auto+5 |
| **demonstration-designer** | py | tsx | `demonstrations@1` | `axf.speech@1` | `axf.speech@1` |  |  |  | 19 | auto+19 |
| **fable-rebuilds** | py | tsx |  |  |  |  |  |  | 3 | auto |
| **feature-assist** | py | tsx |  | `axf.llm@1` `axf.agents@1` `axf.containers@1` `axf.snapshots@1` | `axf.agents@1` `axf.build-dispatch@1` `axf.containers@1` `axf.llm@1` `axf.snapshots@1` | `axf.build-dispatch@1` |  |  | 7 | auto |
| **feature-matrix** | py | tsx |  | `axf.changes@1` | `axf.changes@1` |  |  |  | 6 | auto |
| **follow-amber** | py | tsx | `follow-amber@1` | `console-commands@1` | `axf.notify@1` `console-commands@1` | `axf.notify@1` |  |  | 6 | auto+5 |
| **github-app** | py | tsx | `axf.github-app@1` | `axf.health@1` | `axf.health@1` |  |  |  | 8 | auto |
| **glossary-index** | py | tsx | `glossary@1` |  |  |  |  |  | 20 | auto+19 |
| **hub-sync** |  | tsx |  |  |  |  |  |  | 0 | auto |
| **main-build-status** | py | tsx |  |  |  |  |  |  | 3 | auto |
| **maintenance** | py | tsx |  | `axf.health@1` | `axf.health@1` `axf.llm@1` | `axf.llm@1` |  |  | 15 | auto+15 |
| **mcp-client** | py | tsx |  |  |  |  |  |  | 8 | auto |
| **md-studio** | py | tsx |  | `axf.notes@1` | `axf.notes@1` |  |  |  | 8 | auto+11 |
| **molly-guide** | py | tsx |  |  | `axf.agents@1` `axf.vinny@1` | `axf.agents@1` `axf.vinny@1` |  |  | 4 | auto |
| **notes-browser** | py | tsx | `axf.notes@1` |  |  |  |  |  | 8 | auto |
| **notify-control** | py | tsx | `axf.notify@1` | `control@1` `axf.claude-settings@1` | `axf.claude-settings@1` `axf.crew-sections@1` `control@1` | `axf.crew-sections@1` |  |  | 17 | auto+17 |
| **output-recorder** | py | tsx |  |  | `axf.claude-settings@1` `axf.health@1` | `axf.claude-settings@1` `axf.health@1` |  |  | 2 | auto |
| **plan-studio** | py | tsx | `plans@1` | `axf.llm@1` `axf.agent-voice@1` | `axf.llm@1` |  |  |  | 5 | auto |
| **plugin-commands** | py | tsx | `plugin-commands@1` | `control@1` `console-commands@1` | `console-commands@1` `control@1` |  |  |  | 7 | auto |
| **plugin-manager** | py | tsx |  |  |  |  |  |  | 9 | auto |
| **plugin-switches** |  | tsx |  |  |  |  |  |  | 0 | auto |
| **plugin-update** |  | tsx |  |  |  |  |  |  | 0 | auto |
| **plugins-menu** | py | tsx |  |  |  |  |  |  | 9 | auto |
| **project-wizard** | py | tsx |  |  |  |  |  |  | 8 | auto |
| **push-banner** | py | tsx | `axf.merge-queue@1` | `axf.activity@1` | `axf.activity@1` `axf.agents@1` `axf.build-dispatch@1` `axf.changes@1` `axf.github@1` `axf.health@1` `axf.vinny@1` `ui-review@1` | `axf.agents@1` `axf.build-dispatch@1` `axf.changes@1` `axf.github@1` `axf.health@1` `axf.vinny@1` `ui-review@1` |  |  | 27 | auto+10 |
| **ref-links** | py | tsx | `ref-links@1` | `console-commands@1` `ui-review@1` `axf.agents@1` | `axf.agents@1` `console-commands@1` `ui-review@1` |  |  |  | 4 | auto+4 |
| **session-checkin** | py | tsx |  |  |  |  |  |  | 9 | auto |
| **shipped-features** | py | tsx |  |  |  |  |  |  | 13 | auto+13 |
| **snapshot-manager** | py | tsx | `axf.snapshots@1` | `axf.containers@1` | `axf.containers@1` |  |  |  | 12 | auto |
| **systems-check** | py | tsx | `axf.syscheck@1` `axf.health@1` `axf.github@1` | `axf.llm@1` `axf.agents@1` | `axf.agents@1` `axf.ai-keys@1` `axf.build-dispatch@1` `axf.changes@1` `axf.containers@1` `axf.crew-sections@1` `axf.llm@1` `axf.vinny@1` | `axf.ai-keys@1` `axf.build-dispatch@1` `axf.changes@1` `axf.containers@1` `axf.crew-sections@1` `axf.vinny@1` |  |  | 31 | auto |
| **theme-editor** | py | tsx |  | `axf.token-tree@1` | `axf.token-tree@1` |  |  |  | 3 | auto |
| **theme-manager** | py | tsx | `axf.token-tree@1` |  |  |  |  |  | 22 | auto |
| **todo-manager** | py | tsx |  |  |  |  |  |  | 15 | auto |
| **token-control** | py | tsx | `control@1` | `plans@1` | `console-commands@1` `plugin-commands@1` | `console-commands@1` `plugin-commands@1` | `plans@1` |  | 21 | auto |
| **ui-review** | py | tsx | `ui-review@1` `ui-screenshots@1` |  | `axf.claude-settings@1` `axf.health@1` | `axf.claude-settings@1` `axf.health@1` |  |  | 15 | auto+15 |
| **voice-notes** |  | tsx |  |  |  |  |  |  | 0 | auto |
| **whats-shipped** | py | tsx |  |  |  |  |  |  | 3 | auto |

## Detail

### activity

**Activity banner** v0.4.0 (ai.amberx.axf.console.activity). A banner at the top of the console whenever anything is built, edited, deleted, pushed, pulled, merged or thought about, queued or running: GitHub Actions runs, the console's own update, AI assistant replies, VPS Auto fix jobs, Codebase changes entries, the push banner's pushes, pulls and merges, Claude Code sessions (thinking, editing, and one line per push/pull/merge/delete/build, after one hook install) and anything else that reports itself. Tap it for every item and its details. When something finishes: a push to the phone through axHub, sound, pop-up, open the banner or the result, and auto-removal after N minutes; closing a finished item moves it to the Codebase changes banner (or deletes it). Every setting is in one collapsible card.

| | |
|---|---|
| Provides (manifest) | banner:activity, service:axf.activity@1, settings-tab:activity |
| Requires / optional / dependsOn | service:axf.changes@1 (optional), service:axf.live-sessions@1 (optional), service:axf.syscheck@1 (optional) |
| Services provided in code | axf.activity@1 (server/__init__.py) |
| Services looked up in code | axf.changes@1 → codebase-changes [optional]; axf.github@1 → systems-check [undeclared]; axf.health@1 → systems-check [undeclared]; axf.live-sessions@1 → ai-assistant [optional]; axf.notify@1 → notify-control [undeclared] |
| Dynamic lookups (variable argument; every capability string in that file counted) | server/__init__.py: get(s["name"]) |
| Actions registered | activity.check, activity.open |
| Banners / slots | banners activity, activity.lifecycle, activity.settings; manifest banner ["activity"] |
| Library contributions (web/index.tsx) | settingsTabs, settingsPanels, appMenu, banners |
| Shared server modules | axf_framework, console_context, plugin_services |
| Routes exposed | 11 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/activity |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json, notify.json |
| Tests / CLI scripts | activity.mjs, hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/memory/STATUS.md (2) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/axf/libs/hubsync/index.tsx (1), apps/console-web/src/lazyEngine.ts (1) |
| Flags | uses undeclared: axf.github@1, axf.health@1, axf.notify@1; declares but never looks up: axf.syscheck@1; named in docs without the axf-plugin tag: _claude/THREADS.md, _claude/rules/RULES.md |

### agent-manager

**Agent manager** v0.2.0 (ai.amberx.axf.console.agent-manager). Create, edit, manage and orchestrate AI agents built from personas, lingo, skills and tools, each with its own persistent memory. Wizards for agents, skills, tools, an all-in-one agent builder and training (Firecrawl, web pages, the repo, MCP). Add-on agents: Mosses (React/TS/Python coder with container write mode), AXF expert, AI expert. Agents follow the framework contract agent-definition@1, so other AXF apps load the same ones. Works with the AI assistant when both are installed.

README: `ai.amberx.axf.console.agent-manager` · Fable rebuild Oct 20 2026 of the Opus build (Oct 18 2026), pending item `agent-manager-plugin`. Web console UI; the **definition format is a framework contract** so every port loads the same agents.

| | |
|---|---|
| Provides (manifest) | view:agent-manager, settings-tab:agent-manager, service:axf.agents@1 |
| Requires / optional / dependsOn | service:axf.llm@1 (optional), service:axf.containers@1 (optional), service:axf.snapshots@1 (optional) |
| Services provided in code | axf.agents@1 (server/__init__.py); axf.hub-runs@1 (server/hubtools.py); axf.vinny@1 (server/vinny.py) |
| Services looked up in code | axf.containers@1 → container-access [optional]; axf.llm@1 → ai-assistant [optional]; axf.snapshots@1 → snapshot-manager [optional] |
| Own capability looked up (self) | axf.agents@1 |
| Actions registered | agent-manager.vinny, agent-manager.wizard |
| Library contributions (web/index.tsx) | views, dialogs, nav, settingsTabs, settingsPanels, appMenu |
| Shared server modules | axf.assistant_host, axf.contracts, axf_framework, plugin_services |
| Routes exposed | 50 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES, NETWORK |
| Data dir | .axf-console/plugins/agent-manager |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1), _claude/memory/docs/rebuilds/agent-manager-plugin.md (1) |
| Folder word quoted in shell / framework (check by hand) | framework/core/engines/card-rules.mjs (1) |
| Flags | provides in code without declaring: axf.hub-runs@1, axf.vinny@1; named in docs without the axf-plugin tag: _claude/THREADS.md |

### agent-slots

**Agent cap** v0.1.0 (ai.amberx.axf.console.agent-slots). A configurable cap on how many headless Claude sessions and builds run at once on the VPS (agent-slots@1, framework/cli/agent-slots.mjs). Extras wait in a queue (FIFO within boss / urgent / normal / low) and start by themselves when a slot frees and memory allows; finished sessions don't count and close by themselves (logs kept). Settings (hot-reloaded): max running agents, max heavy test/build steps at once, memory guard, close-after, priority rules; shown in Settings → Plugins → Agent cap and in the Breakroom (Agent swarm) settings. Slots used / cap in the activity banner's summary, the queue (position, waiting since, Move up, Cancel) on the Builds page, 'waiting for a desk' on swarm agents past the cap, and a systems-check item when the memory guard trips often or swap stays in use. VPS hard build limit (build-limit@1): the host refuses the N+1st headless build whatever the queue thinks (default 8, one config file), runs every build in axf-builds.slice (CPUQuota, MemoryMax) and caps docker test containers; live usage on the settings tab, banner chip and queue title; only Brett's signed-in console changes it.

| | |
|---|---|
| Provides (manifest) | settings-tab:agent-slots, service:axf.agent-slots@1 |
| Requires / optional / dependsOn | service:axf.health@1 (optional) |
| Services provided in code | axf.agent-slots@1 (server/__init__.py) |
| Services looked up in code | axf.health@1 → systems-check [optional] |
| Banners / slots | slots activity.summary, build.queue.top, builds.top, swarm.agent.status, swarm.settings.desks |
| Library contributions (web/index.tsx) | settingsTabs, settingsPanels, appMenu, slots |
| Shared server modules | plugin_services |
| Routes exposed | 7 (0 websocket) |
| Commands (plugin-commands@1) | auto; 2 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/agent-slots |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | CLAUDE.md (1), _claude/THREADS.md (1), _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | framework/cli/agent-slots.mjs (1), framework/cli/build-limit.mjs (1) |

### agent-swarm

**Agent swarm** v0.3.0 (ai.amberx.axf.console.agent-swarm). Headless specialist agents for the Build orchestrator. A roster of agents with one-page skills (Kotlin/Compose, React UI, Python server, plugin manifests, assets/themes, tests, docs, merge-fixer); a job planner that splits a build into jobs with file leases, overlap sequencing and the cheapest capable model; a context packer (minimal brief, cached shared prefix with Amber's persona); a headless runner (claude -p with model, max turns, token budget, allowed tools, own worktree, kill on overrun, JSON report); orchestrator-owned shared files, pre-push lease check and batch merge; cost meter per agent, job and build. Agent jobs: recurring job types (job-type@1) owned by hired agents, routed by framework/cli/agent-job.mjs (owner, duty, budget, brief, headless launch, run on the agent). Breakroom: agent cards and profiles, a Jobs view, statuses, salaries, discipline and a group chat with a vibe-ceiling settings suite. Section owners (crew-sections@1): every section that acts on its own has one employee who posts its key events in the group chat (framework/cli/crew-say.mjs), reassigned in the settings tab.

README: Specialist agents that run headless, one job each, so several builds go at once without stepping on each other, on the cheapest model that can do the job. Console → Builds → **Agent swarm**.

| | |
|---|---|
| Provides (manifest) | view:agent-swarm, settings-tab:agent-swarm, service:agent-jobs@1, service:axf.crew@1, service:axf.swarm-roster@1, service:crew-sections@1, service:axf.crew-sections@1 |
| Services provided in code | axf.crew-sections@1 (server/__init__.py); axf.crew@1 (server/__init__.py); axf.swarm-roster@1 (server/__init__.py) |
| Actions registered | agent-swarm.open, agent-swarm.profile |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settings, settingsPanels, contextMenu, appMenu, slots |
| Shared server modules | plugin_services |
| Routes exposed | 10 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/agent-swarm |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, jobs-core.mjs, jobs.mjs, runner.mjs, sections.mjs, swarm.mjs, test.mjs, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (4), _claude/memory/STATUS.md (2), _claude/rules/RULES.md (1), framework/spec/PORTING.md (1), install_steps.md (3) |
| Folder word quoted in shell / framework (check by hand) | framework/core/engines/card-rules.mjs (2) |
| Flags | declares a service the code never provides (manifest marker, CLI contract or web-only): agent-jobs@1, crew-sections@1 |

### agent-voice

**Agent voice** v0.1.0 (ai.amberx.axf.console.agent-voice). Agents speak: a per-agent voice and narrator console (device voices on the phone or browser, cloud voices from OpenAI or ElevenLabs with keys kept on the server; speed, pitch, volume, presets, read modes, code / link / number / emoji rules, pauses, emphasis, intro and outro, chime, pronunciations, permissions, try-it preview, import/export). A live status light on the banner and in the Assistant title bar while the selected agent is a voice agent (ready, speaking, listening, paused). A microphone in the Assistant window that says which agent is missing which permission (one-tap fix), with tap / hold / toggle modes, live text, send and cancel phrases, spoken punctuation, barge-in and conversation mode, sharing the microphone with AmberX hands-free listening, dictation and Speak a command through the page's mic lease (mic-lease@1) so they never conflict. Hooks to its settings in the app menu (Plugins, View), right-click, the banner light, the Assistant title bar and search.

README: Brett: "Build plugin to give agents ability to speak with a full powerful per agent configuration console. Give it all the bells and whistles a narrator should have. When a voice agent is selected a live status icon lights up on main application and assistant window. Put microphone in Assistant window that when selected trip tooltip noting selected agents name is missing permission unless plugin i

| | |
|---|---|
| Provides (manifest) | view:agent-voice, settings-tab:agent-voice, action:agent-voice.open, service:axf.agent-voice@1, service:axf.speech@1 |
| Requires / optional / dependsOn | service:axf.agents@1 (optional) |
| Services provided in code | axf.speech@1 (server/__init__.py); axf.agent-voice@1 (web library provides) |
| Services looked up in code | axf.agents@1 → agent-manager [optional] |
| Views / dialogs / actions of other plugins used | action ai-assistant.open (ai-assistant) |
| Shared globals | __axfMicLease |
| Window events | emits axf:agent-voice.configure, axf:agent-voice.listen, axf:agent-voice.say, axf:assistant.focus; listens axf:agent-voice.configure, axf:agent-voice.listen, axf:agent-voice.say |
| Actions registered | agent-voice.configure, agent-voice.open, agent-voice.pause, agent-voice.resume, agent-voice.settings, agent-voice.stop |
| Banners / slots | slots assistant.head, assistant.mic, assistant.reply |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settings, settingsPanels, contextMenu, appMenu, slots |
| Shared server modules | axf_framework, console_context, plugin_services |
| Routes exposed | 13 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES, NETWORK |
| Data dir | .axf-console/plugins/agent-voice |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### ai-assistant

**AI assistant** v0.3.0 (ai.amberx.axf.console.ai-assistant). The framework's assistant (assistant@1) in the Dev Console: every provider in the shared registry (Anthropic, Claude Code subscription, OpenAI, xAI Grok, Gemini, Mistral, Groq, DeepSeek, OpenRouter, Together, Fireworks, Perplexity, Cohere, Cerebras, Azure OpenAI, Ollama, LM Studio, any OpenAI-compatible server), setup wizard in Settings → Plugins → AI assistant, settings dialog inside the chat, live sessions on an open host registry, write-mode approval cards, the Claude Code MCP bridge. Its title bar shows axHub approvals and held calls (lib-approvals badge: click to approve on the hub page, or Deny before a countdown ends). Chats as an agent from an installed agent manager. Hub users (behind axHub's sign-in wall) chat at /api/plugins/ai-assistant/app with permissions from the hub's users page.

| | |
|---|---|
| Provides (manifest) | view:ai-assistant, dialog:ai-assistant.chat, settings-tab:ai-assistant, action:ai-assistant.open, action:ai.chat.start, service:axf.llm@1, service:axf.live-sessions@1 |
| Requires / optional / dependsOn | service:axf.agents@1 (optional), service:axf.containers@1 (optional), service:axf.live-host@1 (optional) |
| Services provided in code | axf.live-sessions@1 (server/__init__.py); axf.llm@1 (server/__init__.py); axf.live-sessions@1 (web library provides); axf.llm@1 (web library provides) |
| Services looked up in code | axf.agents@1 → agent-manager [optional]; axf.ai-keys@1 → ai-keys [undeclared]; axf.containers@1 → container-access [optional] |
| Views / dialogs / actions of other plugins used | action plugin-switches.open (plugin-switches) |
| Dynamic lookups (variable argument; every capability string in that file counted) | server/__init__.py: get(sessions.HOST_CAPABILITY) |
| Window events | emits axf:assistant.agent, axf:assistant.reply; listens axf:assistant.focus, axf:assistant.hello, axf:assistant.input |
| Actions registered | ai-assistant.open, ai.chat.start |
| Library contributions (web/index.tsx) | views, dialogs, nav, settingsTabs, settings, settingsPanels, appMenu |
| Shared server modules | axf, axf.assistant_host, axf.contracts, axf.contracts.assistant, axf_framework, plugin_services, wall |
| Routes exposed | 39 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES, NETWORK |
| Data dir | .axf-console/plugins/ai-assistant |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (2), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (2), framework/spec/ASSISTANT.md (2), framework/spec/LIVE-SESSIONS.md (2) |
| Named by shell / framework (path or route) | apps/console-web/src/axf/core/assistant.ts (2) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1), apps/console-web/server/plugin_services.py (1), framework/core/engines/card-rules.mjs (1) |
| Flags | uses undeclared: axf.ai-keys@1; declares but never looks up: axf.live-host@1; named in docs without the axf-plugin tag: _claude/THREADS.md |

### ai-keys

**AI keys** v0.5.0 (ai.amberx.axf.console.ai-keys). A dialog that keeps several Anthropic keys (API keys in any Anthropic format, sk-ant-api03… or sk-ant-usr…, checked live, and Claude subscription tokens sk-ant-oat… from `claude setup-token`) and picks the active one of each kind for the AI assistant. Every key is tested before it is saved (an invalid one is refused) and can be re-tested; keys are stored 0600 on the console server and never sent back to a browser (only the last 4 characters). The active key replaces the assistant profile's own key for that kind (Anthropic / Claude Code subscription). Open it from the right-click menu, the application menu (Plugins › AI keys), action ai-keys.open, search or Settings → Plugins → AI keys; reachable through axHub's sign-in wall like the rest of the console. Several Claude accounts (Nov 2 2026): each subscription shows the email of its Claude account, and when a headless build hits a weekly or usage limit the next saved account that still answers becomes active (POST /switch, deploy/claude-headless.sh) and the build runs again on it. Manage Claude accounts (action ai-keys.accounts): a dialog listing the accounts in priority order with expandable rows (access and refresh token each tested on its own, email, plan, renewal), drag and drop to set the order the automatic switch follows, and an Add account wizard that shows every command and checks each key the moment it is entered before it goes on. One store for the whole console: every console admin and the console token see the same keys, active choice, order and VPS state, and nobody else gets in. The accounts saved on the VPS (Claude accounts plugin) are listed beside them as vpsAccounts and can be switched by API; their tokens stay on the VPS.

| | |
|---|---|
| Provides (manifest) | dialog:ai-keys, dialog:ai-keys.accounts, service:axf.ai-keys@1, settings-tab:ai-keys |
| Requires / optional / dependsOn | service:axf.llm@1 (optional), service:axf.vinny@1 (optional), service:axf.claude-accounts@1 (optional) |
| Services provided in code | axf.ai-keys@1 (server/__init__.py) |
| Services looked up in code | axf.claude-accounts@1 → claude-accounts [optional]; axf.vinny@1 → agent-manager [optional] |
| Actions registered | ai-keys.accounts, ai-keys.open |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settingsPanels, contextMenu, appMenu |
| Shared server modules | axf, axf_framework, console_context, plugin_services |
| Routes exposed | 11 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/ai-keys |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, switch.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (2), install_instructions.md (9) |
| Flags | declares but never looks up: axf.llm@1; named in docs without the axf-plugin tag: _claude/THREADS.md |

### alerts-bell

**Alerts bell** v0.1.0 (ai.amberx.axf.console.alerts-bell). The developer alerts bell on the banner (it used to sit on the toolbar): a bell button that opens the Alerts view and, next to it, the number of unread alerts (hidden at zero, 99+ past 99). Built from the framework's action-button and counter widgets; the alerts library (Alerts view, Settings → Alerts, delivery) stays in the framework. Show/hide and side in its settings.

| | |
|---|---|
| Provides (manifest) | asset:action-button/alerts-bell, asset:counter/alerts-bell, banner:right, settings-tab:alerts-bell |
| Library contributions (web/index.tsx) | settingsTabs, settings, settingsPanels, appMenu, embed |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Data dir | .axf-console/plugins/alerts-bell |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs, widget-check.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |

### amberx-listeners

**AmberX listeners** v0.1.0 (ai.amberx.axf.console.amberx-listeners). Every AmberX device's background listeners in the Dev Console (listener@1): the hands-free wake word, the command after it, the Speak button, Gizmo's talk mode, the recorder mic, the axHub watch, the veto alarm and the page's own listeners, with their live state (listening, paused for a call or another app, stopped on errors with the reason, who holds the microphone, the last error) as each phone publishes it to the hub (amberx-axf/_data/listeners/devices), and the per-listener controls (allowed, pause for calls, pause for other apps, start sound, restarts before it gives up, Restart) written to the AmberX settings document on the hub so every phone follows. Apps → AmberX → Listeners; REST /api/plugins/amberx-listeners (devices, policies, registry, state, policy, restart), MCP amberx-listeners_*, CLI listeners.mjs / axf amberx-listeners.

| | |
|---|---|
| Provides (manifest) | view:amberx-listeners, settings-tab:amberx-listeners, action:amberx-listeners.open |
| Actions registered | amberx-listeners.open |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settings, settingsPanels, appMenu |
| Routes exposed | 6 (0 websocket) |
| Commands (plugin-commands@1) | auto; 6 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/amberx-listeners |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | core.mjs, hooks.mjs, install.mjs, listeners.mjs, test.mjs, test.py, uninstall.mjs |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### approvals-banner

**Approvals banner** v0.6.0 (ai.amberx.axf.console.approvals-banner). The veto banner: a banner at the top of the app whenever axHub holds a call on its countdown (veto@1: it runs by itself after 90 s unless you stop it) or has one waiting for approval. Held calls show a live countdown with Deny, Approve (run it now) and Shelve (pause the countdown until you decide); tapping one opens the veto screen. Its notices (timer started, 30 s left, running) and a configurable alarm (tone or your own sound, volume, louder over time, how long, repeats, vibration, when it starts, through silent mode on the phone) work in every app it is installed in: the console and AmberX. Only for admins signed in to axHub; it acts only on your tap. In the console, Approve and Deny stay in the console: the tap goes through its relay with your own hub session and the result shows where you tapped.

| | |
|---|---|
| Provides (manifest) | banner:approvals, settings-tab:approvals-banner, dialog:approvals.veto, action:approvals.veto, action:approvals.deny, action:approvals.approve-now, action:approvals.shelve, action:approvals.view, action:approvals.approve, action:approvals.decline |
| Services looked up in code | axf.health@1 → systems-check [undeclared] |
| Shared globals | __axfSoundOwner |
| Actions registered | approvals.check, approvals.notice, approvals.open, approvals.review, approvals.veto, approvals.view |
| Banners / slots | banners approvals, approvals-banner.alarm; manifest banner ["approvals"] |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settings, settingsPanels, appMenu, appMenuProviders, banners |
| Shared server modules | plugin_services, wall |
| Routes exposed | 2 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/approvals-banner |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json, notify.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Doc mentions (tagged) | CLAUDE.md (1), _claude/handoff/context/CLAUDE.md (1), _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1), framework/core/engines/card-rules.mjs (1) |
| Flags | uses undeclared: axf.health@1; named in docs without the axf-plugin tag: _claude/THREADS.md |

### audio-extract

**Audio Extract** v0.1.0 (ai.amberx.axf.console.audio-extract). Pulls the audio out of videos on the phone into audio files (screen recordings first): the original AAC copied out as .m4a with no re-encode, or WAV when picked. Pick videos (batch), Share to AmberX, the last screen recording by voice, new screen recordings offered as they appear; trim, track pick, progress, cancel; results list with play, rename, share, delete. Plus a screen recorder with the sound apps play (no microphone) whose recordings go straight through the extractor. Runs in AmberX on Android (native AudioExtract plugin); shows a note anywhere else.

README: Pulls the audio out of videos on the phone, screen recordings first, and records the screen with the sound apps play. Runs in **AmberX on Android** (target `amberx-droid`); on the console it only shows a note. Built Oct 30 2026 (Opus).

| | |
|---|---|
| Provides (manifest) | view:audio-extract, settings-tab:audio-extract |
| Actions registered | audio-extract.latest, audio-extract.pause, audio-extract.pick, audio-extract.record, audio-extract.resume, audio-extract.stop |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settings, settingsPanels, appMenu |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Data dir | .axf-console/plugins/audio-extract |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, uninstall.mjs |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md, _claude/memory/STATUS.md |

### basic-filter

**Basic filter** v0.1.0 (ai.amberx.axf.console.basic-filter). A sort & filter dialog (search, rules on any column, match all / any, multi-level sort) you can attach to any dataset — every grid is one. Attached datasets get its toolbar above them: on by default with one button that opens the dialog, designed in its settings (show / hide, preset actions in a grid with expandable rows showing everything about each action and its style, live floating preview that redraws on every edit). Attach or detach it in its settings or from its row in Plugin switches.

| | |
|---|---|
| Provides (manifest) | dialog:basic-filter, settings-tab:basic-filter, slot:axf.dataset.toolbar, slot:plugin-switches.row |
| Views / dialogs / actions of other plugins used | action plugin-switches.open (plugin-switches) |
| Actions registered | basic-filter.open |
| Banners / slots | slots plugin-switches.row |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settingsPanels, appMenu, slots |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Data dir | .axf-console/plugins/basic-filter |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, uninstall.mjs |
| Doc mentions (tagged) | _claude/memory/STATUS.md (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### brand-library

**Brand library** v0.1.0 (ai.amberx.axf.console.brand-library). Browse the framework's brand library: 250 logos, 250 animated logos, 100 icon packs and 50 branding packages for AmberX and GizmoX, in tabs with search, brand and style filters and a virtualised grid. Preview any piece light and dark at every size (animations play), copy its id, and apply it: a branding package becomes the brand, a logo, animated logo or icon pack goes into the active brand. Nav → Plugins → Brand library; settings in Settings → Plugins → Brand library.

| | |
|---|---|
| Provides (manifest) | view:brand-library, settings-tab:brand-library |
| Actions registered | brand-library.open |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, appMenu |
| Shared server modules | axf_framework, console_context |
| Routes exposed | 5 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/brand-library |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Folder word quoted in shell / framework (check by hand) | framework/cli/brand-gen.mjs (4) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md, _claude/memory/STATUS.md |

### build-breaker

**Build Breaker** v0.1.0 (ai.amberx.axf.console.build-breaker). Everything Brett ever asked for, in plain English (build-asks@1): one compact row per ask with its date and time, a status badge (built, in progress, pending, planned, held, removed, waiting for push / pull / deploy / approval), build time, cost and model. Grids per app and per plugin plus a timeline; search, status / model / date filters, sort, group-by; a row opens to the description, his own words, sources, branch and PR, and its feature matrix. Adds a permanent Build item to every context menu listing every build page. Data: data/asks.jsonl (seed) mirrored to the data folder; asks.mjs add | set-status | list keeps it current.

| | |
|---|---|
| Provides (manifest) | view:build-breaker, settings-tab:build-breaker |
| Actions registered | build-breaker.open |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settings, settingsPanels, appMenu, slots |
| Routes exposed | 1 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/build-breaker |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | asks.mjs, hooks.mjs, install.mjs, test.mjs, uninstall.mjs |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### build-orchestrator

**Build orchestrator** v0.5.0 (ai.amberx.axf.console.build-orchestrator). Breaks every build into small steps (30 min or less), each pinned to Fable or Opus, and runs the build pipeline (Brett, Nov 8 2026): every build gets an id and a Claude split (Fable only where needed) and sits in Pending; Brett moves it to the Queue; the dispatcher (pipeline.mjs on the VPS, every minute) watches the Claude accounts (which have Fable, parallel per account) and the agent slots and, when a slot is free, starts a headless session for the next Queue build on an account that runs its next phase's model. The only place that browses and manages builds (Brett, Nov 10 2026; the Build manager is retired): tabs Pending, Queue (each build's steps, planned model and account), Active, Incomplete, Complete, Errors, Archive (every completed and archived build), Deleted (soft-deleted builds kept forever, restorable), then Accounts (health every 5 minutes: sign-in, credits, Fable), All builds, Approvals and Rules. When a build's turn comes the dispatcher makes the final account pick, subscriptions first (in Brett's order), then any API account, moving on until one accepts, and records which account took it. Tracker is the one builds store, _claude/builds/store.json, so any session or account continues the build (orchestrator.mjs next | brief | act; pipeline.mjs status | queue | unqueue | hold | release | archive | unarchive | delete | restore | split | tick).

| | |
|---|---|
| Provides (manifest) | view:build-orchestrator, settings-tab:build-orchestrator, service:orchestrator@1, service:axf.build-dispatch@1 |
| Requires / optional / dependsOn | service:axf.agent-slots@1 (optional), service:axf.merge-queue@1 (optional), service:plans@1 (optional), service:ui-review@1 (optional) |
| Services provided in code | axf.build-dispatch@1 (server/__init__.py); console-focus@1 (server/__init__.py) |
| Services looked up in code | axf.agent-slots@1 → agent-slots [optional]; axf.health@1 → systems-check [undeclared]; axf.merge-queue@1 → push-banner [optional]; plans@1 → plan-studio [optional]; ui-review@1 → ui-review [optional] |
| Dynamic lookups (variable argument; every capability string in that file counted) | server/__init__.py: get(cap) |
| Actions registered | build-orchestrator.focus, build-orchestrator.open, build-orchestrator.start, build-orchestrator.tab |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, contextMenu, appMenu |
| Shared server modules | plugin_services |
| Routes exposed | 24 (0 websocket) |
| Commands (plugin-commands@1) | auto; 20 explicit, 10 with voice hints |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/build-orchestrator |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json, notify.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, orchestrator.mjs, pipeline-core.mjs, pipeline.mjs, pipeline.test.mjs, server/test_upgrade.py, test.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (27), _claude/builds/README.md (4), _claude/memory/STATUS.md (1), _claude/rules/RULES.md (6), _claude/shared/rules/RULES.md (5) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/server/mcp_server.py (1), apps/console-web/server/test_mcp_tools.py (2), framework/core/build-priority.mjs (1), framework/core/engines/card-rules.mjs (1), framework/core/headless-context.mjs (2) |
| Flags | uses undeclared: axf.health@1; declares a service the code never provides (manifest marker, CLI contract or web-only): orchestrator@1; provides in code without declaring: console-focus@1 |

### build-profiles

**Build profiles** v0.1.0 (ai.amberx.axf.console.build-profiles). Pick and save the build profile the console works on. A build profile is one complete set of work data: plan (+ media), build queue, pending builds, catalog status + tracker, and the Build orchestrator's builds. Main framework is the base profile; Refactor started empty. Switching changes it for every device and session (sessions can override with AXF_BUILD_PROFILE). Banner chip shows the profile in force; tap it, the app menu (Builds → Build profile), the right-click menu or Settings → Plugins → Build profiles to switch, create, rename or take a profile off the list (its data stays). Profiles are framework data (framework/cli/profiles.mjs): removing this plugin leaves them in place.

| | |
|---|---|
| Provides (manifest) | dialog:build-profiles, settings-tab:build-profiles |
| Actions registered | build-profiles.open |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settingsPanels, contextMenu, appMenu |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Data dir | .axf-console/plugins/build-profiles |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, uninstall.mjs |
| Doc mentions (tagged) | _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### builds-page

**Builds** v0.1.0 (ai.amberx.axf.console.builds-page). One Builds page over the one builds store (builds@1, owned by the Build orchestrator): every build of the active build profile, with switchable views. Builds = one row per build with a live progress bar, status, steps, time left; double-tap or right-click a name to rename it (the id never changes). Steps = every atomic step as its own stored record, for one build or the whole profile: expandable rows, multi-select (Ctrl+click, long-press, optional checkboxes), drag to reorder steps and builds, divide a step, harvest selected steps into one new build or split them into N, Restore default. Everything in the Steps view is a draft (saved, survives a restart) until Apply; Discard drops it. Live progress bars per build, per step and per profile; the banner shows the profile's percentage, animated while a build runs. Runs in AmberX too (its server forwards the routes).

| | |
|---|---|
| Provides (manifest) | view:builds, settings-tab:builds-page, banner:right |
| Actions registered | builds.open, builds.view |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settings, settingsPanels, appMenu |
| Shared server modules | readcache |
| Routes exposed | 9 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/builds-page |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md |
| Tests / CLI scripts | builds.mjs, hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (1), _claude/builds/README.md (1), _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1), framework/core/engines/card-rules.mjs (2) |

### changes-grid

**Changes & features grid** v0.1.0 (ai.amberx.axf.console.changes-grid). One grid of every change (the Codebase changes log, read through axf.changes@1) and every feature (the plan). Each row is titled with its thread / request name and its date and time, and expands to show the details: what was asked, steps, result, branch, commits and links for a change; status, summary, ports, files, acceptance and history for a feature. Filter changes / features / both, search, sort.

| | |
|---|---|
| Provides (manifest) | view:changes-grid, settings-tab:changes-grid |
| Requires / optional / dependsOn | service:axf.changes@1 (optional) |
| Services looked up in code | axf.changes@1 → codebase-changes [optional] |
| Actions registered | changes-grid.open |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, contextMenu, appMenu |
| Shared server modules | plugin_services |
| Routes exposed | 2 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/changes-grid |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### chat-viewer

**Chat viewer** v0.1.0 (ai.amberx.axf.console.chat-viewer). Every session we have, stored as transcripts (session@1) in one searchable store: claude.ai text and voice chats (from the data export Brett uploads, or the hub drop folder claude.ai sessions write to when he says "sync my chats"), Claude Code sessions (~/.claude/projects, synced incrementally on a timer and on load) and headless build sessions (build logs). Checks for updates on load (new, continued, changed, unchanged), keeps every version, redacts secrets on ingest, full-text search that jumps to the hit, chat bubbles (Brett vs Amber) with collapsible tool calls, copy / share / export as text or Markdown, and audio export with two voices (free Piper voices on the VPS by default, OpenAI or ElevenLabs when a key is saved), rendered in the background with chapters per hour and stored on the hub. Also in AmberX as Chats.

README: Every session we have, stored as transcripts in one place: claude.ai text and voice chats, Claude Code sessions and headless build sessions. Console: **Plugins → Chat viewer** (also **Apps → Chats**); AmberX: **Chats**.

| | |
|---|---|
| Provides (manifest) | view:chat-viewer, settings-tab:chat-viewer |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, appMenu |
| Shared server modules | console_context |
| Routes exposed | 22 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/chat-viewer |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (1), _claude/memory/STATUS.md (2), _claude/shared/rules/RULES.md (1), install_steps.md (2) |

### claude-accounts

**Claude accounts** v0.4.0 (ai.amberx.axf.console.claude-accounts). Claude accounts on the VPS: lists the saved logins and API keys, switches the console's account, and routes headless jobs: every subscription login is a worker (the console's account takes jobs after them), 3 build and 5 wait per account, and API-key accounts take only the jobs a routing rule sends them, under daily and weekly spend caps with alerts. Job routing settings: rules on job type, model, size, priority, profile and a subscriptions-busy fallback, in order, each on or off, with a test-a-job preview. Never shows a credential. Every switch, save, sign-in or removal is one held axHub call.

README: The Claude logins on the VPS: one runs the console, the others can be workers that only run headless jobs.

| | |
|---|---|
| Provides (manifest) | view:claude-accounts, settings-tab:claude-accounts, dialog:claude-accounts.switch, action:claude-accounts.open, action:claude-accounts.switch, service:axf.claude-accounts@1, settings-panel:claude-accounts.routing, action:claude-accounts.routing |
| Requires / optional / dependsOn | service:axf.headless@1 (required), service:axf.vinny@1 (required) |
| Services provided in code | axf.claude-accounts@1 (server/__init__.py) |
| Services looked up in code | axf.headless@1 → console-terminal [required]; axf.health@1 → systems-check [undeclared]; axf.vinny@1 → agent-manager [required] |
| Views / dialogs / actions of other plugins used | action terminal.claude (console-terminal) |
| Actions registered | claude-accounts.open, claude-accounts.routing, claude-accounts.switch |
| Library contributions (web/index.tsx) | views, dialogs, nav, settingsTabs, settingsPanels, appMenu |
| Shared server modules | plugin_services |
| Routes exposed | 14 (0 websocket) |
| Commands (plugin-commands@1) | auto; 14 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/claude-accounts |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | CLAUDE.md (1), _claude/memory/STATUS.md (2) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | uses undeclared: axf.health@1; named in docs without the axf-plugin tag: _claude/THREADS.md |

### claude-badge

**Badges** v0.5.0 (ai.amberx.axf.console.claude-badge). Five banner badges in one plugin. Claude tests the AI connection on load (axf.llm@1). VPS watches the Claude Code login on the host. axHub is the framework's live check: green only while settings come live from axHub. AmberX shows whether the phone app is connected. The usage meter shows how much of its 5-hour and weekly limits the active Claude account has used, and its drop-down lists every saved account with what is left, reset times, active marker and status. Everything but the Claude test is plain code and costs no tokens. Each badge can be shown or hidden, set to Icons only, given a label, an icon per state (ok, warning, error, off), a side and order on the banner, and a tap action (drop-down, open a screen, run a command, toggle, nothing). Removing the plugin removes only these badges; the banner, badge and clock asset types stay in the framework.

README: `ai.amberx.axf.console.claude-badge` · built on Opus.

| | |
|---|---|
| Provides (manifest) | asset:badge/claude, asset:badge/claude-vps, asset:badge/axhub, asset:badge/amberx-phone, asset:badge/claude-usage, banner:left, settings-tab:claude-badge |
| Requires / optional / dependsOn | service:axf.llm@1 (optional), service:axf.claude-accounts@1 (optional), service:axf.ai-keys@1 (optional), service:axf.headless@1 (optional), service:axf.vinny@1 (optional) |
| Services looked up in code | axf.ai-keys@1 → ai-keys [optional]; axf.claude-accounts@1 → claude-accounts [optional]; axf.headless@1 → console-terminal [optional]; axf.llm@1 → ai-assistant [optional]; axf.vinny@1 → agent-manager [optional] |
| Banners / slots | slots app.frame.cover |
| Library contributions (web/index.tsx) | settingsTabs, settings, settingsPanels, appMenu, slots, embed |
| Shared server modules | axf_framework, console_context, plugin_services |
| Routes exposed | 5 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/claude-badge |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (1), _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (2) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |

### claude-handoff

**Claude handoff banner** v0.3.1 (ai.amberx.axf.console.claude-handoff). Moves AmberX AXF to a new Claude account. Builds and keeps current the handoff kit in _claude/handoff/ (entry point, reading order, claude.ai Project instructions and knowledge, every instruction/rule/memory/spec file, copies of each machine's ~/.claude files, the claude.ai-side items, secret names) and assembles the one prompt that, typed into a new session on the new account, clones the repo and sets everything up from those files. Publishes the kit to GitHub; reminds every 6 hours with one banner and one alert (overwritten, never stacked). Tools → Installer preview runs the installer with example data; Tools → Installer look picks its layout, gauge and progress-meter styles and the app's light/dark colour and style themes, with a roll that changes only what is switched on in a token tree; saved on axHub's data server. Handoff Session (under Assemble prompt) writes ACTIVE-THREADS.md, a summary of open work (running change-log entries, pending builds, open pull requests, notes) to paste into the Project on the other account once it exists. Lives in the console's Tools section.

| | |
|---|---|
| Provides (manifest) | view:claude-handoff, banner:claude-handoff, settings-tab:claude-handoff, action:claude-handoff.open, action:claude-handoff.assemble, action:claude-handoff.publish, view:claude-handoff-preview, action:claude-handoff.look, action:claude-handoff.preview, action:claude-handoff.session |
| Actions registered | claude-handoff.assemble, claude-handoff.files, claude-handoff.last, claude-handoff.look, claude-handoff.open, claude-handoff.preview, claude-handoff.publish, claude-handoff.session |
| Banners / slots | banners claude-handoff, claude-handoff.lifecycle, claude-handoff.prefs; manifest banner ["claude-handoff"] |
| Library contributions (web/index.tsx) | views, dialogs, tabs, nav, settingsTabs, settingsPanels, contextMenu, appMenu, banners |
| Shared server modules | console_context |
| Routes exposed | 21 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/claude-handoff |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json, notify.json |
| Tests / CLI scripts | handoff-core.mjs, handoff.mjs, hooks.mjs, install.mjs, test.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |

### claude-session

**Claude sessions** v0.1.0 (ai.amberx.axf.console.claude-session). Every Claude session (voice and chat Amber, Claude Code, headless builds) works as a crew agent Brett assigns (agent-pick@1). A session calls claude_session_start first; with 'Ask me every session' on (the default), the console pops the agent picker (every agent with avatar, status, current job, today's cost, hours, pay, rating; tap a row for every stat and links to the card, history, Session browser, Terminal and group chat) and axHub gets one held approval as the fallback (pushed to the phone through the AmberX app). Until Brett picks, the session is the default agent. claude_session_agent tells a session who it is (persona / voice notes, avatar, intro); claude_session_book puts its cost, time and commits on the agent's card. 'Assign to Claude' on every crew card and in the agent right-click menu; Settings → Plugins → Claude sessions: Claude agent, Ask me every session, Ask for headless too. No model calls.

README: Every Claude session (voice and chat Amber, Claude Code, headless builds) works **as** a crew agent Brett assigns (Brett, Nov 3 2026). Built on Opus (orchestrator build `agent-pick`, Urgent profile).

| | |
|---|---|
| Provides (manifest) | settings-tab:claude-session, dialog:claude.picker |
| Requires / optional / dependsOn | service:axf.crew@1 (optional), service:axf.agent-slots@1 (optional) |
| Services looked up in code | axf.agent-slots@1 → agent-slots [optional]; axf.claude-settings@1 → claude-settings [undeclared]; axf.crew@1 → agent-swarm [optional] |
| Actions registered | claude.assign, claude.pick |
| Banners / slots | slots app.frame.cover, swarm.agent.actions |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settingsPanels, contextMenu, appMenu, slots |
| Settings / storage keys | axf.output-recorder.find |
| Shared server modules | axf_framework, console_context, plugin_services |
| Routes exposed | 10 (0 websocket) |
| Commands (plugin-commands@1) | auto; 3 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/claude-session |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json, notify.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | CLAUDE.md (1), _claude/THREADS.md (1), _claude/shared/rules/RULES.md (1) |
| Flags | uses undeclared: axf.claude-settings@1 |

### claude-settings

**Claude** v0.1.0 (ai.amberx.axf.console.claude-settings). Claude settings (claude-settings@1): settings for Claude itself, kept on axHub (/projects/_shared/_data/claude/settings.json) so every Claude session (voice, chat, Claude Code, headless agents) reads the same values at its start and before acting (MCP claude_settings_get, CLI claude-settings.mjs). Groups: No wait (owner-only: Brett's own click turns on a standing all-scope veto pass so held calls run at once; Include irreversible, duration 1 h / 4 h / until off, auto-off at night; banner chip while on; off revokes the pass at once), Follow Amber (the same switch the follow-amber build reads), Builds (default model, launch without asking, max parallel, per-build and daily budget caps, named agent locked on, UI Review gate), Verification, Talking, Notifications, Memory and notes. Open registry: a new setting is data (registry.json, registry.d/, or the hub's claude/registry.json). Owner-only settings change only from Brett's signed-in console session; sessions and agents can change the rest. Page + Settings → Plugins → Claude; 'Claude settings' in every context menu.

| | |
|---|---|
| Provides (manifest) | view:claude-settings, settings-tab:claude-settings, banner:claude-no-wait, action:claude-settings.open, service:axf.claude-settings@1 |
| Requires / optional / dependsOn | service:control@1 (required) |
| Services provided in code | axf.claude-settings@1 (server/__init__.py) |
| Services looked up in code | control@1 → token-control [required] |
| Own capability looked up (self) | axf.claude-settings@1 |
| Actions registered | claude-settings.open |
| Banners / slots | banners claude-no-wait, claude-settings.lifecycle; manifest banner ["claude-no-wait"] |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, contextMenu, appMenu, banners |
| Shared server modules | plugin_services |
| Routes exposed | 4 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/claude-settings |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | claude-settings.mjs, core.mjs, hooks.mjs, install.mjs, test.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | CLAUDE.md (1), _claude/memory/STATUS.md (2), _claude/shared/rules/RULES.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1), apps/console-web/server/mcp_server.py (1), framework/cli/rules-brief.mjs (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### codebase-changes

**Codebase changes banner** v0.1.0 (ai.amberx.axf.console.codebase-changes). Every time Claude is asked to build, edit, remove or fix something, an entry is opened (by a Claude Code hook) with what was asked, broken into steps that Claude fills in as it works, and the result when it's done (branch, commits, files, tests, links). A Codebase changes banner on every console load lists the entries you haven't closed; closing one clears it on every device. The permanent log lives on axHub (/projects/amberx-axf/_data/changes) and is browsable under Builds → Codebase changes.

| | |
|---|---|
| Provides (manifest) | view:codebase-changes, banner:codebase-changes, settings-tab:codebase-changes, action:codebase-changes.open, search:codebase-changes.entries, service:axf.changes@1 |
| Services provided in code | axf.changes@1 (server/__init__.py) |
| Actions registered | codebase-changes.open |
| Banners / slots | banners codebase-changes, codebase-changes.prefs; manifest banner ["codebase-changes"] |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settings, settingsPanels, contextMenu, appMenu, banners |
| Shared server modules | axf_framework, console_context, plugin_services |
| Routes exposed | 10 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/codebase-changes |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | backfill.mjs, changes-core.mjs, changes.mjs, hooks.mjs, install.mjs, test.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/handoff/context/claude__memory__docs__build-reporting.md (3), _claude/handoff/context/claude__rules__RULES.md (3), _claude/handoff/context/claude__shared__rules__RULES.md (1), _claude/memory/STATUS.md (1), _claude/memory/docs/build-reporting.md (3), _claude/memory/docs/codebase-changes.md (6), _claude/rules/RULES.md (3), _claude/shared/rules/RULES.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1), framework/core/engines/card-rules.mjs (1), framework/core/headless-context.mjs (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### console-commands

**Console commands** v0.2.0 (ai.amberx.axf.console.console-commands). Tell Amber (any Claude session) to load a screen and your open console goes there: open any screen, dialog or settings tab (sub-tabs too) by id, title or a few words, run any registered action, go back or home, and list what the console has. The control@1 console domain over REST (/api/console), MCP tools console_open, console_dialog, console_settings, console_action, console_back, console_where, console_list and console_clients on the console's /mcp (and through axHub), and the CLI `axf console …`. Opening and moving only navigate; an action that changes data keeps its own permission, and one that deletes or resets needs a confirm token. Commands go to the console you used last (or all of them, or one).

| | |
|---|---|
| Provides (manifest) | settings-tab:console-commands, service:console-commands@1 |
| Services provided in code | console-commands@1 (server/__init__.py) |
| Services looked up in code | console-focus@1 → build-orchestrator [undeclared] |
| Own capability looked up (self) | console-commands@1 |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settings, settingsPanels, appMenu, slots |
| Settings / storage keys | axf.settings.lastTab |
| Shared server modules | plugin_services |
| Routes exposed | 21 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/console-commands |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json, notify.json |
| Tests / CLI scripts | console.mjs, hooks.mjs, install.mjs, server/test_console_commands.py, test.mjs, uninstall.mjs |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | uses undeclared: console-focus@1; named in docs without the axf-plugin tag: _claude/THREADS.md, _claude/memory/STATUS.md |

### console-terminal

**Terminal** v0.5.0 (ai.amberx.axf.console.terminal). Windows-style terminal: a Windows Terminal window with its own tab strip (rename, colour, drag to reorder, duplicate, move to a new window), a command toolbar and Windows keys. Claude Code tabs open on any connection (console container, VPS root, any container, axHub) through a connection picker; right-click a tab for its Connection manager. Claude Code profiles (model, permissions, flags, folder, first prompt, colour, default connection). Live settings: colour schemes, font, cursor, line height, padding, bell, scrollback, startup, tab width. Mouse mode, Mosh mode, copy/paste, phone key row, idle timeout and a session log. Settings → Plugins → Terminal. Persistent tabs: VPS and console tabs live in tmux sessions that survive reloads, sleep and restarts (Open in Moshi copies the attach command; closing detaches, Kill session ends one). Headless builds open their own tab with the agent, model, live cost and status, split into the session and its context chain. Sessions nav (left rail, collapsible): My sessions (Brett's own tmux / Claude Code sessions, mirrored read-only with Jump in; claude.ai chat and voice sessions as a live feed of their console_session_note lines and console MCP calls), Agents (headless builds with agent, model, live cost, status), Connections and Recent, live over a websocket.

README: `ai.amberx.axf.console.terminal` · built on Opus (Oct 18 2026).

| | |
|---|---|
| Provides (manifest) | action:terminal.claude, action:terminal.jump, action:terminal.mirror, action:terminal.new, action:terminal.open, action:terminal.sessions, context-menu:*, dialog:terminal.connect, dialog:terminal.connection, service:axf.headless@1, service:axf.session-feed@1, settings-tab:terminal, tab:terminal, tab:terminal-host |
| Requires / optional / dependsOn | service:axf.containers@1 (optional) |
| Services provided in code | axf.headless@1 (server/__init__.py); axf.session-feed@1 (server/__init__.py) |
| Services looked up in code | axf.containers@1 → container-access [optional]; axf.health@1 → systems-check [undeclared]; axf.hub-runs@1 → agent-manager [undeclared] |
| Actions registered | terminal.attach, terminal.claude, terminal.jump, terminal.mirror, terminal.new, terminal.open, terminal.sessions, terminal.toolbar |
| Library contributions (web/index.tsx) | dialogs, tabs, settingsTabs, settingsPanels, appMenu |
| Shared server modules | axf_framework, console_context, plugin_services |
| Routes exposed | 26 (2 websocket) |
| Commands (plugin-commands@1) | auto; 8 explicit |
| Scopes | ROUTES, SHELL |
| Data dir | .axf-console/plugins/console-terminal |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json, notify.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (4), _claude/shared/rules/RULES.md (1), framework/spec/PORTING.md (3) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (2) |
| Flags | uses undeclared: axf.health@1, axf.hub-runs@1; named in docs without the axf-plugin tag: _claude/THREADS.md |

### container-access

**Container access** v0.1.0 (ai.amberx.axf.console.container-access). The master switch for reaching other containers on the VPS. The only code that talks to Docker, through a locked-down socket proxy (list, files, exec, restart only). Protected list enforced on the server (Coolify, Traefik, the console, databases), an audit log of every change, and change batches that need your approval and a snapshot first. Settings → Plugins → Container access.

README: `ai.amberx.axf.console.container-access` · built on Opus (Oct 18 2026).

| | |
|---|---|
| Provides (manifest) | settings-tab:container-access, service:axf.containers@1 |
| Requires / optional / dependsOn | service:axf.snapshots@1 (optional) |
| Services provided in code | axf.containers@1 (server/__init__.py) |
| Services looked up in code | axf.snapshots@1 → snapshot-manager [optional] |
| Library contributions (web/index.tsx) | settingsTabs, settingsPanels, appMenu |
| Shared server modules | axf_framework, plugin_services |
| Routes exposed | 13 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES, DOCKER |
| Data dir | .axf-console/plugins/container-access |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |

### context-menu-designer

**Context menu designer** v0.2.0 (ai.amberx.axf.console.context-menu-designer). Design context menus: create, edit, name, rename and save them, and make 'chunks' (reusable pieces of a menu, saved from any menu with Save as chunk) that you insert into menus by name; chunks can hold items, separators and other chunks. Every menu and chunk carries its own style (font, size, weight, style, text / background colour, hover text / background colour); a chunk inherits the menu's style or uses its own. A floating live preview re-renders on every change. A saved menu becomes a standard context-menu asset (ctxd-<id>) you pick in Appearance or with Use as the context menu. Designs are kept on the console server (0600).

| | |
|---|---|
| Provides (manifest) | view:context-menu-designer, settings-tab:context-menu-designer |
| Actions registered | context-menu-designer.actions, context-menu-designer.filter, context-menu-designer.open |
| Library contributions (web/index.tsx) | views, dialogs, tabs, nav, settingsTabs, settingsPanels, contextMenu, appMenu |
| Shared server modules | axf_framework, console_context |
| Routes exposed | 3 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/context-menu-designer |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### crew-live

**Crew** v0.1.0 (ai.amberx.axf.console.crew-live). Every agent working right now, live: avatar, status (working / waiting on approval / stuck / idle), build and step in plain English, model, a timer since the job and the step started, live cost and tokens, files touched and the PR. A row opens to what the agent is doing this second (from its tool calls), the step list, every file it created, changed or deleted with the live diff against the build's base, its recent tool calls with their cost, links to its Terminal tab and session, and Stop. Idle crew sit in Off the clock; a totals bar shows who is working and what it costs. Zero tokens: plain code reading the headless logs, the builds store and git.

README: Every agent (employee) working right now and exactly what each is doing, live. Builds → **Crew**.

| | |
|---|---|
| Provides (manifest) | view:crew, settings-tab:crew-live, action:crew.open, action:crew.agent, context-menu:agent |
| Requires / optional / dependsOn | service:axf.headless@1 (optional), service:axf.swarm-roster@1 (optional) |
| Services looked up in code | axf.headless@1 → console-terminal [optional]; axf.swarm-roster@1 → agent-swarm [optional] |
| Actions registered | crew.agent, crew.assign, crew.chat, crew.history, crew.open, crew.session, crew.stop, crew.terminal |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, contextMenu, appMenu, slots |
| Shared server modules | plugin_services |
| Routes exposed | 6 (0 websocket) |
| Commands (plugin-commands@1) | auto; 5 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/crew-live |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/axf/core/agent-directory.ts (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### demonstration-designer

**Demonstration Designer** v0.1.0 (ai.amberx.axf.console.demonstration-designer). Pitch the product in three picks and one button. Pick a plugin, screen or UI element from the live registry, pick a length in minutes, pick a narrator voice, press Generate: the designer writes a pitch script with zero tokens (a hook up front, benefits instead of specs, a closing call to action), picks the best screens, and plays a polished demo on the console's real data with a spotlight on each control, smooth zooms and pans, captions, soft background music and a logo intro and outro. Afterwards tweak the words, preview again, export the recording as a video (MP4 when the server has ffmpeg, WebM otherwise) or copy a share link that opens and plays it. Demos are demonstration@1 assets (reusable, chainable into tours, indexed by the glossary); recordings are clip@1 assets. Advanced work (a step timeline, record a demo by doing it) stays folded away. Every action and setting is also on REST, the MCP tools demonstration_designer_*, `axf demonstration-designer …` and the voice actions pitch.*; the deep link ?axf-demo=<id> opens it.

README: Pitch the product in three picks and one button (Brett, Nov 9 2026: "I want a demonstration designer plugin"). It replaces the Demonstration Designer view of the Glossary, Index & Demos plugin, which was built as an editor and was unusable for pitching. This one is for **pitching**: dead simple in front, everything else folded away.

| | |
|---|---|
| Provides (manifest) | view:demonstration-designer, settings-tab:demonstration-designer, service:demonstrations@1 |
| Requires / optional / dependsOn | axf.speech@1 (optional) |
| Services provided in code | demonstrations@1 (server/__init__.py); service:demonstrations@1 (web library provides) |
| Services looked up in code | axf.speech@1 → agent-voice [optional] |
| Actions registered | pitch.export, pitch.generate, pitch.next, pitch.open, pitch.pause, pitch.play, pitch.prev, pitch.resume, pitch.stop |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, appMenu |
| Shared server modules | plugin_services |
| Routes exposed | 19 (0 websocket) |
| Commands (plugin-commands@1) | auto; 19 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/demonstration-designer |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | demos.mjs, engine.mjs, hooks.mjs, install.mjs, registry.mjs, server_test.py, test.mjs, uninstall.mjs |
| Doc mentions (tagged) | _claude/memory/STATUS.md (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### fable-rebuilds

**Fable rebuilds** v0.1.0 (ai.amberx.axf.console.fable-rebuilds). Every build parked for Fable in one place: what each replaces (the Opus plugin and its uninstall command), its branch, differences report, Android before/after screenshots and rebuild-log line, plus a ready-to-paste brief for the Fable session. Hooks: nav, the default context menu, Plugin Manager rows, Plan features and Pending builds rows (open it, or park a new Fable rebuild).

| | |
|---|---|
| Provides (manifest) | view:fable-rebuilds, dialog:fable-rebuilds.report, settings-tab:fable-rebuilds, action:fable-rebuilds.open, slot:plan.feature, slot:pending.item |
| Window events | emits axf:pending-changed; listens axf:pending-changed, axf:plan-changed |
| Actions registered | fable-rebuilds.open, fable-rebuilds.park-feature, fable-rebuilds.park-plugin |
| Banners / slots | slots pending.item, plan.feature |
| Library contributions (web/index.tsx) | views, dialogs, nav, settingsTabs, settingsPanels, contextMenu, appMenu, slots |
| Shared server modules | console_context |
| Routes exposed | 3 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/fable-rebuilds |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/memory/STATUS.md (1) |

### feature-assist

**Feature assistant** v0.1.0 (ai.amberx.axf.console.feature-assist). Plain-English features for the Feature Planner: describe a feature in your own words, the AXF expert drafts proper plan entries (sub-features, dependencies, ports, model) and flags clashes; you edit and approve; they go to the plan and the pending list. Build with Mosses on any unbuilt feature: confirm, plan, new build order, model choice (Opus now, Fable later), then Mosses builds it in the assistant chat with approval cards and snapshots. Settings → Plugins → Feature assistant.

README: `ai.amberx.axf.console.feature-assist` · built on Opus (Oct 18 2026).

| | |
|---|---|
| Provides (manifest) | slot:plan.top, slot:plan.feature, dialog:feature-assist.build, settings-tab:feature-assist, action:feature-assist.build |
| Requires / optional / dependsOn | service:axf.llm@1 (optional), service:axf.agents@1 (optional), service:axf.containers@1 (optional), service:axf.snapshots@1 (optional) |
| Services looked up in code | axf.agents@1 → agent-manager [optional]; axf.build-dispatch@1 → build-orchestrator [undeclared]; axf.containers@1 → container-access [optional]; axf.llm@1 → ai-assistant [optional]; axf.snapshots@1 → snapshot-manager [optional] |
| Window events | emits axf:plan-changed |
| Actions registered | feature-assist.build |
| Banners / slots | slots plan.feature, plan.top |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settingsPanels, appMenu, slots |
| Shared server modules | axf_framework, console_context, plugin_services |
| Routes exposed | 7 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/feature-assist |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |
| Flags | uses undeclared: axf.build-dispatch@1 |

### feature-matrix

**Feature matrix** v0.1.0 (ai.amberx.axf.console.feature-matrix). Every build gets a feature matrix (feature-matrix@1): grouped items, each with its minutes, model (Fable / Opus) and why; tick = keep, untick = skip; items can be added any time and are never deleted. All matrices are one dataset, shown as a grid of expandable rows (row = build: profile, date added, time cost of the kept items, kept / skipped, needs apply, last applied). Editing lights Apply, which pushes the totals, skips and estimates to every table the build lives in (orchestrator, pending list, build queue, build manager / change log, plan) through the framework's Apply engine. Every builds grid gets a row button and a right-click 'Feature matrix' (lib-datagrid row hooks). Files: _claude/builds/[profiles/<id>/]matrices.json, mirrored to the plugin data folder.

| | |
|---|---|
| Provides (manifest) | view:feature-matrix, settings-tab:feature-matrix |
| Requires / optional / dependsOn | axf.changes@1 (optional) |
| Services looked up in code | axf.changes@1 → codebase-changes [optional] |
| Actions registered | feature-matrix.open |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settings, settingsPanels, contextMenu, appMenu, slots |
| Shared server modules | plugin_services |
| Routes exposed | 6 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/feature-matrix |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, matrix.mjs, test.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/memory/STATUS.md (1), _claude/memory/docs/feature-matrix.md (25), _claude/memory/docs/rebuilds/LOG.md (1), _claude/memory/docs/rebuilds/feature-matrix-plugin.md (11) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### follow-amber

**Follow Amber** v0.1.0 (ai.amberx.axf.console.follow-amber). One switch: Follow Amber. On: whenever Amber (any Claude session through the console's MCP or axHub) mentions a console screen, settings tab, dialog or anything that needs you, she calls console_show and the console opens it right away, focused and highlighted, with what she said as a note; and every axHub held or confirm call for you pops up in the console as an approval dialog (title, plain description, the exact call folded away, the countdown on veto calls, big Approve and Deny that act on one tap, a queue when there are several). Decisions stay in the console: a tap goes to axHub through the approvals banner's relay with your own signed-in hub session, and the result shows in the pop-up; the console never approves anything by itself. Off: nothing opens by itself and approvals stay in the approvals banner. Switch it in Settings → Plugins → Follow Amber, the right-click menu anywhere in the console, or the banner chip. Showing only navigates (it runs with the navigate permission alone), so it never waits on a veto. REST /api/plugins/follow-amber (state, show, approval, stream), MCP console_show and console_follow, CLI axf follow-amber <command>.

| | |
|---|---|
| Provides (manifest) | settings-tab:follow-amber, service:follow-amber@1, dialog:follow-amber.approval, action:follow-amber.toggle, banner:follow-amber |
| Requires / optional / dependsOn | service:console-commands@1 (optional) |
| Services provided in code | follow-amber@1 (server/__init__.py) |
| Services looked up in code | axf.notify@1 → notify-control [undeclared]; console-commands@1 → console-commands [optional] |
| Own capability looked up (self) | follow-amber@1 |
| Actions registered | follow-amber.approvals, follow-amber.toggle |
| Banners / slots | slots app.frame.cover |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settings, settingsPanels, appMenu, slots |
| Shared server modules | plugin_services |
| Routes exposed | 6 (0 websocket) |
| Commands (plugin-commands@1) | auto; 5 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/follow-amber |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json, notify.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Doc mentions (tagged) | CLAUDE.md (1), _claude/THREADS.md (2), _claude/shared/rules/RULES.md (1), framework/spec/CONTROL.md (1) |
| Named by shell / framework (path or route) | apps/console-web/server/mcp_server.py (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | uses undeclared: axf.notify@1 |

### github-app

**GitHub** v0.1.0 (ai.amberx.axf.console.github-app). One-click GitHub App for the whole stack (github-app@1): Settings → Plugins → GitHub makes a private GitHub App on MossesX through GitHub's manifest flow (Create → Install on All repositories → Authorize as Brett). The console then mints its own installation tokens from the app's key (1 h, renewed at 50 min: they never die for good) and keeps GITHUB_TOKEN on them, so git, gh, the push banner, CI reads and the activity feed use the app; the old personal token stays as the fallback. A user token from the same app (refreshed by itself) creates repos. Health items for the app key, installation, token, rate limit and user token. Keys and tokens stay on the console server (.axf-console/github-app, 0700/0600) and never reach a browser; the broker is framework/cli/github-token.mjs.

README: One GitHub App for the whole stack, so GitHub access stops depending on personal tokens that die (Brett, Nov 1 2026).

| | |
|---|---|
| Provides (manifest) | service:axf.github-app@1, settings-tab:github-app |
| Requires / optional / dependsOn | service:axf.health@1 (optional) |
| Services provided in code | axf.github-app@1 (server/__init__.py) |
| Services looked up in code | axf.health@1 → systems-check [optional] |
| Library contributions (web/index.tsx) | settingsTabs, settingsPanels, appMenu |
| Shared server modules | console_context, plugin_services |
| Routes exposed | 8 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/github-app |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | CLAUDE.md (1), _claude/THREADS.md (1), _claude/memory/STATUS.md (1), install_steps.md (1) |
| Folder word quoted in shell / framework (check by hand) | framework/cli/github-app.mjs (2), framework/cli/github.mjs (1) |

### glossary-index

**Glossary, Index & Demos** v0.2.0 (ai.amberx.axf.console.glossary-index). An encyclopedia of AmberX AXF and the demonstrations written from it. Glossary (A–Z definitions), Index (a categorized tree, like the back of a book) and Grid views of every plugin, feature, screen, control, setting, command, asset, asset type, CLI tool, build option, job type and core concept, built from what the repo registers (plugin manifests, help entries, framework assets, the feature tracker, the UI registry) so it stays complete with no hand-kept list; every entry shows what it is, what it does, where it appears, its API (REST, MCP, CLI), what it links to and what links to it. From any entry, Generate demonstration writes a narrated demo (demonstration@1) with zero tokens; the Demonstration Designer edits its steps, narration, highlights and actions, plays it against the live UI (voice-controlled, chainable into tours) and keeps every recorded clip as a tagged asset (clip@1); the Book Builder writes books of chapters (book@1) from dragged-in entries, demonstrations and clips, with a live sandbox preview, a whole-book preview, the walkthrough video and generated documentation up to interactive HTML + TypeScript (docs@1). Rebuilt after every build (build-hook@1); CI fails when something registered has no entry. Also over REST, the MCP tools glossary_index_* and `axf glossary-index …`. No model, no tokens.

README: An encyclopedia of AmberX AXF inside the Dev Console, and the demonstrations written from it:

| | |
|---|---|
| Provides (manifest) | view:glossary-index, view:demo-designer, view:book-builder, dialog:glossary-index.book-wizard, dialog:glossary-index.add-to-book, tab:glossary-index.player, settings-tab:glossary-index, service:glossary@1 |
| Services provided in code | glossary@1 (server/__init__.py) |
| Actions registered | book.add, book.new, book.open, demo.generate, demo.next, demo.play, demo.prev, demo.repeat, demo.replay, demo.stop |
| Library contributions (web/index.tsx) | views, dialogs, tabs, nav, settingsTabs, settings, settingsPanels, appMenu |
| Shared server modules | plugin_services |
| Routes exposed | 20 (0 websocket) |
| Commands (plugin-commands@1) | auto; 19 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/glossary-index |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | build-hooks.mjs, catalog.mjs, demos.mjs, docs.mjs, hooks.mjs, install.mjs, test.mts, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (1), _claude/memory/STATUS.md (1), _claude/rules/RULES.md (1) |

### hub-sync

**axHub sync** v0.1.0 (ai.amberx.axf.console.hub-sync). Keeps the console's look, settings and (if picked) data on axHub, so every app and device matches: same colour theme, layout and settings on web, Android and everywhere else. Built on the framework library lib-hubsync (framework/libs/hubsync). Settings → Plugins → axHub sync: connect to axHub (address, project, test, sign in), choose what syncs (look always / follow / off, settings, data all or some tables), status. The console already takes its look from axHub, so here it adds the settings and data.

| | |
|---|---|
| Provides (manifest) | settings-tab:hubsync |
| Library contributions (web/index.tsx) | settingsPanels, appMenu |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Data dir | .axf-console/plugins/hub-sync |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |

### main-build-status

**Main build status** v0.1.0 (ai.amberx.axf.console.main-build-status). A dot on the banner, next to the clock, with the last CI result of the main branch of MossesX/AmberX-AXF (workflow “Android framework + console”): green “main ✓ 2m ago”, red “main ✗”, accent while it runs, grey when unknown. Tap it for the run title, commit, time and failed jobs, with a link to the run on GitHub. Repository, branch and workflow are settings (more than one may be watched). Built from the framework's status widget; the console server reads GitHub with its own token, which never reaches the browser.

README: `ai.amberx.axf.console.main-build-status` · built on Opus.

| | |
|---|---|
| Provides (manifest) | asset:status/main-build, banner:right, settings-tab:main-build-status |
| Actions registered | main-build-status.check, main-build-status.github, main-build-status.open |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settings, settingsPanels, appMenu |
| Shared server modules | axf_framework, console_context |
| Routes exposed | 3 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/main-build-status |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs, widget-check.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### maintenance

**Maintenance** v0.2.0 (ai.amberx.axf.console.maintenance). Server health and safe clean-up for the VPS (maintenance@1). A dashboard of disk, memory, swap, load, Docker images, volumes and build cache, build worktrees, logs and /tmp, with the biggest space users. Clean-up jobs (finished build worktrees, dangling Docker images and build cache, old logs, /tmp leftovers, containers stuck in Created) always preview first, then go to axHub as one held call: nothing is removed until Brett approves it, and the VPS re-checks every item before removing it. Never running containers, volumes in use or app data. Nightly auto-clean of the safe jobs (off by default), alerts at 80/85/90% disk and when swap stays nearly full (console and phone), the systems check row Server health with Auto fix, and a Server disk card for Home (server health is plain code, no AI). Clean up build profiles: audits every build profile (open builds, steps, copied tracker checklists and plans) against merged PRs, git history, reports, the catalog and the other profiles; each item gets keep / done already / not needed / duplicate / merge with a reason and proof. Preview first, untick anything, then apply: done → complete, the rest archived (never deleted), one undo per run, running builds never touched. Deep (AI) mode when a model is set up, Basic (exact matches) otherwise.

| | |
|---|---|
| Provides (manifest) | view:maintenance, settings-tab:maintenance |
| Requires / optional / dependsOn | service:axf.health@1 (optional) |
| Services looked up in code | axf.health@1 → systems-check [optional]; axf.llm@1 → ai-assistant [undeclared] |
| Actions registered | maintenance.profiles |
| Library contributions (web/index.tsx) | views, dialogs, nav, settingsTabs, settings, settingsPanels, appMenu |
| Shared server modules | axf_framework, console_context, plugin_services |
| Routes exposed | 15 (0 websocket) |
| Commands (plugin-commands@1) | auto; 15 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/maintenance |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json, notify.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Folder word quoted in shell / framework (check by hand) | framework/core/engines/card-rules.mjs (1) |
| Flags | uses undeclared: axf.llm@1; named in docs without the axf-plugin tag: _claude/THREADS.md |

### mcp-client

**MCP client** v0.2.0 (ai.amberx.axf.console.mcp-client). Connect the console to other MCP servers (Streamable HTTP) through the framework's MCP client library (ai.amberx.axf.mcp): browse their tools, resources and prompts, call tools, and keep a call log. Servers are managed in Settings → Plugins → MCP servers; tokens stay on the console server.

| | |
|---|---|
| Provides (manifest) | view:mcp, settings-tab:mcp |
| Library contributions (web/index.tsx) | settingsTabs, settingsPanels, appMenu |
| Routes exposed | 8 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES, NETWORK |
| Data dir | .axf-console/plugins/mcp-client |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1), _claude/memory/docs/rebuilds/lib-mcp.md (11) |

### md-studio

**MD Studio** v0.1.0 (ai.amberx.axf.console.md-studio). A Markdown browser and editor for every .md file Brett works with, on the dock engine. A column lists the files in collapsible categories by scope (Project, Claude, Repo, Notes Vault) with an edit switch per file and its reference chain as branches; files open as dock tabs that float, split, resize and drop on any tab header or into a split. Preview, edit or split with live preview, a Markdown toolbar, find and replace, autosave, conflict-safe saves and version history with restore. Four views (Browse, Read, Write, IDE), snippets to drag in, wizards for Claude md files, and a context view with token counts per referenced part.

| | |
|---|---|
| Provides (manifest) | view:md-studio, settings-tab:md-studio |
| Requires / optional / dependsOn | service:axf.notes@1 (optional) |
| Services looked up in code | axf.notes@1 → notes-browser [optional] |
| Actions registered | md-studio.context, md-studio.edit, md-studio.notes, md-studio.open, md-studio.open-below, md-studio.open-right, md-studio.save, md-studio.show, md-studio.toggle-edit, md-studio.view |
| Library contributions (web/index.tsx) | views, tabs, nav, settingsTabs, settings, settingsPanels, contextMenu, appMenu |
| Shared server modules | plugin_services |
| Routes exposed | 8 (0 websocket) |
| Commands (plugin-commands@1) | auto; 11 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/md-studio |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (1), _claude/memory/STATUS.md (1) |

### molly-guide

**Molly guide** v0.1.0 (ai.amberx.axf.console.molly-guide). Molly's narrated walkthroughs (walkthrough@1) in the console: ask her how to do something, or say it to AmberX, and a small floating window shows each step with Next and Previous while the console moves there, highlights it and reads the step out loud. Reaches Molly through the axf.agents@1 capability (the Agent manager provides it); AmberX's server asks her through this plugin's /ask route.

| | |
|---|---|
| Provides (manifest) | tab:molly.walkthrough, settings-tab:molly-guide |
| Services looked up in code | axf.agents@1 → agent-manager [undeclared]; axf.vinny@1 → agent-manager [undeclared] |
| Actions registered | molly.ask, molly.next, molly.prev, molly.replay |
| Library contributions (web/index.tsx) | tabs, settingsTabs, settings, settingsPanels, appMenu |
| Shared server modules | plugin_services |
| Routes exposed | 4 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/molly-guide |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Flags | uses undeclared: axf.agents@1, axf.vinny@1; named in docs without the axf-plugin tag: _claude/THREADS.md, _claude/memory/STATUS.md |

### notes-browser

**Notes** v0.1.0 (ai.amberx.axf.console.notes-browser). Brett's saved notes in one place: handoffs, session logs, plans, install notes and saved commands, kept in the hub's shared Claude files (/projects/_shared/_claude/notes). Folders and notes on the left, the rendered note on the right; search, sort by date or name, new note, rename, move between folders, delete (confirmed, history kept on the hub) and an edit switch that saves only when nobody else changed the note. Provides axf.notes@1 for other plugins (MD Studio's Notes scope).

| | |
|---|---|
| Provides (manifest) | view:notes, service:axf.notes@1, settings-tab:notes-browser |
| Services provided in code | axf.notes@1 (server/__init__.py) |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, appMenu |
| Shared server modules | plugin_services |
| Routes exposed | 8 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/notes-browser |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (1), _claude/memory/STATUS.md (2) |
| Folder word quoted in shell / framework (check by hand) | framework/core/engines/card-rules.mjs (1) |

### notify-control

**Notifications** v0.2.0 (ai.amberx.axf.console.notify-control). The one Notifications control panel: every notification the console, AmberX and axHub can send, in one registry that every sender checks. Per type: on or off, channels (banner, AmberX push, sound, console pop-up, web push / ntfy), priority and a test send; plus a master switch, one switch per app, quiet hours and a list of what was sent or blocked lately. Approvals and veto notices are guarded: the master and app switches skip them and only your own click turns them down. A plugin adds its types in its own notify.json. REST /api/plugins/notify-control, MCP notify-control_*, CLI axf notify-control <command>, capability axf.notify@1.

README: Brett, Nov 6 2026: "You need to have an administration panel. I need to control all the notifications."

| | |
|---|---|
| Provides (manifest) | view:notify-control, settings-tab:notify-control, action:notify-control.open, service:axf.notify@1 |
| Requires / optional / dependsOn | service:control@1 (optional), service:axf.claude-settings@1 (optional) |
| Services provided in code | axf.notify@1 (server/__init__.py) |
| Services looked up in code | axf.claude-settings@1 → claude-settings [optional]; axf.crew-sections@1 → agent-swarm [undeclared]; control@1 → token-control [optional] |
| Actions registered | notify-control.open |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settings, settingsPanels, appMenu |
| Shared server modules | console_context, plugin_services |
| Routes exposed | 17 (0 websocket) |
| Commands (plugin-commands@1) | auto; 17 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/notify-control |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (1), _claude/memory/STATUS.md (2), _claude/rules/RULES.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | uses undeclared: axf.crew-sections@1 |

### output-recorder

**Audio Output Recorder** v0.3.0 (ai.amberx.axf.console.output-recorder). Records everything the phone plays while it is on (AudioPlaybackCapture; the mic only as an opt-in second track, Record my mic too, off by default), in timestamped 30-minute chunks sent to axHub; each chunk stays on the phone until axHub confirms it, queued and retried while offline, within a small local cap. One switch in AmberX plus a quick-settings tile; Android asks for consent every start and shows a notification while recording. Calls and apps that block capture can't be recorded. The recordings list (play, share, delete, send to Audio Extract) shows in AmberX and on the console. Every part is transcribed on the VPS, with no model tokens, and saved with its session; transcripts are searchable.

README: Records everything the phone **plays** while it's on and keeps it on axHub. **The mic only when you turn it on** (opt-in "Record my mic too", below).

| | |
|---|---|
| Provides (manifest) | view:output-recorder, settings-tab:output-recorder |
| Services looked up in code | axf.claude-settings@1 → claude-settings [undeclared]; axf.health@1 → systems-check [undeclared] |
| Actions registered | output-recorder.start, output-recorder.stop, output-recorder.toggle |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settings, settingsPanels, appMenu |
| Shared server modules | console_context, plugin_services |
| Routes exposed | 2 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Data dir | .axf-console/plugins/output-recorder |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test_transcripts.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/memory/STATUS.md (1) |
| Flags | uses undeclared: axf.claude-settings@1, axf.health@1; named in docs without the axf-plugin tag: _claude/THREADS.md |

### plan-studio

**Plan Studio** v0.1.0 (ai.amberx.axf.console.plan-studio). Every plan in one place (plan@1: JSON + a Markdown body). Enter plans by hand in a full sectioned editor (templates, autosave, quick capture), file them in nested categories, and view them as a tree, grid, sub-grids, board, roadmap or reader. Plain-English AI edits plans as a diff to apply or undo, and AmberX talks plans through by voice. Turn a plan into an orchestrator build and follow its progress. The Catalog lists every plugin, app, library, framework module and axHub with its features checked off as have, partial, planned or idea. Plans live in the hub's shared data (plan-studio/), so claude.ai and VPS sessions read and write them through axhub.memory_read / memory_write; plans.mjs is the CLI.

| | |
|---|---|
| Provides (manifest) | view:plan-studio, settings-tab:plan-studio, service:plans@1 |
| Requires / optional / dependsOn | axf.llm@1 (optional), axf.agent-voice@1 (optional) |
| Services provided in code | plans@1 (server/__init__.py); plans@1 (web library provides) |
| Services looked up in code | axf.llm@1 → ai-assistant [optional]; axf.agent-voice@1 → agent-voice [optional] |
| Own capability looked up (self) | plans@1 |
| Shared globals | __axfMicLease |
| Window events | emits axf:agent-voice.say |
| Actions registered | plan-studio.capture, plan-studio.open |
| Library contributions (web/index.tsx) | views, dialogs, nav, settingsTabs, settings, settingsPanels, contextMenu, appMenu, slots |
| Shared server modules | plugin_services |
| Routes exposed | 5 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/plan-studio |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | catalog.mjs, hooks.mjs, install.mjs, plans.mjs, test.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (2), _claude/memory/STATUS.md (1), _claude/memory/docs/plan-studio/README.md (4), _claude/shared/rules/RULES.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1), apps/console-web/server/mcp_server.py (1), framework/core/build-priority.mjs (1) |

### plugin-commands

**Plugin commands** v0.1.0 (ai.amberx.axf.console.plugin-commands). Every plugin, existing and new, exposes all of its commands and reads automatically, so Claude (through axHub), the REST API and the CLI can do anything a plugin can. Commands come from what a plugin already has: its server routes (GET = a read, POST/PUT = a command, DELETE = a delete that needs a confirm token), its registered actions (run in your open console), its data folder (secrets redacted) and plugin.json commands. Surfaces: REST /api/control/<plugin>/<command>, MCP tools <plugin>_<command> plus plugin_commands, plugin_read and plugin_run on the console's /mcp, and the CLI `axf <plugin> <command>` / `axf plugins`. They follow installs, uninstalls and on/off switches by themselves. The Plugin commands page lists every command with its REST route, MCP tool and CLI line, and runs reads.

| | |
|---|---|
| Provides (manifest) | view:plugin-commands, settings-tab:plugin-commands, service:plugin-commands@1 |
| Requires / optional / dependsOn | control@1 (optional), console-commands@1 (optional) |
| Services provided in code | plugin-commands@1 (server/__init__.py) |
| Services looked up in code | console-commands@1 → console-commands [optional]; control@1 → token-control [optional] |
| Actions registered | plugin-commands.open |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, appMenu |
| Shared server modules | console_context, plugin_services |
| Routes exposed | 7 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/plugin-commands |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | commands.mjs, hooks.mjs, install.mjs, server/test_plugin_commands.py, test.mjs, uninstall.mjs |
| Doc mentions (tagged) | _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/views/HomeCards.tsx (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md, _claude/rules/RULES.md |

### plugin-manager

**Plugin Manager** v0.2.0 (ai.amberx.axf.console.plugin-manager). Every console plugin in one place: info, health, enable / disable, logs, settings, its UI, install & uninstall, and its dependencies in detail (what it needs, who provides it, who needs it, what clashes). Five views (cards, table, detail, dependency graph, install from the catalog) in four completely different layouts (Studio, Mission control, Terminal, Catalog). The model is the framework's plugin inventory engine (plugin-inventory@1), shared with every AXF web app's Settings → Plugins tab and the Android Plugin Manager. Opened from the default context menu, the Plugins nav section or Settings → Plugins → Plugin Manager.

| | |
|---|---|
| Provides (manifest) | view:plugin-manager, dialog:plugin-manager.window, action:plugin-manager.open, action:plugin-manager.window, context-menu:default/plugin-manager, settings-tab:plugin-manager |
| Window events | emits axp-plugin-manager:select; listens axp-plugin-manager:select |
| Actions registered | plugin-manager.install, plugin-manager.layout, plugin-manager.open, plugin-manager.view, plugin-manager.window |
| Library contributions (web/index.tsx) | views, dialogs, nav, settingsTabs, settings, settingsPanels, contextMenu, appMenu |
| Shared server modules | console_context, plugin_services |
| Routes exposed | 9 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES, MENU_ITEMS, SETTINGS |
| Data dir | .axf-console/plugins/plugin-manager |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, server/test_lazy.py, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (2), _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/handoff/context/claude__memory__decisions.md (1), _claude/memory/STATUS.md (1), _claude/memory/decisions.md (1), _claude/memory/docs/rebuilds/plugin-manager.md (1) |
| Named by shell / framework (path or route) | apps/console-web/src/pluginLoader.tsx (2) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/axf/core/engines/embed.ts (1), apps/console-web/src/lazyEngine.ts (1), framework/cli/rebuild-shots.mjs (1) |
| Flags | named in docs without the axf-plugin tag: _claude/rules/RULES.md |

### plugin-switches

**Plugin switches** v0.1.0 (ai.amberx.axf.console.plugin-switches). A pop-up dialog with a simple list of every plugin and a switch to turn each one on or off. Its own switch is greyed out, so it can't switch itself off from its own list. Warns when switching off a plugin that another running plugin needs. Open it from the right-click / long-press menu anywhere, the action plugin-switches.open, search, or Settings → Plugins → Plugin switches.

| | |
|---|---|
| Provides (manifest) | dialog:plugin-switches, settings-tab:plugin-switches |
| Actions registered | plugin-switches.open |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settingsPanels, contextMenu, appMenu |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Data dir | .axf-console/plugins/plugin-switches |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/server/test_plugin_catalog.py (9) |

### plugin-update

**Plugin Update** v0.1.0 (ai.amberx.axf.console.plugin-update). Every installed plugin with the model that built it, when it was built and its version, checked against the plugin catalog on axHub. A newer version by the same model installs with one click (Update); a build by another model offers Replace, which lists the removal of the old build and the installation of the new one and swaps them in the same folder once confirmed; Rebuild with <model> parks a from-scratch rebuild on the pending list for the Build manager. Never two builds of one plugin. Nav → Plugins → Plugin Update, Settings → Plugins → Plugin Update.

| | |
|---|---|
| Provides (manifest) | view:plugin-update, settings-tab:plugin-update, action:plugin-update.open |
| Actions registered | plugin-update.open |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, contextMenu, appMenu |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Data dir | .axf-console/plugins/plugin-update |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/memory/STATUS.md (1) |

### plugins-menu

**Plugins menu** v0.1.0 (ai.amberx.axf.console.plugins-menu). Right-click (or long-press) anywhere → Plugins: Install… (a plugin browser over every archive location: axHub, the permanent one, needs its credentials; folders, https servers and other consoles can be added with their credentials, kept on the console server only; download and install from there, with the installer's own settings), Settings… (the settings browser: every installed plugin in a collapsible column and the picked plugin's own settings beside it; a dialog by default, switchable to a floating window; its own basic, style, switch and behaviour settings plus a placeholder for every parameter type), Manage (the Plugin Manager), Enable ▸ (the switched-off plugins: pick one to turn it on) and Disable ▸ (the opposite).

| | |
|---|---|
| Provides (manifest) | dialog:plugins-menu.settings, dialog:plugins-menu.install, settings-tab:plugins-menu, action:plugins-menu.settings, action:plugins-menu.install |
| Actions registered | plugins-menu.disable, plugins-menu.enable, plugins-menu.info, plugins-menu.install, plugins-menu.manage, plugins-menu.settings, plugins-menu.toggle |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settings, settingsPanels, appMenu, appMenuProviders |
| Shared server modules | axf_framework, build_defaults, console_context |
| Routes exposed | 9 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/plugins-menu |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### project-wizard

**Project wizard** v1.0.0 (ai.amberx.axf.console.project-wizard). Turns a GitHub repo, a VPS repo, a folder or a new AXF app into a Claude project: name and description, a home on GitHub, the VPS and/or a local git folder (existing or new), a validated project manifest and _claude/ files, and a Claude.ai project kit (instructions + context files). Ported from xGallery's New project wizard.

| | |
|---|---|
| Provides (manifest) | view:project-wizard, settings-tab:project-wizard |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, appMenu, help |
| Routes exposed | 8 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES, FILES, NETWORK |
| Lifecycle files | NO install.mjs, NO uninstall.mjs, NO README.md, help.json |
| Tests / CLI scripts | test.mjs, wizard.mjs |
| Flags | named in docs without the axf-plugin tag: _claude/memory/STATUS.md |

### push-banner

**Push banner** v0.8.0 (ai.amberx.axf.console.push-banner). A banner listing every branch that isn't on main yet in AmberX-AXF and axHub (commits ahead/behind, age, last commit, its open PR and that PR's CI), with Open PR and Merge: every change reaches main only through its PR (one is opened for every branch), brought up to date with main and re-tested before it merges (not behind, CI passed on the pinned head; re-checked on the server). Auto-merge takes ready PRs oldest first, one merge per round, and sets branch protection on main where the token may. Auto-land (land/land.mjs, plain scripts on the VPS, no model calls) lands every finished build: worktree cleaned, main merged in with the builds files newer-wins, PR opened, CI started, merged here in dependency order once green and not held by UI Review; blocked builds are pushed to Brett once, in plain words. The console server talks to GitHub with its own token, which never reaches the browser. Merge queue (0.7.0): GitHub's own merge queue needs an organisation-owned repo, so the queue is ours: ready PRs line up, each is tested once on top of main + every PR ahead of it (queue/pr-<n> branches), the green head merges with no retest, a red one is kicked out with the reason in plain words and the ones behind it are retested without it; CI runs only what a change touches, PRs run light checks while the queue is on. Merge queue view, banner chip, REST + MCP + CLI. 0.7.1 (Nov 4 2026, Brett: "Stop merging these things one at a time"): auto-land is off by default and only the merge queue merges AmberX-AXF; GitHub reads are cached with ETags (a 304 costs no API call) and held back when the shared limit runs low; the console redeploys once per stack. 0.8.0 (Nov 10 2026, Brett: "Everything needs to go into the merge queue so we can make one build out of it before we send it to CI"): batch mode by default: every finished build gets a PR and joins the queue, up to batchSize ready PRs are combined into one commit on queue/batch, CI runs once, and a green batch lands on main as that one commit (one redeploy); a red batch is split in half until the PR that broke it is kicked out. Merge on AmberX-AXF puts the PR in the queue.

| | |
|---|---|
| Provides (manifest) | banner:push-banner, service:axf.merge-queue@1, settings-tab:push-banner |
| Requires / optional / dependsOn | service:axf.activity@1 (optional) |
| Services provided in code | axf.merge-queue@1 (server/__init__.py) |
| Services looked up in code | axf.activity@1 → activity [optional]; axf.agents@1 → agent-manager [undeclared]; axf.build-dispatch@1 → build-orchestrator [undeclared]; axf.changes@1 → codebase-changes [undeclared]; axf.github@1 → systems-check [undeclared]; axf.health@1 → systems-check [undeclared]; axf.vinny@1 → agent-manager [undeclared]; ui-review@1 → ui-review [undeclared] |
| Actions registered | push-banner.check, push-banner.queue |
| Banners / slots | banners push-banner, push-banner.prefs; manifest banner ["push-banner"] |
| Library contributions (web/index.tsx) | settingsTabs, settings, settingsPanels, appMenu, banners |
| Shared server modules | axf_framework, console_context, plugin_services |
| Routes exposed | 27 (0 websocket) |
| Commands (plugin-commands@1) | auto; 10 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/push-banner |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json, notify.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (4), _claude/handoff/context/CLAUDE.md (3), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (4), _claude/rules/RULES.md (1), _claude/shared/rules/RULES.md (2) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | uses undeclared: axf.agents@1, axf.build-dispatch@1, axf.changes@1, axf.github@1, axf.health@1, axf.vinny@1, ui-review@1 |

### ref-links

**Reference links** v0.1.0 (ai.amberx.axf.console.ref-links). Text in the banners (In progress, Ready to merge, Merged, Live, the build and status banners, Codebase changes) that mentions a real part of the app is a link: a screen, a settings tab, section or single setting, a plugin, dialog, toolbar, menu, component, build, PR, agent or file. Tap = a peek card (what it is, where it lives, whether a build is changing it), double-tap = open it and highlight it, hold or right-click = Open, Open in new window, Show in UI Review, Show the build that's changing it, Copy link. A build's declared refs ('touches: settings.terminal, toolbar.terminal') win over names. Plain matching from the console's own registries (ref@1), no model, no tokens. Also over REST, the MCP tools ref_links_find / ref_links_resolve / ref_links_open and `axf ref-links …`.

| | |
|---|---|
| Provides (manifest) | settings-tab:ref-links, service:ref-links@1 |
| Requires / optional / dependsOn | service:console-commands@1 (optional), service:ui-review@1 (optional), service:axf.agents@1 (optional) |
| Services provided in code | ref-links@1 (server/__init__.py) |
| Services looked up in code | axf.agents@1 → agent-manager [optional]; console-commands@1 → console-commands [optional]; ui-review@1 → ui-review [optional] |
| Own capability looked up (self) | ref-links@1 |
| Library contributions (web/index.tsx) | settingsTabs, settings, settingsPanels, appMenu, slots |
| Shared server modules | plugin_services, readcache |
| Routes exposed | 4 (0 websocket) |
| Commands (plugin-commands@1) | auto; 4 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/ref-links |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, refs.mjs, server/test_ref_links.py, test.mjs, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (2), _claude/memory/STATUS.md (1) |

### session-checkin

**Session check-in** v1.0.0 (ai.amberx.axf.console.session-checkin). Every new Claude Code session opens with a short group of questions (location first, then repo, container, project, memory files read-only, model, effort with a fixed baseline cost) and is logged to a browsable session archive. Installed from Settings → Plugins → Session check-in with an interactive wizard.

| | |
|---|---|
| Provides (manifest) | view:sessions, settings-tab:session-checkin |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, appMenu |
| Routes exposed | 9 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES, FILES |
| Lifecycle files | install.mjs, NO uninstall.mjs, NO README.md, help.json |
| Tests / CLI scripts | checkin.mjs, install.mjs, lib.mjs, test.mjs |
| Flags | named in docs without the axf-plugin tag: _claude/memory/STATUS.md |

### shipped-features

**Shipped features** v0.1.0 (ai.amberx.axf.console.shipped-features). Every individual feature of AmberX-AXF and axHub in one sortable list, from the moment a build plans it to when it went live: status (Planned, Queued, Building, In PR, Merged, Live, Cancelled, Removed), the builds, PRs and commits behind it, Brett's verbatim prompt, the model and agent, and every later edit as its own timeline. A three-level grid (group, feature, details) with View by PR, build, day, app, plugin, type or repo, quick filters (hide completed, hide pending, status, has edits, being edited) remembered per device, and CSV / Markdown export. Fed live by build-hook@1 (every builds store write) and the deploy log (deploy-log@1), backfilled from git history, PRs and the builds journal. Every landed build carries the orchestrator's shipped manifest (shipped-manifest@1: Brett's prompt and the full brief, models, accounts, steps with estimates and actual times, branch, PR, landed commit, files, tests, UI Review, cost, report, what is open), shown on each entry and readable, searchable and writable through the API, MCP, axHub, CLI, deep link (?shipped=<build or feature id>) and voice. Data in SQLite (feature-ledger@1).

README: Every individual feature of AmberX-AXF and axHub in one sortable list, from the moment a build plans it to when it went live, with every later change kept as an edit of that feature.

| | |
|---|---|
| Provides (manifest) | view:shipped-features, settings-tab:shipped-features |
| Actions registered | shipped-features.open, shipped-features.show, shipped-features.sync |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, appMenu |
| Routes exposed | 13 (0 websocket) |
| Commands (plugin-commands@1) | auto; 13 explicit, 4 with voice hints |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/shipped-features |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | CLAUDE.md (1), _claude/memory/STATUS.md (1), framework/spec/PORTING.md (2) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### snapshot-manager

**Snapshot Manager** v0.1.0 (ai.amberx.axf.console.snapshot-manager). Snapshots of container files, taken before every approved change and restorable in one step (restore snapshots the current state first, so an undo can be undone). Browse by container and date, view the diff, restore, delete, retention (30 days, 5 GB by default; node_modules and caches skipped), and the change log. Settings → Plugins → Snapshots.

README: `ai.amberx.axf.console.snapshot-manager` · built on Opus (Oct 18 2026).

| | |
|---|---|
| Provides (manifest) | settings-tab:snapshots, service:axf.snapshots@1 |
| Requires / optional / dependsOn | service:axf.containers@1 (required) |
| Services provided in code | axf.snapshots@1 (server/__init__.py) |
| Services looked up in code | axf.containers@1 → container-access [required] |
| Own capability looked up (self) | axf.snapshots@1 |
| Actions registered | snapshots.show |
| Library contributions (web/index.tsx) | settingsTabs, settingsPanels, appMenu |
| Shared server modules | axf_framework, plugin_services |
| Routes exposed | 12 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/snapshot-manager |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |

### systems-check

**Systems check banner** v0.4.0 (ai.amberx.axf.console.systems-check). The systems check, Keys and What's new banners at the top of every view. Every key and connection is tested live against its service (every 15 minutes, on start and on Check now); anything broken is a red banner item saying what broke, what it breaks and since when, with a fix, pushed once to AmberX. Any plugin adds a live check through axf.health@1. Fix it yourself: a red check with a fix the console can run is fixed first (VPS commands as veto calls), re-checked, and shown red only if still broken (per check: on / ask first / off). GitHub goes through axHub first (axf.github@1, local GITHUB_TOKEN as fallback). Checks come from reading the codebase (every plugin, the services it needs and its own declared self-checks, project manifests, shared data) plus the built-in credential, GitHub, Coolify, axHub and VPS checks. With the AI switch on (needs the AI assistant and Mosses), Mosses adds checks and saves them as a routine that runs without AI, and summarises what's new. Settings → Plugins → Systems check.

README: `ai.amberx.axf.console.systems-check` · built on Opus (Oct 18 2026; moved out of the console core).

| | |
|---|---|
| Provides (manifest) | dialog:system-check, settings-tab:systems-check, action:system-check.open, banner:systems-check, banner:whats-new, service:axf.syscheck@1, service:axf.health@1, service:axf.github@1 |
| Requires / optional / dependsOn | service:axf.llm@1 (optional), service:axf.agents@1 (optional) |
| Services provided in code | axf.health@1 (server/__init__.py); axf.syscheck@1 (server/__init__.py) |
| Services looked up in code | axf.agents@1 → agent-manager [optional]; axf.ai-keys@1 → ai-keys [undeclared]; axf.build-dispatch@1 → build-orchestrator [undeclared]; axf.changes@1 → codebase-changes [undeclared]; axf.containers@1 → container-access [undeclared]; axf.crew-sections@1 → agent-swarm [undeclared]; axf.llm@1 → ai-assistant [optional]; axf.vinny@1 → agent-manager [undeclared] |
| Views / dialogs / actions of other plugins used | action build-orchestrator.open (build-orchestrator) |
| Own capability looked up (self) | axf.github@1 |
| Dynamic lookups (variable argument; every capability string in that file counted) | server/derive.py: get(name); server/derive.py: get(r.split(":", 1); server/routine.py: get(p["name"]) |
| Actions registered | keys-needed.open, system-check.open |
| Banners / slots | banners keys-needed, systems-check, whats-new; manifest banner ["keys-needed","systems-check","whats-new"] |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settingsPanels, appMenu, banners |
| Shared server modules | axf_framework, console_context, credentials, plugin_services, readcache |
| Routes exposed | 31 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES, NETWORK |
| Data dir | .axf-console/plugins/systems-check |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1), _claude/shared/rules/RULES.md (2) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (2) |
| Flags | uses undeclared: axf.ai-keys@1, axf.build-dispatch@1, axf.changes@1, axf.containers@1, axf.crew-sections@1, axf.vinny@1; declares a service not matched to a provide call (code has unresolved provide(s): server/__init__.py: provide(githubsvc.github_hub.CAPABILITY)): axf.github@1; named in docs without the axf-plugin tag: _claude/THREADS.md |

### theme-editor

**Theme editor** v0.1.0 (ai.amberx.axf.console.theme-editor). Edit colour and style themes token by token. A Colour section and a Style section, each collapsible, with collapsible categories listing every token the asset types and known themes have (new tokens show up by themselves). Copy a theme, save it as a standard asset@1 theme, load any theme; edits preview live and apply through the hub look, so every app follows. Toolbar views: tree, grid, swatches, compare. Uses the Theme manager's token tree (axf.token-tree@1). Nav → Plugins → Theme editor; Settings → Plugins → Theme editor.

README: `ai.amberx.axf.console.theme-editor` · built on Opus.

| | |
|---|---|
| Provides (manifest) | view:theme-editor, settings-tab:theme-editor, action:theme-editor.open |
| Requires / optional / dependsOn | service:axf.token-tree@1 (required) |
| Services looked up in code | axf.token-tree@1 → theme-manager [required] |
| Shared globals | __axfWebServices |
| Actions registered | theme-editor.open |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settings, settingsPanels, appMenu |
| Shared server modules | axf_framework, console_context |
| Routes exposed | 3 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/theme-editor |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/memory/STATUS.md (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### theme-manager

**Theme manager** v0.3.0 (ai.amberx.axf.console.theme-manager). Roll colour, style and layout themes, or every themeable part at once. A tree of every token (built from the asset types, so new types show up by themselves) with tri-state ticks, locks, presets and search picks what a roll may change; rolls stay readable (contrast-checked palettes, sizes within the range the known themes use). Live preview, undo/redo, pin favourites, edit any value by hand, save a roll as standard asset@1 themes and manage them (apply, rename, duplicate, export, import, delete). Phone: drill-down tree. Nav → Plugins → Theme manager; Settings → Plugins → Themes.

README: `ai.amberx.axf.console.theme-manager` · built on Opus.

| | |
|---|---|
| Provides (manifest) | view:theme-manager, settings-tab:theme-manager, action:theme-manager.open, service:axf.token-tree@1 |
| Services provided in code | axf.token-tree@1 (web/index.tsx) |
| Shared globals | __axfWebServices |
| Window events | emits axf:tm-saved; listens axf:tm-saved |
| Actions registered | theme-manager.open |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, appMenu |
| Shared server modules | axf_framework, console_context |
| Routes exposed | 22 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/theme-manager |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, roll-check.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | framework/cli/plugin-instances.mjs (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md, _claude/rules/RULES.md |

### todo-manager

**Todo manager** v0.1.0 (ai.amberx.axf.console.todo-manager). Lists with nested groups holding notes, to-dos and tasks (subtasks, checklists, tags, due dates, custom fields per kind), shown as a tree (by lists, kind, status, priority, tag or due date) or a grid, with group actions and Markdown export. Ported from xGallery's developer task manager. Tabable: a host app can show it as a tab of its own.

| | |
|---|---|
| Provides (manifest) | view:todo-manager, dialog:todo-manager.entry, settings-tab:todo-manager |
| Actions registered | todo-manager.delete, todo-manager.done, todo-manager.edit, todo-manager.new, todo-manager.open, todo-manager.reload, todo-manager.subtask |
| Library contributions (web/index.tsx) | views, dialogs, nav, settingsTabs, settingsPanels, contextMenu, appMenu |
| Shared server modules | axf_framework, console_context |
| Routes exposed | 15 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/todo-manager |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |

### token-control

**Token control** v0.2.0 (ai.amberx.axf.console.token-control). One API, MCP server and CLI for everything control@1 covers: every theme, style, layout, typography, density and sizing token (a set is an override that rides the axHub look, so every app follows), the active asset per slot, every AmberX note, to-do, task and list, and the planner (Plan Studio plans, orchestrator builds and their steps). REST under /api/control, MCP tools control_* and amberx_* on the console's /mcp (and through axHub), CLI `axf control` with the aliases `axf token | note | todo | task | list | plan | build`. Deletes always need a confirm token. Interactive docs with try-it panels for all three, generated from the control@1 schema. Veto passes (control-pass@1): "allow everything for the next 30 minutes" — Brett approves a timed pass once and every command (scope all, the default; or only token set / reset in a narrow scope) skips the axHub veto until it ends (irreversible deletes only when included); banner chip with a live countdown, audit + undo, signed publication for axHub at GET /api/plugins/token-control/pass.

| | |
|---|---|
| Provides (manifest) | view:token-control, settings-tab:token-control, service:control@1, banner:token-pass |
| Requires / optional / dependsOn | plans@1 (optional) |
| Services provided in code | control@1 (server/__init__.py) |
| Services looked up in code | console-commands@1 → console-commands [undeclared]; plugin-commands@1 → plugin-commands [undeclared] |
| Own capability looked up (self) | control@1 |
| Banners / slots | manifest banner ["token-pass"] |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, appMenu, banners |
| Shared server modules | plugin_services |
| Routes exposed | 21 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/token-control |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | control.mjs, gen-amberx-core.mjs, hooks.mjs, install.mjs, test.mjs, uninstall.mjs |
| Doc mentions (tagged) | _claude/THREADS.md (5), _claude/memory/STATUS.md (3), framework/spec/CONTROL.md (3) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | uses undeclared: console-commands@1, plugin-commands@1; declares but never looks up: plans@1 |

### ui-review

**UI Review** v0.6.0 (ai.amberx.axf.console.ui-review). Every UI a build makes comes here for Brett's approval, one section per kind (open registry: Design packs, Whole apps / programs, Screens & pages, Settings interfaces, Dialogs & popups, Menus & toolbars, Banners & cards, Other). Each item carries its app, build, branch and PR, desktop + phone screenshots, notes, a status (waiting, approved, changes asked, rejected), his comment and its history. Views: tree, collapsible grid, grid with sub-grids, gallery and side-by-side compare, all with multi-select and bulk Approve / Ask changes / Reject. Builds submit through review.mjs, POST /api/plugins/ui-review/submit or rebuild-shots --submit; other plugins read the per-branch / per-PR state through the ui-review@1 capability. Design packs (formerly their own plugin) are one section: pick up to 3. Screenshots tab (ui-screenshot@1): ad-hoc pictures (check sessions, live captures, PR before/after, uploads) that never enter the approve / reject queue, saved with axf shot / POST shots / Upload; grid grouped by app, screen, source or day, thumbnails, full-screen viewer with before/after slider, copy link, delete, Send to review. Predicted looks (ui-prediction@1): when a build that changes UI is launched, framework/cli/ui-predict.mjs makes a mockup of each screen it will touch (framework controls, current theme, demo data) and files it here as 'Predicted - approve the look' next to the screen as it is now; Approve look / Ask changes (the comment goes to the build) / Reject (the build is held). Setting: wait for the look approval before UI builds start. The predicted pictures refresh while the build runs and the real after-shots replace them at the end (badge Real, predicted vs real compare).

README: Brett, Oct 30 2026 (voice, driving): rename the Design packs plugin and make it one all-in-one UI approval plugin. Every UI a build makes goes there for his approval, separated by type, with design packs as one section.

| | |
|---|---|
| Provides (manifest) | view:ui-review, view:design-packs, settings-tab:ui-review, service:ui-review@1, service:ui-screenshots@1 |
| Services provided in code | ui-review@1 (server/__init__.py) |
| Services looked up in code | axf.claude-settings@1 → claude-settings [undeclared]; axf.health@1 → systems-check [undeclared] |
| Actions registered | ui-review.design-packs, ui-review.open, ui-review.screenshots |
| Library contributions (web/index.tsx) | views, dialogs, nav, settingsTabs, settings, settingsPanels, appMenu, slots |
| Shared server modules | console_context, plugin_services |
| Routes exposed | 15 (0 websocket) |
| Commands (plugin-commands@1) | auto; 15 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/ui-review |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json, notify.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, migrate.mjs, review.mjs, shots.mjs, test.mts, test.py, uninstall.mjs |
| Doc mentions (tagged) | CLAUDE.md (1), _claude/shared/rules/RULES.md (5) |
| Folder word quoted in shell / framework (check by hand) | framework/core/build-priority.mjs (1), framework/core/engines/card-rules.mjs (1), framework/core/headless-context.mjs (1), framework/core/ui-predict.mjs (1) |
| Flags | uses undeclared: axf.claude-settings@1, axf.health@1; declares a service the code never provides (manifest marker, CLI contract or web-only): ui-screenshots@1; named in docs without the axf-plugin tag: _claude/THREADS.md, _claude/memory/STATUS.md |

### voice-notes

**Voice notes** v0.2.0 (ai.amberx.axf.console.voice-notes). Sets up a voice-activated notes pusher and shows the notes it saved. A start trigger, a beep, the note, a stop trigger (cut from the text and the recording), then it asks where to store it: say a list, or "give me the list of lists" and it reads them with their numbers, and you say a number. Each list can ask its own questions, opened by a number or a recorded trigger, and file notes into subcategories. Settings, lists and notes live on axHub's data server through the framework's lib-hubstore, never on this device. The listener is Voice Vault on Android (it saves notes to the notes table on axHub); the Voice notes page fetches them (newest first, by list, search, copy, delete) and can be added as a tab by a host app.

| | |
|---|---|
| Provides (manifest) | settings-tab:voice-notes, view:voice-notes |
| Library contributions (web/index.tsx) | views, nav, settingsTabs, settingsPanels, appMenu |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Data dir | .axf-console/plugins/voice-notes |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, NO README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.py, uninstall.mjs |
| Doc mentions (tagged) | _claude/handoff/context/CLAUDE.md (1), _claude/handoff/context/apps__console-web__plugins__README.md (1), _claude/memory/STATUS.md (1) |
| Folder word quoted in shell / framework (check by hand) | framework/core/engines/control-rules.mjs (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

### whats-shipped

**What's new** v0.1.0 (ai.amberx.axf.console.whats-shipped). A What's new widget on the banner: a ticker of the newest features merged to main (and deployed), with an unread count. Tap it for the panel: everything shipped, grouped by date, by build or by app, with search, details (what it does, where to find it, PR and report links), mark read and new-since-last-visit highlighting. Built from what actually shipped (merged pull requests, the builds store, build reports, Codebase changes entries); no model tokens.

README: `ai.amberx.axf.console.whats-shipped` · built on Opus (Nov 3 2026, Urgent build `whats-new-banner`).

| | |
|---|---|
| Provides (manifest) | asset:status/shipped, banner:right, dialog:whats-shipped.panel, settings-tab:whats-shipped |
| Actions registered | whats-new.open, whats-shipped.check, whats-shipped.open, whats-shipped.read-all |
| Library contributions (web/index.tsx) | dialogs, settingsTabs, settings, settingsPanels, appMenu |
| Shared server modules | axf_framework, console_context |
| Routes exposed | 3 (0 websocket) |
| Commands (plugin-commands@1) | auto; 0 explicit |
| Scopes | ROUTES |
| Data dir | .axf-console/plugins/whats-shipped |
| Lifecycle files | install.mjs, uninstall.mjs, hooks.mjs, README.md, help.json |
| Tests / CLI scripts | hooks.mjs, install.mjs, test.mts, test.py, uninstall.mjs |
| Doc mentions (tagged) | framework/spec/PORTING.md (1) |
| Folder word quoted in shell / framework (check by hand) | apps/console-web/src/lazyEngine.ts (1) |
| Flags | named in docs without the axf-plugin tag: _claude/THREADS.md |

