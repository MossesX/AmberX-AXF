# Plugin review: what each plugin does, depends on, and breaks

Generated 2026-11-12T18:18:38.607Z by _claude/builds/reports/plugin-review/plan.mjs from deps.json (step 1) and reverse.json (step 2). 66 console plugins. The same four lists, in compact form, sit on every step of the Plan Studio plan "Plugin review: what to disable" (plugin-review-what-to-disable-8i0h) and in its body.

Read-only analysis: nothing is disabled here. Brett decides keep or disable per plugin in the plan.

Severity: **stops working** = a required capability or a dispatched action; **loses a feature** = optional or undeclared capability, or an event; **goes unheard** = an event this plugin listens for. Undeclared lookups are a manifest gap: the Plugin Manager cannot warn before removal (REVERSE.md lists the fixes).

## Core plugins: never disable

| Plugin | Why |
|---|---|
| agent-manager | hard dependents: claude-accounts; used by 11 plugins |
| ai-assistant | named by the console shell / framework: apps/console-web/src/axf/core/assistant.ts; hard dependents: agent-voice; used by 8 plugins |
| approvals-banner | named core by Brett in the build brief |
| build-orchestrator | hard dependents: systems-check; named core by Brett in the build brief |
| codebase-changes | used by 5 plugins |
| console-commands | provides framework contract console-commands@1 |
| console-terminal | hard dependents: claude-accounts |
| container-access | hard dependents: snapshot-manager; used by 6 plugins |
| follow-amber | named by the console shell / framework: apps/console-web/server/mcp_server.py |
| hub-sync | named core by Brett in the build brief |
| plugin-commands | provides framework contract plugin-commands@1 |
| plugin-manager | named by the console shell / framework: apps/console-web/src/pluginLoader.tsx; named core by Brett in the build brief |
| plugin-switches | hard dependents: ai-assistant, basic-filter |
| systems-check | used by 11 plugins |
| theme-manager | hard dependents: theme-editor |
| token-control | hard dependents: claude-settings; provides framework contract control@1 |

## The table

| Plugin | Tier | What it does | What breaks if disabled | Depends on | Used by |
|---|---|---|---|---|---|
| **activity** | shared | A banner at the top of the console whenever anything is built, edited, deleted, pushed, pulled, merged or thought about, queued or running: GitHub Actions runs, the console's own update, AI assistant replies, VPS Auto fix jobs, Codebase changes entries, the p…<br>A banner strip in the console chrome.<br>Settings: tab activity.<br>2 console actions (MCP console_action, CLI axf console action): activity.check, activity.open.<br>11 API routes under /api/plugins/activity.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: axf.activity@1.<br>Banner items: activity, activity.lifecycle, activity.settings. | Gone from the console: a banner strip, a Settings tab, 2 actions (activity.check, activity.open), 11 API routes.<br>Loses a feature: Push banner (push-banner): axf.activity@1 (optional).<br>Its banner items disappear from the console chrome and from the phone. | Codebase changes banner (codebase-changes): axf.changes@1 (optional).<br>Systems check banner (systems-check): axf.github@1 (undeclared), axf.health@1 (undeclared).<br>AI assistant (ai-assistant): axf.live-sessions@1 (optional).<br>Notifications (notify-control): axf.notify@1 (undeclared). | Push banner (push-banner): axf.activity@1 (optional). |
| **agent-manager** ⚠ core | core | Create, edit, manage and orchestrate AI agents built from personas, lingo, skills and tools, each with its own persistent memory.<br>1 screen: agent-manager.<br>Settings: tab agent-manager.<br>2 console actions (MCP console_action, CLI axf console action): agent-manager.vinny, agent-manager.wizard.<br>50 API routes under /api/plugins/agent-manager.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 3 services other plugins can look up: axf.agents@1, axf.hub-runs@1, axf.vinny@1. | Gone from the console: 1 screen, a Settings tab, 2 actions (agent-manager.vinny, agent-manager.wizard), 50 API routes.<br>Stops working: Claude accounts (claude-accounts): axf.vinny@1 (required).<br>Loses a feature: Agent voice (agent-voice): axf.agents@1 (optional).<br>Loses a feature: AI assistant (ai-assistant): axf.agents@1 (optional).<br>Loses a feature: AI keys (ai-keys): axf.vinny@1 (optional).<br>Loses a feature: Badges (claude-badge): axf.vinny@1 (optional).<br>Loses a feature: Terminal (console-terminal): axf.hub-runs@1 (undeclared).<br>Loses a feature: Feature assistant (feature-assist): axf.agents@1 (optional).<br>Loses a feature: Molly guide (molly-guide): axf.agents@1 (undeclared), axf.vinny@1 (undeclared).<br>Loses a feature: Push banner (push-banner): axf.agents@1 (undeclared), axf.vinny@1 (undeclared).<br>Loses a feature: Reference links (ref-links): axf.agents@1 (optional).<br>Loses a feature: Systems check banner (systems-check): axf.agents@1 (optional), axf.vinny@1 (undeclared). | Container access (container-access): axf.containers@1 (optional).<br>AI assistant (ai-assistant): axf.llm@1 (optional).<br>Snapshot Manager (snapshot-manager): axf.snapshots@1 (optional).<br>Framework code: axf.assistant_host, axf.contracts. | Agent voice (agent-voice): axf.agents@1 (optional).<br>AI assistant (ai-assistant): axf.agents@1 (optional).<br>AI keys (ai-keys): axf.vinny@1 (optional).<br>Claude accounts (claude-accounts): axf.vinny@1 (required).<br>Badges (claude-badge): axf.vinny@1 (optional).<br>Terminal (console-terminal): axf.hub-runs@1 (undeclared).<br>Feature assistant (feature-assist): axf.agents@1 (optional).<br>Molly guide (molly-guide): axf.agents@1 (undeclared), axf.vinny@1 (undeclared).<br>Push banner (push-banner): axf.agents@1 (undeclared), axf.vinny@1 (undeclared).<br>Reference links (ref-links): axf.agents@1 (optional).<br>Systems check banner (systems-check): axf.agents@1 (optional), axf.vinny@1 (undeclared). |
| **agent-slots** | shared | A configurable cap on how many headless Claude sessions and builds run at once on the VPS (agent-slots@1, framework/cli/agent-slots.mjs).<br>Settings: tab agent-slots.<br>7 API routes under /api/plugins/agent-slots.<br>2 plugin commands callable from the CLI, MCP and voice: hard-limit, set-hard-limit.<br>Provides 1 service other plugins can look up: axf.agent-slots@1.<br>Fills slots: activity.summary, build.queue.top, builds.top, swarm.agent.status and 1 more. | Gone from the console: a Settings tab, 7 API routes, 2 commands (CLI, MCP, voice).<br>Loses a feature: Build orchestrator (build-orchestrator): axf.agent-slots@1 (optional).<br>Loses a feature: Claude sessions (claude-session): axf.agent-slots@1 (optional).<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Systems check banner (systems-check): axf.health@1 (optional). | Build orchestrator (build-orchestrator): axf.agent-slots@1 (optional).<br>Claude sessions (claude-session): axf.agent-slots@1 (optional). |
| **agent-swarm** | shared | Headless specialist agents for the Build orchestrator.<br>1 screen: agent-swarm.<br>Settings: tab agent-swarm.<br>2 console actions (MCP console_action, CLI axf console action): agent-swarm.open, agent-swarm.profile.<br>10 API routes under /api/plugins/agent-swarm.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 5 services other plugins can look up: agent-jobs@1, axf.crew@1, axf.swarm-roster@1, crew-sections@1, axf.crew-sections@1. | Gone from the console: 1 screen, a Settings tab, 2 actions (agent-swarm.open, agent-swarm.profile), 10 API routes.<br>Loses a feature: Claude sessions (claude-session): axf.crew@1 (optional).<br>Loses a feature: Crew (crew-live): axf.swarm-roster@1 (optional).<br>Loses a feature: Notifications (notify-control): axf.crew-sections@1 (undeclared).<br>Loses a feature: Systems check banner (systems-check): axf.crew-sections@1 (undeclared). | No other plugin: it stands alone. | Claude sessions (claude-session): axf.crew@1 (optional).<br>Crew (crew-live): axf.swarm-roster@1 (optional).<br>Notifications (notify-control): axf.crew-sections@1 (undeclared).<br>Systems check banner (systems-check): axf.crew-sections@1 (undeclared). |
| **agent-voice** | shared | Agents speak: a per-agent voice and narrator console (device voices on the phone or browser, cloud voices from OpenAI or ElevenLabs with keys kept on the server; speed, pitch, volume, presets, read modes, code / link / number / emoji rules, pauses, emphasis,…<br>1 screen: agent-voice.<br>Settings: tab agent-voice.<br>6 console actions (MCP console_action, CLI axf console action): agent-voice.configure, agent-voice.open, agent-voice.pause, agent-voice.resume, agent-voice.settings, agent-voice.stop.<br>13 API routes under /api/plugins/agent-voice.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 2 services other plugins can look up: axf.agent-voice@1, axf.speech@1.<br>Emits 4 events: axf:agent-voice.configure, axf:agent-voice.listen, axf:agent-voice.say, axf:assistant.focus.<br>Fills slots: assistant.head, assistant.mic, assistant.reply. | Gone from the console: 1 screen, a Settings tab, 6 actions (agent-voice.configure, agent-voice.open, agent-voice.pause and 3 more), 13 API routes.<br>Loses a feature: AI assistant (ai-assistant): event axf:assistant.focus.<br>Loses a feature: Demonstration Designer (demonstration-designer): axf.speech@1 (optional).<br>Loses a feature: Plan Studio (plan-studio): axf.agent-voice@1 (optional).<br>Goes unheard: Plan Studio (plan-studio): event axf:agent-voice.say. | Agent manager (agent-manager): axf.agents@1 (optional).<br>AI assistant (ai-assistant): action ai-assistant.open.<br>Plan Studio (plan-studio): event axf:agent-voice.say. | AI assistant (ai-assistant): event axf:assistant.focus.<br>Demonstration Designer (demonstration-designer): axf.speech@1 (optional).<br>Plan Studio (plan-studio): axf.agent-voice@1 (optional). |
| **ai-assistant** ⚠ core | core | The framework's assistant (assistant@1) in the Dev Console: every provider in the shared registry (Anthropic, Claude Code subscription, OpenAI, xAI Grok, Gemini, Mistral, Groq, DeepSeek, OpenRouter, Together, Fireworks, Perplexity, Cohere, Cerebras, Azure Ope…<br>1 screen: ai-assistant.<br>1 dialog: ai-assistant.chat.<br>Settings: tab ai-assistant.<br>2 console actions (MCP console_action, CLI axf console action): ai-assistant.open, ai.chat.start.<br>39 API routes under /api/plugins/ai-assistant.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 2 services other plugins can look up: axf.llm@1, axf.live-sessions@1.<br>Emits 2 events: axf:assistant.agent, axf:assistant.reply. | Gone from the console: 1 screen, 1 dialog, a Settings tab, 2 actions (ai-assistant.open, ai.chat.start), 39 API routes.<br>Stops working: Agent voice (agent-voice): action ai-assistant.open.<br>Loses a feature: Activity banner (activity): axf.live-sessions@1 (optional).<br>Loses a feature: Agent manager (agent-manager): axf.llm@1 (optional).<br>Loses a feature: Badges (claude-badge): axf.llm@1 (optional).<br>Loses a feature: Feature assistant (feature-assist): axf.llm@1 (optional).<br>Loses a feature: Maintenance (maintenance): axf.llm@1 (undeclared).<br>Loses a feature: Plan Studio (plan-studio): axf.llm@1 (optional).<br>Loses a feature: Systems check banner (systems-check): axf.llm@1 (optional).<br>Goes unheard: Agent voice (agent-voice): event axf:assistant.focus.<br>Named by the console shell or framework: apps/console-web/src/axf/core/assistant.ts. | Agent manager (agent-manager): axf.agents@1 (optional).<br>AI keys (ai-keys): axf.ai-keys@1 (undeclared).<br>Container access (container-access): axf.containers@1 (optional).<br>Plugin switches (plugin-switches): action plugin-switches.open.<br>Agent voice (agent-voice): event axf:assistant.focus.<br>Framework code: axf, axf.assistant_host, axf.contracts, axf.contracts.assistant. | Activity banner (activity): axf.live-sessions@1 (optional).<br>Agent manager (agent-manager): axf.llm@1 (optional).<br>Agent voice (agent-voice): action ai-assistant.open.<br>Badges (claude-badge): axf.llm@1 (optional).<br>Feature assistant (feature-assist): axf.llm@1 (optional).<br>Maintenance (maintenance): axf.llm@1 (undeclared).<br>Plan Studio (plan-studio): axf.llm@1 (optional).<br>Systems check banner (systems-check): axf.llm@1 (optional). |
| **ai-keys** | shared | A dialog that keeps several Anthropic keys (API keys in any Anthropic format, sk-ant-api03… or sk-ant-usr…, checked live, and Claude subscription tokens sk-ant-oat… from `claude setup-token`) and picks the active one of each kind for the AI assistant.<br>2 dialogs: ai-keys, ai-keys.accounts.<br>Settings: tab ai-keys.<br>2 console actions (MCP console_action, CLI axf console action): ai-keys.accounts, ai-keys.open.<br>11 API routes under /api/plugins/ai-keys.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: axf.ai-keys@1. | Gone from the console: 2 dialogs, a Settings tab, 2 actions (ai-keys.accounts, ai-keys.open), 11 API routes.<br>Loses a feature: AI assistant (ai-assistant): axf.ai-keys@1 (undeclared).<br>Loses a feature: Badges (claude-badge): axf.ai-keys@1 (optional).<br>Loses a feature: Systems check banner (systems-check): axf.ai-keys@1 (undeclared). | Claude accounts (claude-accounts): axf.claude-accounts@1 (optional).<br>Agent manager (agent-manager): axf.vinny@1 (optional).<br>Framework code: axf. | AI assistant (ai-assistant): axf.ai-keys@1 (undeclared).<br>Badges (claude-badge): axf.ai-keys@1 (optional).<br>Systems check banner (systems-check): axf.ai-keys@1 (undeclared). |
| **alerts-bell** | leaf | The developer alerts bell on the banner (it used to sit on the toolbar): a bell button that opens the Alerts view and, next to it, the number of unread alerts (hidden at zero, 99+ past 99).<br>Settings: tab alerts-bell.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: a Settings tab.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **amberx-listeners** | leaf | Every AmberX device's background listeners in the Dev Console (listener@1): the hands-free wake word, the command after it, the Speak button, Gizmo's talk mode, the recorder mic, the axHub watch, the veto alarm and the page's own listeners, with their live st…<br>1 screen: amberx-listeners.<br>Settings: tab amberx-listeners.<br>1 console action (MCP console_action, CLI axf console action): amberx-listeners.open.<br>6 API routes under /api/plugins/amberx-listeners.<br>6 plugin commands callable from the CLI, MCP and voice: devices, policies, registry, state, set-policy, restart. | Gone from the console: 1 screen, a Settings tab, 1 action (amberx-listeners.open), 6 API routes, 6 commands (CLI, MCP, voice).<br>No other plugin, banner or voice command depends on it.<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | No other plugin: it stands alone. | No other plugin uses it. |
| **approvals-banner** ⚠ core | leaf | The veto banner: a banner at the top of the app whenever axHub holds a call on its countdown (veto@1: it runs by itself after 90 s unless you stop it) or has one waiting for approval.<br>1 dialog: approvals.veto.<br>A banner strip in the console chrome.<br>Settings: tab approvals-banner.<br>6 console actions (MCP console_action, CLI axf console action): approvals.check, approvals.notice, approvals.open, approvals.review, approvals.veto, approvals.view.<br>2 API routes under /api/plugins/approvals-banner.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Banner items: approvals, approvals-banner.alarm. | Gone from the console: 1 dialog, a banner strip, a Settings tab, 6 actions (approvals.check, approvals.notice, approvals.open and 3 more), 2 API routes.<br>No other plugin, banner or voice command depends on it.<br>Its banner items disappear from the console chrome and from the phone. | Systems check banner (systems-check): axf.health@1 (undeclared). | No other plugin uses it. |
| **audio-extract** | leaf | Pulls the audio out of videos on the phone into audio files (screen recordings first): the original AAC copied out as .m4a with no re-encode, or WAV when picked.<br>1 screen: audio-extract.<br>Settings: tab audio-extract.<br>6 console actions (MCP console_action, CLI axf console action): audio-extract.latest, audio-extract.pause, audio-extract.pick, audio-extract.record, audio-extract.resume, audio-extract.stop.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Off by default. | Gone from the console: 1 screen, a Settings tab, 6 actions (audio-extract.latest, audio-extract.pause, audio-extract.pick and 3 more).<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **basic-filter** | leaf | A sort & filter dialog (search, rules on any column, match all / any, multi-level sort) you can attach to any dataset — every grid is one.<br>1 dialog: basic-filter.<br>Settings: tab basic-filter.<br>1 console action (MCP console_action, CLI axf console action): basic-filter.open.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Fills slots: plugin-switches.row. | Gone from the console: 1 dialog, a Settings tab, 1 action (basic-filter.open).<br>No other plugin, banner or voice command depends on it. | Plugin switches (plugin-switches): action plugin-switches.open. | No other plugin uses it. |
| **brand-library** | leaf | Browse the framework's brand library: 250 logos, 250 animated logos, 100 icon packs and 50 branding packages for AmberX and GizmoX, in tabs with search, brand and style filters and a virtualised grid.<br>1 screen: brand-library.<br>Settings: tab brand-library.<br>1 console action (MCP console_action, CLI axf console action): brand-library.open.<br>5 API routes under /api/plugins/brand-library.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 1 action (brand-library.open), 5 API routes.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **build-breaker** | leaf | Everything Brett ever asked for, in plain English (build-asks@1): one compact row per ask with its date and time, a status badge (built, in progress, pending, planned, held, removed, waiting for push / pull / deploy / approval), build time, cost and model.<br>1 screen: build-breaker.<br>Settings: tab build-breaker.<br>1 console action (MCP console_action, CLI axf console action): build-breaker.open.<br>1 API route under /api/plugins/build-breaker.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 1 action (build-breaker.open), 1 API route.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **build-manager** | unknown | No folder apps/console-web/plugins/build-manager at the time of the review: already removed, not analysed. | Nothing to analyse. | Nothing to analyse. | Nothing to analyse. |
| **build-orchestrator** ⚠ core | core | Breaks every build into small steps (30 min or less), each pinned to Fable or Opus, and runs the build pipeline (Brett, Nov 8 2026): every build gets an id and a Claude split (Fable only where needed) and sits in Pending; Brett moves it to the Queue; the disp…<br>1 screen: build-orchestrator.<br>Settings: tab build-orchestrator.<br>4 console actions (MCP console_action, CLI axf console action): build-orchestrator.focus, build-orchestrator.open, build-orchestrator.start, build-orchestrator.tab.<br>24 API routes under /api/plugins/build-orchestrator.<br>20 plugin commands callable from the CLI, MCP and voice: priority-list, priority-get, headless-runs, priority-set, origin, origin-set, origin-addendum, pipeline-status, pipeline-selfcheck, pipeline-tab and 10 more.<br>Provides 3 services other plugins can look up: orchestrator@1, axf.build-dispatch@1, console-focus@1. | Gone from the console: 1 screen, a Settings tab, 4 actions (build-orchestrator.focus, build-orchestrator.open, build-orchestrator.start and 1 more), 24 API routes, 20 commands (CLI, MCP, voice).<br>Stops working: Systems check banner (systems-check): action build-orchestrator.open.<br>Loses a feature: Console commands (console-commands): console-focus@1 (undeclared).<br>Loses a feature: Feature assistant (feature-assist): axf.build-dispatch@1 (undeclared).<br>Loses a feature: Push banner (push-banner): axf.build-dispatch@1 (undeclared).<br>Loses a feature: Systems check banner (systems-check): axf.build-dispatch@1 (undeclared).<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Agent cap (agent-slots): axf.agent-slots@1 (optional).<br>Systems check banner (systems-check): axf.health@1 (undeclared).<br>Push banner (push-banner): axf.merge-queue@1 (optional).<br>Plan Studio (plan-studio): plans@1 (optional).<br>UI Review (ui-review): ui-review@1 (optional). | Console commands (console-commands): console-focus@1 (undeclared).<br>Feature assistant (feature-assist): axf.build-dispatch@1 (undeclared).<br>Push banner (push-banner): axf.build-dispatch@1 (undeclared).<br>Systems check banner (systems-check): axf.build-dispatch@1 (undeclared), action build-orchestrator.open. |
| **build-profiles** | leaf | Pick and save the build profile the console works on.<br>1 dialog: build-profiles.<br>Settings: tab build-profiles.<br>1 console action (MCP console_action, CLI axf console action): build-profiles.open.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 dialog, a Settings tab, 1 action (build-profiles.open).<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **builds-page** | leaf | One Builds page over the one builds store (builds@1, owned by the Build orchestrator): every build of the active build profile, with switchable views.<br>1 screen: builds.<br>Settings: tab builds-page.<br>2 console actions (MCP console_action, CLI axf console action): builds.open, builds.view.<br>9 API routes under /api/plugins/builds-page.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 2 actions (builds.open, builds.view), 9 API routes.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **changes-grid** | leaf | One grid of every change (the Codebase changes log, read through axf.changes@1) and every feature (the plan).<br>1 screen: changes-grid.<br>Settings: tab changes-grid.<br>1 console action (MCP console_action, CLI axf console action): changes-grid.open.<br>2 API routes under /api/plugins/changes-grid.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 1 action (changes-grid.open), 2 API routes.<br>No other plugin, banner or voice command depends on it. | Codebase changes banner (codebase-changes): axf.changes@1 (optional). | No other plugin uses it. |
| **chat-viewer** | leaf | Every session we have, stored as transcripts (session@1) in one searchable store: claude.ai text and voice chats (from the data export Brett uploads, or the hub drop folder claude.ai sessions write to when he says "sync my chats"), Claude Code sessions (~/.cl…<br>1 screen: chat-viewer.<br>Settings: tab chat-viewer.<br>22 API routes under /api/plugins/chat-viewer.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 22 API routes.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **claude-accounts** | shared | Claude accounts on the VPS: lists the saved logins and API keys, switches the console's account, and routes headless jobs: every subscription login is a worker (the console's account takes jobs after them), 3 build and 5 wait per account, and API-key accounts…<br>1 screen: claude-accounts.<br>1 dialog: claude-accounts.switch.<br>Settings: tab claude-accounts, panel claude-accounts.routing.<br>3 console actions (MCP console_action, CLI axf console action): claude-accounts.open, claude-accounts.routing, claude-accounts.switch.<br>14 API routes under /api/plugins/claude-accounts.<br>14 plugin commands callable from the CLI, MCP and voice: list, who, use, role, signin, remove, save, routing, routing-test, routing-settings and 4 more.<br>Provides 1 service other plugins can look up: axf.claude-accounts@1. | Gone from the console: 1 screen, 1 dialog, a Settings tab, 3 actions (claude-accounts.open, claude-accounts.routing, claude-accounts.switch), 14 API routes, 14 commands (CLI, MCP, voice).<br>Loses a feature: AI keys (ai-keys): axf.claude-accounts@1 (optional).<br>Loses a feature: Badges (claude-badge): axf.claude-accounts@1 (optional).<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Terminal (console-terminal): axf.headless@1 (required), action terminal.claude.<br>Systems check banner (systems-check): axf.health@1 (undeclared).<br>Agent manager (agent-manager): axf.vinny@1 (required). | AI keys (ai-keys): axf.claude-accounts@1 (optional).<br>Badges (claude-badge): axf.claude-accounts@1 (optional). |
| **claude-badge** | leaf | Five banner badges in one plugin.<br>Settings: tab claude-badge.<br>5 API routes under /api/plugins/claude-badge.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Fills slots: app.frame.cover. | Gone from the console: a Settings tab, 5 API routes.<br>No other plugin, banner or voice command depends on it. | AI keys (ai-keys): axf.ai-keys@1 (optional).<br>Claude accounts (claude-accounts): axf.claude-accounts@1 (optional).<br>Terminal (console-terminal): axf.headless@1 (optional).<br>AI assistant (ai-assistant): axf.llm@1 (optional).<br>Agent manager (agent-manager): axf.vinny@1 (optional). | No other plugin uses it. |
| **claude-handoff** | leaf | Moves AmberX AXF to a new Claude account.<br>2 screens: claude-handoff, claude-handoff-preview.<br>A banner strip in the console chrome.<br>Settings: tab claude-handoff.<br>8 console actions (MCP console_action, CLI axf console action): claude-handoff.assemble, claude-handoff.files, claude-handoff.last, claude-handoff.look, claude-handoff.open, claude-handoff.preview, claude-handoff.publish, claude-handoff.session.<br>21 API routes under /api/plugins/claude-handoff.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Banner items: claude-handoff, claude-handoff.lifecycle, claude-handoff.prefs. | Gone from the console: 2 screens, a banner strip, a Settings tab, 8 actions (claude-handoff.assemble, claude-handoff.files, claude-handoff.last and 5 more), 21 API routes.<br>No other plugin, banner or voice command depends on it.<br>Its banner items disappear from the console chrome and from the phone. | No other plugin: it stands alone. | No other plugin uses it. |
| **claude-session** | leaf | Every Claude session (voice and chat Amber, Claude Code, headless builds) works as a crew agent Brett assigns (agent-pick@1).<br>1 dialog: claude.picker.<br>Settings: tab claude-session.<br>2 console actions (MCP console_action, CLI axf console action): claude.assign, claude.pick.<br>10 API routes under /api/plugins/claude-session.<br>3 plugin commands callable from the CLI, MCP and voice: agent, start, answer.<br>Fills slots: app.frame.cover, swarm.agent.actions. | Gone from the console: 1 dialog, a Settings tab, 2 actions (claude.assign, claude.pick), 10 API routes, 3 commands (CLI, MCP, voice).<br>No other plugin, banner or voice command depends on it.<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Agent cap (agent-slots): axf.agent-slots@1 (optional).<br>Claude (claude-settings): axf.claude-settings@1 (undeclared).<br>Agent swarm (agent-swarm): axf.crew@1 (optional). | No other plugin uses it. |
| **claude-settings** | shared | Claude settings (claude-settings@1): settings for Claude itself, kept on axHub (/projects/_shared/_data/claude/settings.json) so every Claude session (voice, chat, Claude Code, headless agents) reads the same values at its start and before acting (MCP claude_…<br>1 screen: claude-settings.<br>A banner strip in the console chrome.<br>Settings: tab claude-settings.<br>1 console action (MCP console_action, CLI axf console action): claude-settings.open.<br>4 API routes under /api/plugins/claude-settings.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: axf.claude-settings@1.<br>Banner items: claude-no-wait, claude-settings.lifecycle. | Gone from the console: 1 screen, a banner strip, a Settings tab, 1 action (claude-settings.open), 4 API routes.<br>Loses a feature: Claude sessions (claude-session): axf.claude-settings@1 (undeclared).<br>Loses a feature: Notifications (notify-control): axf.claude-settings@1 (optional).<br>Loses a feature: Audio Output Recorder (output-recorder): axf.claude-settings@1 (undeclared).<br>Loses a feature: UI Review (ui-review): axf.claude-settings@1 (undeclared).<br>Its banner items disappear from the console chrome and from the phone. | Token control (token-control): control@1 (required). | Claude sessions (claude-session): axf.claude-settings@1 (undeclared).<br>Notifications (notify-control): axf.claude-settings@1 (optional).<br>Audio Output Recorder (output-recorder): axf.claude-settings@1 (undeclared).<br>UI Review (ui-review): axf.claude-settings@1 (undeclared). |
| **codebase-changes** ⚠ core | core | Every time Claude is asked to build, edit, remove or fix something, an entry is opened (by a Claude Code hook) with what was asked, broken into steps that Claude fills in as it works, and the result when it's done (branch, commits, files, tests, links).<br>1 screen: codebase-changes.<br>A banner strip in the console chrome.<br>Settings: tab codebase-changes.<br>1 console action (MCP console_action, CLI axf console action): codebase-changes.open.<br>10 API routes under /api/plugins/codebase-changes.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: axf.changes@1.<br>Banner items: codebase-changes, codebase-changes.prefs. | Gone from the console: 1 screen, a banner strip, a Settings tab, 1 action (codebase-changes.open), 10 API routes.<br>Loses a feature: Activity banner (activity): axf.changes@1 (optional).<br>Loses a feature: Changes & features grid (changes-grid): axf.changes@1 (optional).<br>Loses a feature: Feature matrix (feature-matrix): axf.changes@1 (optional).<br>Loses a feature: Push banner (push-banner): axf.changes@1 (undeclared).<br>Loses a feature: Systems check banner (systems-check): axf.changes@1 (undeclared).<br>Its banner items disappear from the console chrome and from the phone. | No other plugin: it stands alone. | Activity banner (activity): axf.changes@1 (optional).<br>Changes & features grid (changes-grid): axf.changes@1 (optional).<br>Feature matrix (feature-matrix): axf.changes@1 (optional).<br>Push banner (push-banner): axf.changes@1 (undeclared).<br>Systems check banner (systems-check): axf.changes@1 (undeclared). |
| **console-commands** ⚠ core | core | Tell Amber (any Claude session) to load a screen and your open console goes there: open any screen, dialog or settings tab (sub-tabs too) by id, title or a few words, run any registered action, go back or home, and list what the console has.<br>Settings: tab console-commands.<br>21 API routes under /api/plugins/console-commands.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: console-commands@1. | Gone from the console: a Settings tab, 21 API routes.<br>Loses a feature: Follow Amber (follow-amber): console-commands@1 (optional).<br>Loses a feature: Plugin commands (plugin-commands): console-commands@1 (optional).<br>Loses a feature: Reference links (ref-links): console-commands@1 (optional).<br>Loses a feature: Token control (token-control): console-commands@1 (undeclared). | Build orchestrator (build-orchestrator): console-focus@1 (undeclared). | Follow Amber (follow-amber): console-commands@1 (optional).<br>Plugin commands (plugin-commands): console-commands@1 (optional).<br>Reference links (ref-links): console-commands@1 (optional).<br>Token control (token-control): console-commands@1 (undeclared). |
| **console-terminal** ⚠ core | core | Windows-style terminal: a Windows Terminal window with its own tab strip (rename, colour, drag to reorder, duplicate, move to a new window), a command toolbar and Windows keys.<br>2 dialogs: terminal.connect, terminal.connection.<br>Settings: tab terminal.<br>1 context-menu entry: *.<br>8 console actions (MCP console_action, CLI axf console action): terminal.attach, terminal.claude, terminal.jump, terminal.mirror, terminal.new, terminal.open, terminal.sessions, terminal.toolbar.<br>26 API routes under /api/plugins/console-terminal plus 2 websockets.<br>8 plugin commands callable from the CLI, MCP and voice: sessions-list, sessions-feed, sessions-note, sessions-stop, sessions-mirror, sessions-jump, new-session-get, new-session-set.<br>Provides 2 services other plugins can look up: axf.headless@1, axf.session-feed@1. | Gone from the console: 2 dialogs, a Settings tab, 1 context-menu entry, 8 actions (terminal.attach, terminal.claude, terminal.jump and 5 more), 26 API routes + 2 websockets, 8 commands (CLI, MCP, voice).<br>Stops working: Claude accounts (claude-accounts): axf.headless@1 (required), action terminal.claude.<br>Loses a feature: Badges (claude-badge): axf.headless@1 (optional).<br>Loses a feature: Crew (crew-live): axf.headless@1 (optional).<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Container access (container-access): axf.containers@1 (optional).<br>Systems check banner (systems-check): axf.health@1 (undeclared).<br>Agent manager (agent-manager): axf.hub-runs@1 (undeclared). | Claude accounts (claude-accounts): axf.headless@1 (required), action terminal.claude.<br>Badges (claude-badge): axf.headless@1 (optional).<br>Crew (crew-live): axf.headless@1 (optional). |
| **container-access** ⚠ core | core | The master switch for reaching other containers on the VPS.<br>Settings: tab container-access.<br>13 API routes under /api/plugins/container-access.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: axf.containers@1. | Gone from the console: a Settings tab, 13 API routes.<br>Stops working: Snapshot Manager (snapshot-manager): axf.containers@1 (required).<br>Loses a feature: Agent manager (agent-manager): axf.containers@1 (optional).<br>Loses a feature: AI assistant (ai-assistant): axf.containers@1 (optional).<br>Loses a feature: Terminal (console-terminal): axf.containers@1 (optional).<br>Loses a feature: Feature assistant (feature-assist): axf.containers@1 (optional).<br>Loses a feature: Systems check banner (systems-check): axf.containers@1 (undeclared). | Snapshot Manager (snapshot-manager): axf.snapshots@1 (optional). | Agent manager (agent-manager): axf.containers@1 (optional).<br>AI assistant (ai-assistant): axf.containers@1 (optional).<br>Terminal (console-terminal): axf.containers@1 (optional).<br>Feature assistant (feature-assist): axf.containers@1 (optional).<br>Snapshot Manager (snapshot-manager): axf.containers@1 (required).<br>Systems check banner (systems-check): axf.containers@1 (undeclared). |
| **context-menu-designer** | leaf | Design context menus: create, edit, name, rename and save them, and make 'chunks' (reusable pieces of a menu, saved from any menu with Save as chunk) that you insert into menus by name; chunks can hold items, separators and other chunks.<br>1 screen: context-menu-designer.<br>Settings: tab context-menu-designer.<br>3 console actions (MCP console_action, CLI axf console action): context-menu-designer.actions, context-menu-designer.filter, context-menu-designer.open.<br>3 API routes under /api/plugins/context-menu-designer.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 3 actions (context-menu-designer.actions, context-menu-designer.filter, context-menu-designer.open), 3 API routes.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **crew-live** | leaf | Every agent working right now, live: avatar, status (working / waiting on approval / stuck / idle), build and step in plain English, model, a timer since the job and the step started, live cost and tokens, files touched and the PR.<br>1 screen: crew.<br>Settings: tab crew-live.<br>1 context-menu entry: agent.<br>8 console actions (MCP console_action, CLI axf console action): crew.agent, crew.assign, crew.chat, crew.history, crew.open, crew.session, crew.stop, crew.terminal.<br>6 API routes under /api/plugins/crew-live.<br>5 plugin commands callable from the CLI, MCP and voice: agents, agent, files, diff, stop. | Gone from the console: 1 screen, a Settings tab, 1 context-menu entry, 8 actions (crew.agent, crew.assign, crew.chat and 5 more), 6 API routes, 5 commands (CLI, MCP, voice).<br>No other plugin, banner or voice command depends on it.<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Terminal (console-terminal): axf.headless@1 (optional).<br>Agent swarm (agent-swarm): axf.swarm-roster@1 (optional). | No other plugin uses it. |
| **demonstration-designer** | leaf | Pitch the product in three picks and one button.<br>1 screen: demonstration-designer.<br>Settings: tab demonstration-designer.<br>9 console actions (MCP console_action, CLI axf console action): pitch.export, pitch.generate, pitch.next, pitch.open, pitch.pause, pitch.play, pitch.prev, pitch.resume, pitch.stop.<br>19 API routes under /api/plugins/demonstration-designer.<br>19 plugin commands callable from the CLI, MCP and voice: registry, demos, demo, generate, save, delete, script, script-apply, chain, walkthrough and 9 more.<br>Provides 1 service other plugins can look up: demonstrations@1. | Gone from the console: 1 screen, a Settings tab, 9 actions (pitch.export, pitch.generate, pitch.next and 6 more), 19 API routes, 19 commands (CLI, MCP, voice).<br>No other plugin, banner or voice command depends on it.<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Agent voice (agent-voice): axf.speech@1 (optional). | No other plugin uses it. |
| **design-packs** | unknown | No folder apps/console-web/plugins/design-packs at the time of the review: already removed, not analysed. | Nothing to analyse. | Nothing to analyse. | Nothing to analyse. |
| **fable-rebuilds** | leaf | Every build parked for Fable in one place: what each replaces (the Opus plugin and its uninstall command), its branch, differences report, Android before/after screenshots and rebuild-log line, plus a ready-to-paste brief for the Fable session.<br>1 screen: fable-rebuilds.<br>1 dialog: fable-rebuilds.report.<br>Settings: tab fable-rebuilds.<br>3 console actions (MCP console_action, CLI axf console action): fable-rebuilds.open, fable-rebuilds.park-feature, fable-rebuilds.park-plugin.<br>3 API routes under /api/plugins/fable-rebuilds.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Emits 1 event: axf:pending-changed.<br>Fills slots: pending.item, plan.feature. | Gone from the console: 1 screen, 1 dialog, a Settings tab, 3 actions (fable-rebuilds.open, fable-rebuilds.park-feature, fable-rebuilds.park-plugin), 3 API routes.<br>Goes unheard: Feature assistant (feature-assist): event axf:plan-changed. | Feature assistant (feature-assist): event axf:plan-changed. | No other plugin uses it. |
| **feature-assist** | shared | Plain-English features for the Feature Planner: describe a feature in your own words, the AXF expert drafts proper plan entries (sub-features, dependencies, ports, model) and flags clashes; you edit and approve; they go to the plan and the pending list.<br>1 dialog: feature-assist.build.<br>Settings: tab feature-assist.<br>1 console action (MCP console_action, CLI axf console action): feature-assist.build.<br>7 API routes under /api/plugins/feature-assist.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Emits 1 event: axf:plan-changed.<br>Fills slots: plan.feature, plan.top. | Gone from the console: 1 dialog, a Settings tab, 1 action (feature-assist.build), 7 API routes.<br>Loses a feature: Fable rebuilds (fable-rebuilds): event axf:plan-changed. | Agent manager (agent-manager): axf.agents@1 (optional).<br>Build orchestrator (build-orchestrator): axf.build-dispatch@1 (undeclared).<br>Container access (container-access): axf.containers@1 (optional).<br>AI assistant (ai-assistant): axf.llm@1 (optional).<br>Snapshot Manager (snapshot-manager): axf.snapshots@1 (optional). | Fable rebuilds (fable-rebuilds): event axf:plan-changed. |
| **feature-matrix** | leaf | Every build gets a feature matrix (feature-matrix@1): grouped items, each with its minutes, model (Fable / Opus) and why; tick = keep, untick = skip; items can be added any time and are never deleted.<br>1 screen: feature-matrix.<br>Settings: tab feature-matrix.<br>1 console action (MCP console_action, CLI axf console action): feature-matrix.open.<br>6 API routes under /api/plugins/feature-matrix.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 1 action (feature-matrix.open), 6 API routes.<br>No other plugin, banner or voice command depends on it. | Codebase changes banner (codebase-changes): axf.changes@1 (optional). | No other plugin uses it. |
| **follow-amber** ⚠ core | core | One switch: Follow Amber.<br>1 dialog: follow-amber.approval.<br>Settings: tab follow-amber.<br>2 console actions (MCP console_action, CLI axf console action): follow-amber.approvals, follow-amber.toggle.<br>6 API routes under /api/plugins/follow-amber.<br>5 plugin commands callable from the CLI, MCP and voice: state, switch, show, approval, recent.<br>Provides 1 service other plugins can look up: follow-amber@1.<br>Fills slots: app.frame.cover. | Gone from the console: 1 dialog, a Settings tab, 2 actions (follow-amber.approvals, follow-amber.toggle), 6 API routes, 5 commands (CLI, MCP, voice).<br>Named by the console shell or framework: apps/console-web/server/mcp_server.py.<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Notifications (notify-control): axf.notify@1 (undeclared).<br>Console commands (console-commands): console-commands@1 (optional). | No other plugin uses it. |
| **github-app** | leaf | One-click GitHub App for the whole stack (github-app@1): Settings → Plugins → GitHub makes a private GitHub App on MossesX through GitHub's manifest flow (Create → Install on All repositories → Authorize as Brett).<br>Settings: tab github-app.<br>8 API routes under /api/plugins/github-app.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: axf.github-app@1. | Gone from the console: a Settings tab, 8 API routes.<br>No other plugin, banner or voice command depends on it. | Systems check banner (systems-check): axf.health@1 (optional). | No other plugin uses it. |
| **glossary-index** | leaf | An encyclopedia of AmberX AXF and the demonstrations written from it.<br>3 screens: glossary-index, demo-designer, book-builder.<br>2 dialogs: glossary-index.book-wizard, glossary-index.add-to-book.<br>Settings: tab glossary-index.<br>10 console actions (MCP console_action, CLI axf console action): book.add, book.new, book.open, demo.generate, demo.next, demo.play, demo.prev, demo.repeat, demo.replay, demo.stop.<br>20 API routes under /api/plugins/glossary-index.<br>19 plugin commands callable from the CLI, MCP and voice: stats, search, entry, changes, rebuild, demos, demo, demo-save, demo-delete, demo-generate and 9 more.<br>Provides 1 service other plugins can look up: glossary@1. | Gone from the console: 3 screens, 2 dialogs, a Settings tab, 10 actions (book.add, book.new, book.open and 7 more), 20 API routes, 19 commands (CLI, MCP, voice).<br>No other plugin, banner or voice command depends on it.<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | No other plugin: it stands alone. | No other plugin uses it. |
| **hub-sync** ⚠ core | leaf | Keeps the console's look, settings and (if picked) data on axHub, so every app and device matches: same colour theme, layout and settings on web, Android and everywhere else.<br>Settings: tab hubsync.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: a Settings tab.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **main-build-status** | leaf | A dot on the banner, next to the clock, with the last CI result of the main branch of MossesX/AmberX-AXF (workflow “Android framework + console”): green “main ✓ 2m ago”, red “main ✗”, accent while it runs, grey when unknown.<br>Settings: tab main-build-status.<br>3 console actions (MCP console_action, CLI axf console action): main-build-status.check, main-build-status.github, main-build-status.open.<br>3 API routes under /api/plugins/main-build-status.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: a Settings tab, 3 actions (main-build-status.check, main-build-status.github, main-build-status.open), 3 API routes.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **maintenance** | leaf | Server health and safe clean-up for the VPS (maintenance@1).<br>1 screen: maintenance.<br>Settings: tab maintenance.<br>1 console action (MCP console_action, CLI axf console action): maintenance.profiles.<br>15 API routes under /api/plugins/maintenance.<br>15 plugin commands callable from the CLI, MCP and voice: status, summary, snapshot, jobs, preview, run, runs, settings, set-settings, check and 5 more. | Gone from the console: 1 screen, a Settings tab, 1 action (maintenance.profiles), 15 API routes, 15 commands (CLI, MCP, voice).<br>No other plugin, banner or voice command depends on it.<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Systems check banner (systems-check): axf.health@1 (optional).<br>AI assistant (ai-assistant): axf.llm@1 (undeclared). | No other plugin uses it. |
| **mcp-client** | leaf | Connect the console to other MCP servers (Streamable HTTP) through the framework's MCP client library (ai.amberx.axf.mcp): browse their tools, resources and prompts, call tools, and keep a call log.<br>1 screen: mcp.<br>Settings: tab mcp.<br>8 API routes under /api/plugins/mcp-client.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 8 API routes.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **md-studio** | leaf | A Markdown browser and editor for every .md file Brett works with, on the dock engine.<br>1 screen: md-studio.<br>Settings: tab md-studio.<br>10 console actions (MCP console_action, CLI axf console action): md-studio.context, md-studio.edit, md-studio.notes, md-studio.open, md-studio.open-below, md-studio.open-right, md-studio.save, md-studio.show, md-studio.toggle-edit, md-studio.view.<br>8 API routes under /api/plugins/md-studio.<br>11 plugin commands callable from the CLI, MCP and voice: list-files, read-file, save-file, file-history, file-version, restore-version, context-chain, file-refs, open-file, edit-file and 1 more. | Gone from the console: 1 screen, a Settings tab, 10 actions (md-studio.context, md-studio.edit, md-studio.notes and 7 more), 8 API routes, 11 commands (CLI, MCP, voice).<br>No other plugin, banner or voice command depends on it.<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Notes (notes-browser): axf.notes@1 (optional). | No other plugin uses it. |
| **molly-guide** | leaf | Molly's narrated walkthroughs (walkthrough@1) in the console: ask her how to do something, or say it to AmberX, and a small floating window shows each step with Next and Previous while the console moves there, highlights it and reads the step out loud.<br>Settings: tab molly-guide.<br>4 console actions (MCP console_action, CLI axf console action): molly.ask, molly.next, molly.prev, molly.replay.<br>4 API routes under /api/plugins/molly-guide.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: a Settings tab, 4 actions (molly.ask, molly.next, molly.prev and 1 more), 4 API routes.<br>No other plugin, banner or voice command depends on it. | Agent manager (agent-manager): axf.agents@1 (undeclared), axf.vinny@1 (undeclared). | No other plugin uses it. |
| **notes-browser** | shared | Brett's saved notes in one place: handoffs, session logs, plans, install notes and saved commands, kept in the hub's shared Claude files (/projects/_shared/_claude/notes).<br>1 screen: notes.<br>Settings: tab notes-browser.<br>8 API routes under /api/plugins/notes-browser.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: axf.notes@1. | Gone from the console: 1 screen, a Settings tab, 8 API routes.<br>Loses a feature: MD Studio (md-studio): axf.notes@1 (optional). | No other plugin: it stands alone. | MD Studio (md-studio): axf.notes@1 (optional). |
| **notify-control** | shared | The one Notifications control panel: every notification the console, AmberX and axHub can send, in one registry that every sender checks.<br>1 screen: notify-control.<br>Settings: tab notify-control.<br>1 console action (MCP console_action, CLI axf console action): notify-control.open.<br>17 API routes under /api/plugins/notify-control.<br>17 plugin commands callable from the CLI, MCP and voice: state, types, check, recent, master, app, set, quiet, test, reset and 7 more.<br>Provides 1 service other plugins can look up: axf.notify@1. | Gone from the console: 1 screen, a Settings tab, 1 action (notify-control.open), 17 API routes, 17 commands (CLI, MCP, voice).<br>Loses a feature: Activity banner (activity): axf.notify@1 (undeclared).<br>Loses a feature: Follow Amber (follow-amber): axf.notify@1 (undeclared).<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Claude (claude-settings): axf.claude-settings@1 (optional).<br>Agent swarm (agent-swarm): axf.crew-sections@1 (undeclared).<br>Token control (token-control): control@1 (optional). | Activity banner (activity): axf.notify@1 (undeclared).<br>Follow Amber (follow-amber): axf.notify@1 (undeclared). |
| **output-recorder** | leaf | Records everything the phone plays while it is on (AudioPlaybackCapture; the mic only as an opt-in second track, Record my mic too, off by default), in timestamped 30-minute chunks sent to axHub; each chunk stays on the phone until axHub confirms it, queued a…<br>1 screen: output-recorder.<br>Settings: tab output-recorder.<br>3 console actions (MCP console_action, CLI axf console action): output-recorder.start, output-recorder.stop, output-recorder.toggle.<br>2 API routes under /api/plugins/output-recorder.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 3 actions (output-recorder.start, output-recorder.stop, output-recorder.toggle), 2 API routes.<br>No other plugin, banner or voice command depends on it. | Claude (claude-settings): axf.claude-settings@1 (undeclared).<br>Systems check banner (systems-check): axf.health@1 (undeclared). | No other plugin uses it. |
| **plan-studio** | shared | Every plan in one place (plan@1: JSON + a Markdown body).<br>1 screen: plan-studio.<br>Settings: tab plan-studio.<br>2 console actions (MCP console_action, CLI axf console action): plan-studio.capture, plan-studio.open.<br>5 API routes under /api/plugins/plan-studio.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: plans@1.<br>Emits 1 event: axf:agent-voice.say. | Gone from the console: 1 screen, a Settings tab, 2 actions (plan-studio.capture, plan-studio.open), 5 API routes.<br>Loses a feature: Agent voice (agent-voice): event axf:agent-voice.say.<br>Loses a feature: Build orchestrator (build-orchestrator): plans@1 (optional). | AI assistant (ai-assistant): axf.llm@1 (optional).<br>Agent voice (agent-voice): axf.agent-voice@1 (optional). | Agent voice (agent-voice): event axf:agent-voice.say.<br>Build orchestrator (build-orchestrator): plans@1 (optional). |
| **plugin-commands** ⚠ core | core | Every plugin, existing and new, exposes all of its commands and reads automatically, so Claude (through axHub), the REST API and the CLI can do anything a plugin can.<br>1 screen: plugin-commands.<br>Settings: tab plugin-commands.<br>1 console action (MCP console_action, CLI axf console action): plugin-commands.open.<br>7 API routes under /api/plugins/plugin-commands.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: plugin-commands@1. | Gone from the console: 1 screen, a Settings tab, 1 action (plugin-commands.open), 7 API routes.<br>Loses a feature: Token control (token-control): plugin-commands@1 (undeclared). | Console commands (console-commands): console-commands@1 (optional).<br>Token control (token-control): control@1 (optional). | Token control (token-control): plugin-commands@1 (undeclared). |
| **plugin-manager** ⚠ core | core | Every console plugin in one place: info, health, enable / disable, logs, settings, its UI, install & uninstall, and its dependencies in detail (what it needs, who provides it, who needs it, what clashes).<br>1 screen: plugin-manager.<br>1 dialog: plugin-manager.window.<br>Settings: tab plugin-manager.<br>1 context-menu entry: default/plugin-manager.<br>5 console actions (MCP console_action, CLI axf console action): plugin-manager.install, plugin-manager.layout, plugin-manager.open, plugin-manager.view, plugin-manager.window.<br>9 API routes under /api/plugins/plugin-manager.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Emits 1 event: axp-plugin-manager:select. | Gone from the console: 1 screen, 1 dialog, a Settings tab, 1 context-menu entry, 5 actions (plugin-manager.install, plugin-manager.layout, plugin-manager.open and 2 more), 9 API routes.<br>Named by the console shell or framework: apps/console-web/src/pluginLoader.tsx. | No other plugin: it stands alone. | No other plugin uses it. |
| **plugin-switches** ⚠ core | core | A pop-up dialog with a simple list of every plugin and a switch to turn each one on or off.<br>1 dialog: plugin-switches.<br>Settings: tab plugin-switches.<br>1 console action (MCP console_action, CLI axf console action): plugin-switches.open.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 dialog, a Settings tab, 1 action (plugin-switches.open).<br>Stops working: AI assistant (ai-assistant): action plugin-switches.open.<br>Stops working: Basic filter (basic-filter): action plugin-switches.open.<br>Cascade: agent-voice break next. | No other plugin: it stands alone. | AI assistant (ai-assistant): action plugin-switches.open.<br>Basic filter (basic-filter): action plugin-switches.open. |
| **plugin-update** | leaf | Every installed plugin with the model that built it, when it was built and its version, checked against the plugin catalog on axHub.<br>1 screen: plugin-update.<br>Settings: tab plugin-update.<br>1 console action (MCP console_action, CLI axf console action): plugin-update.open.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 1 action (plugin-update.open).<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **plugins-menu** | leaf | Right-click (or long-press) anywhere → Plugins: Install… (a plugin browser over every archive location: axHub, the permanent one, needs its credentials; folders, https servers and other consoles can be added with their credentials, kept on the console server…<br>2 dialogs: plugins-menu.settings, plugins-menu.install.<br>Settings: tab plugins-menu.<br>7 console actions (MCP console_action, CLI axf console action): plugins-menu.disable, plugins-menu.enable, plugins-menu.info, plugins-menu.install, plugins-menu.manage, plugins-menu.settings, plugins-menu.toggle.<br>9 API routes under /api/plugins/plugins-menu.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 2 dialogs, a Settings tab, 7 actions (plugins-menu.disable, plugins-menu.enable, plugins-menu.info and 4 more), 9 API routes.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **project-wizard** | leaf | Turns a GitHub repo, a VPS repo, a folder or a new AXF app into a Claude project: name and description, a home on GitHub, the VPS and/or a local git folder (existing or new), a validated project manifest and _claude/ files, and a Claude.ai project kit (instru…<br>1 screen: project-wizard.<br>Settings: tab project-wizard.<br>8 API routes under /api/plugins/project-wizard.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 8 API routes.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **push-banner** | shared | A banner listing every branch that isn't on main yet in AmberX-AXF and axHub (commits ahead/behind, age, last commit, its open PR and that PR's CI), with Open PR and Merge: every change reaches main only through its PR (one is opened for every branch), brough…<br>A banner strip in the console chrome.<br>Settings: tab push-banner.<br>2 console actions (MCP console_action, CLI axf console action): push-banner.check, push-banner.queue.<br>27 API routes under /api/plugins/push-banner.<br>10 plugin commands callable from the CLI, MCP and voice: land-list, land-blocked, land-now, land-hold, land-release, mergequeue-list, mergequeue-add, mergequeue-remove, mergequeue-move, mergequeue-settings.<br>Provides 1 service other plugins can look up: axf.merge-queue@1.<br>Banner items: push-banner, push-banner.prefs. | Gone from the console: a banner strip, a Settings tab, 2 actions (push-banner.check, push-banner.queue), 27 API routes, 10 commands (CLI, MCP, voice).<br>Loses a feature: Build orchestrator (build-orchestrator): axf.merge-queue@1 (optional).<br>Its banner items disappear from the console chrome and from the phone.<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Activity banner (activity): axf.activity@1 (optional).<br>Agent manager (agent-manager): axf.agents@1 (undeclared), axf.vinny@1 (undeclared).<br>Build orchestrator (build-orchestrator): axf.build-dispatch@1 (undeclared).<br>Codebase changes banner (codebase-changes): axf.changes@1 (undeclared).<br>Systems check banner (systems-check): axf.github@1 (undeclared), axf.health@1 (undeclared).<br>UI Review (ui-review): ui-review@1 (undeclared). | Build orchestrator (build-orchestrator): axf.merge-queue@1 (optional). |
| **ref-links** | leaf | Text in the banners (In progress, Ready to merge, Merged, Live, the build and status banners, Codebase changes) that mentions a real part of the app is a link: a screen, a settings tab, section or single setting, a plugin, dialog, toolbar, menu, component, bu…<br>Settings: tab ref-links.<br>4 API routes under /api/plugins/ref-links.<br>4 plugin commands callable from the CLI, MCP and voice: targets, find, resolve, open.<br>Provides 1 service other plugins can look up: ref-links@1. | Gone from the console: a Settings tab, 4 API routes, 4 commands (CLI, MCP, voice).<br>No other plugin, banner or voice command depends on it.<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Agent manager (agent-manager): axf.agents@1 (optional).<br>Console commands (console-commands): console-commands@1 (optional).<br>UI Review (ui-review): ui-review@1 (optional). | No other plugin uses it. |
| **session-checkin** | leaf | Every new Claude Code session opens with a short group of questions (location first, then repo, container, project, memory files read-only, model, effort with a fixed baseline cost) and is logged to a browsable session archive.<br>1 screen: sessions.<br>Settings: tab session-checkin.<br>9 API routes under /api/plugins/session-checkin.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 9 API routes.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **shipped-features** | leaf | Every individual feature of AmberX-AXF and axHub in one sortable list, from the moment a build plans it to when it went live: status (Planned, Queued, Building, In PR, Merged, Live, Cancelled, Removed), the builds, PRs and commits behind it, Brett's verbatim…<br>1 screen: shipped-features.<br>Settings: tab shipped-features.<br>3 console actions (MCP console_action, CLI axf console action): shipped-features.open, shipped-features.show, shipped-features.sync.<br>13 API routes under /api/plugins/shipped-features.<br>13 plugin commands callable from the CLI, MCP and voice: ledger, summary, feature, sync, import, export, search, manifests, manifest, manifest-put and 3 more. | Gone from the console: 1 screen, a Settings tab, 3 actions (shipped-features.open, shipped-features.show, shipped-features.sync), 13 API routes, 13 commands (CLI, MCP, voice).<br>No other plugin, banner or voice command depends on it.<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | No other plugin: it stands alone. | No other plugin uses it. |
| **snapshot-manager** | shared | Snapshots of container files, taken before every approved change and restorable in one step (restore snapshots the current state first, so an undo can be undone).<br>Settings: tab snapshots.<br>1 console action (MCP console_action, CLI axf console action): snapshots.show.<br>12 API routes under /api/plugins/snapshot-manager.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: axf.snapshots@1. | Gone from the console: a Settings tab, 1 action (snapshots.show), 12 API routes.<br>Loses a feature: Agent manager (agent-manager): axf.snapshots@1 (optional).<br>Loses a feature: Container access (container-access): axf.snapshots@1 (optional).<br>Loses a feature: Feature assistant (feature-assist): axf.snapshots@1 (optional). | Container access (container-access): axf.containers@1 (required). | Agent manager (agent-manager): axf.snapshots@1 (optional).<br>Container access (container-access): axf.snapshots@1 (optional).<br>Feature assistant (feature-assist): axf.snapshots@1 (optional). |
| **systems-check** ⚠ core | core | The systems check, Keys and What's new banners at the top of every view.<br>1 dialog: system-check.<br>A banner strip in the console chrome.<br>Settings: tab systems-check.<br>2 console actions (MCP console_action, CLI axf console action): keys-needed.open, system-check.open.<br>31 API routes under /api/plugins/systems-check.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 3 services other plugins can look up: axf.syscheck@1, axf.health@1, axf.github@1.<br>Banner items: keys-needed, systems-check, whats-new. | Gone from the console: 1 dialog, a banner strip, a Settings tab, 2 actions (keys-needed.open, system-check.open), 31 API routes.<br>Loses a feature: Activity banner (activity): axf.github@1 (undeclared), axf.health@1 (undeclared).<br>Loses a feature: Agent cap (agent-slots): axf.health@1 (optional).<br>Loses a feature: Approvals banner (approvals-banner): axf.health@1 (undeclared).<br>Loses a feature: Build orchestrator (build-orchestrator): axf.health@1 (undeclared).<br>Loses a feature: Claude accounts (claude-accounts): axf.health@1 (undeclared).<br>Loses a feature: Terminal (console-terminal): axf.health@1 (undeclared).<br>Loses a feature: GitHub (github-app): axf.health@1 (optional).<br>Loses a feature: Maintenance (maintenance): axf.health@1 (optional).<br>Loses a feature: Audio Output Recorder (output-recorder): axf.health@1 (undeclared).<br>Loses a feature: Push banner (push-banner): axf.github@1 (undeclared), axf.health@1 (undeclared).<br>Loses a feature: UI Review (ui-review): axf.health@1 (undeclared).<br>Its banner items disappear from the console chrome and from the phone. | Agent manager (agent-manager): axf.agents@1 (optional), axf.vinny@1 (undeclared).<br>AI keys (ai-keys): axf.ai-keys@1 (undeclared).<br>Build orchestrator (build-orchestrator): axf.build-dispatch@1 (undeclared), action build-orchestrator.open.<br>Codebase changes banner (codebase-changes): axf.changes@1 (undeclared).<br>Container access (container-access): axf.containers@1 (undeclared).<br>Agent swarm (agent-swarm): axf.crew-sections@1 (undeclared).<br>AI assistant (ai-assistant): axf.llm@1 (optional). | Activity banner (activity): axf.github@1 (undeclared), axf.health@1 (undeclared).<br>Agent cap (agent-slots): axf.health@1 (optional).<br>Approvals banner (approvals-banner): axf.health@1 (undeclared).<br>Build orchestrator (build-orchestrator): axf.health@1 (undeclared).<br>Claude accounts (claude-accounts): axf.health@1 (undeclared).<br>Terminal (console-terminal): axf.health@1 (undeclared).<br>GitHub (github-app): axf.health@1 (optional).<br>Maintenance (maintenance): axf.health@1 (optional).<br>Audio Output Recorder (output-recorder): axf.health@1 (undeclared).<br>Push banner (push-banner): axf.github@1 (undeclared), axf.health@1 (undeclared).<br>UI Review (ui-review): axf.health@1 (undeclared). |
| **theme-editor** | leaf | Edit colour and style themes token by token.<br>1 screen: theme-editor.<br>Settings: tab theme-editor.<br>1 console action (MCP console_action, CLI axf console action): theme-editor.open.<br>3 API routes under /api/plugins/theme-editor.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab, 1 action (theme-editor.open), 3 API routes.<br>No other plugin, banner or voice command depends on it. | Theme manager (theme-manager): axf.token-tree@1 (required). | No other plugin uses it. |
| **theme-manager** ⚠ core | core | Roll colour, style and layout themes, or every themeable part at once.<br>1 screen: theme-manager.<br>Settings: tab theme-manager.<br>1 console action (MCP console_action, CLI axf console action): theme-manager.open.<br>22 API routes under /api/plugins/theme-manager.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: axf.token-tree@1.<br>Emits 1 event: axf:tm-saved. | Gone from the console: 1 screen, a Settings tab, 1 action (theme-manager.open), 22 API routes.<br>Stops working: Theme editor (theme-editor): axf.token-tree@1 (required). | No other plugin: it stands alone. | Theme editor (theme-editor): axf.token-tree@1 (required). |
| **todo-manager** | leaf | Lists with nested groups holding notes, to-dos and tasks (subtasks, checklists, tags, due dates, custom fields per kind), shown as a tree (by lists, kind, status, priority, tag or due date) or a grid, with group actions and Markdown export.<br>1 screen: todo-manager.<br>1 dialog: todo-manager.entry.<br>Settings: tab todo-manager.<br>7 console actions (MCP console_action, CLI axf console action): todo-manager.delete, todo-manager.done, todo-manager.edit, todo-manager.new, todo-manager.open, todo-manager.reload, todo-manager.subtask.<br>15 API routes under /api/plugins/todo-manager.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, 1 dialog, a Settings tab, 7 actions (todo-manager.delete, todo-manager.done, todo-manager.edit and 4 more), 15 API routes.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **token-control** ⚠ core | core | One API, MCP server and CLI for everything control@1 covers: every theme, style, layout, typography, density and sizing token (a set is an override that rides the axHub look, so every app follows), the active asset per slot, every AmberX note, to-do, task and…<br>1 screen: token-control.<br>A banner strip in the console chrome.<br>Settings: tab token-control.<br>21 API routes under /api/plugins/token-control.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice).<br>Provides 1 service other plugins can look up: control@1. | Gone from the console: 1 screen, a banner strip, a Settings tab, 21 API routes.<br>Stops working: Claude (claude-settings): control@1 (required).<br>Loses a feature: Notifications (notify-control): control@1 (optional).<br>Loses a feature: Plugin commands (plugin-commands): control@1 (optional).<br>Its banner items disappear from the console chrome and from the phone. | Console commands (console-commands): console-commands@1 (undeclared).<br>Plugin commands (plugin-commands): plugin-commands@1 (undeclared). | Claude (claude-settings): control@1 (required).<br>Notifications (notify-control): control@1 (optional).<br>Plugin commands (plugin-commands): control@1 (optional). |
| **ui-review** | shared | Every UI a build makes comes here for Brett's approval, one section per kind (open registry: Design packs, Whole apps / programs, Screens & pages, Settings interfaces, Dialogs & popups, Menus & toolbars, Banners & cards, Other).<br>2 screens: ui-review, design-packs.<br>Settings: tab ui-review.<br>3 console actions (MCP console_action, CLI axf console action): ui-review.design-packs, ui-review.open, ui-review.screenshots.<br>15 API routes under /api/plugins/ui-review.<br>15 plugin commands callable from the CLI, MCP and voice: choices-settings, choices-settings-set, choices-choose, choices-decision, choices-assets, choices-ask, choices-asks, choices-ask-read, choices-answer, predicted and 5 more.<br>Provides 2 services other plugins can look up: ui-review@1, ui-screenshots@1. | Gone from the console: 2 screens, a Settings tab, 3 actions (ui-review.design-packs, ui-review.open, ui-review.screenshots), 15 API routes, 15 commands (CLI, MCP, voice).<br>Loses a feature: Build orchestrator (build-orchestrator): ui-review@1 (optional).<br>Loses a feature: Push banner (push-banner): ui-review@1 (undeclared).<br>Loses a feature: Reference links (ref-links): ui-review@1 (optional).<br>Its voice and CLI commands stop answering (AmberX, MCP, axf). | Claude (claude-settings): axf.claude-settings@1 (undeclared).<br>Systems check banner (systems-check): axf.health@1 (undeclared). | Build orchestrator (build-orchestrator): ui-review@1 (optional).<br>Push banner (push-banner): ui-review@1 (undeclared).<br>Reference links (ref-links): ui-review@1 (optional). |
| **voice-notes** | leaf | Sets up a voice-activated notes pusher and shows the notes it saved.<br>1 screen: voice-notes.<br>Settings: tab voice-notes.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 screen, a Settings tab.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |
| **whats-shipped** | leaf | A What's new widget on the banner: a ticker of the newest features merged to main (and deployed), with an unread count.<br>1 dialog: whats-shipped.panel.<br>Settings: tab whats-shipped.<br>4 console actions (MCP console_action, CLI axf console action): whats-new.open, whats-shipped.check, whats-shipped.open, whats-shipped.read-all.<br>3 API routes under /api/plugins/whats-shipped.<br>Plugin commands are generated from its actions and settings (CLI, MCP, voice). | Gone from the console: 1 dialog, a Settings tab, 4 actions (whats-new.open, whats-shipped.check, whats-shipped.open and 1 more), 3 API routes.<br>No other plugin, banner or voice command depends on it. | No other plugin: it stands alone. | No other plugin uses it. |

## Per plugin

### activity

**What it does**
- A banner at the top of the console whenever anything is built, edited, deleted, pushed, pulled, merged or thought about, queued or running: GitHub Actions runs, the console's own update, AI assistant replies, VPS Auto fix jobs, Codebase changes entries, the p…
- A banner strip in the console chrome.
- Settings: tab activity.
- 2 console actions (MCP console_action, CLI axf console action): activity.check, activity.open.
- 11 API routes under /api/plugins/activity.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: axf.activity@1.
- Banner items: activity, activity.lifecycle, activity.settings.

**What breaks if disabled**
- Gone from the console: a banner strip, a Settings tab, 2 actions (activity.check, activity.open), 11 API routes.
- Loses a feature: Push banner (push-banner): axf.activity@1 (optional).
- Its banner items disappear from the console chrome and from the phone.

**Depends on**
- Codebase changes banner (codebase-changes): axf.changes@1 (optional).
- Systems check banner (systems-check): axf.github@1 (undeclared), axf.health@1 (undeclared).
- AI assistant (ai-assistant): axf.live-sessions@1 (optional).
- Notifications (notify-control): axf.notify@1 (undeclared).

**Used by**
- Push banner (push-banner): axf.activity@1 (optional).

### agent-manager ⚠ core: never disable
> Core because: hard dependents: claude-accounts; used by 11 plugins.

**What it does**
- Create, edit, manage and orchestrate AI agents built from personas, lingo, skills and tools, each with its own persistent memory.
- 1 screen: agent-manager.
- Settings: tab agent-manager.
- 2 console actions (MCP console_action, CLI axf console action): agent-manager.vinny, agent-manager.wizard.
- 50 API routes under /api/plugins/agent-manager.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 3 services other plugins can look up: axf.agents@1, axf.hub-runs@1, axf.vinny@1.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 2 actions (agent-manager.vinny, agent-manager.wizard), 50 API routes.
- Stops working: Claude accounts (claude-accounts): axf.vinny@1 (required).
- Loses a feature: Agent voice (agent-voice): axf.agents@1 (optional).
- Loses a feature: AI assistant (ai-assistant): axf.agents@1 (optional).
- Loses a feature: AI keys (ai-keys): axf.vinny@1 (optional).
- Loses a feature: Badges (claude-badge): axf.vinny@1 (optional).
- Loses a feature: Terminal (console-terminal): axf.hub-runs@1 (undeclared).
- Loses a feature: Feature assistant (feature-assist): axf.agents@1 (optional).
- Loses a feature: Molly guide (molly-guide): axf.agents@1 (undeclared), axf.vinny@1 (undeclared).
- Loses a feature: Push banner (push-banner): axf.agents@1 (undeclared), axf.vinny@1 (undeclared).
- Loses a feature: Reference links (ref-links): axf.agents@1 (optional).
- Loses a feature: Systems check banner (systems-check): axf.agents@1 (optional), axf.vinny@1 (undeclared).

**Depends on**
- Container access (container-access): axf.containers@1 (optional).
- AI assistant (ai-assistant): axf.llm@1 (optional).
- Snapshot Manager (snapshot-manager): axf.snapshots@1 (optional).
- Framework code: axf.assistant_host, axf.contracts.

**Used by**
- Agent voice (agent-voice): axf.agents@1 (optional).
- AI assistant (ai-assistant): axf.agents@1 (optional).
- AI keys (ai-keys): axf.vinny@1 (optional).
- Claude accounts (claude-accounts): axf.vinny@1 (required).
- Badges (claude-badge): axf.vinny@1 (optional).
- Terminal (console-terminal): axf.hub-runs@1 (undeclared).
- Feature assistant (feature-assist): axf.agents@1 (optional).
- Molly guide (molly-guide): axf.agents@1 (undeclared), axf.vinny@1 (undeclared).
- Push banner (push-banner): axf.agents@1 (undeclared), axf.vinny@1 (undeclared).
- Reference links (ref-links): axf.agents@1 (optional).
- Systems check banner (systems-check): axf.agents@1 (optional), axf.vinny@1 (undeclared).

### agent-slots

**What it does**
- A configurable cap on how many headless Claude sessions and builds run at once on the VPS (agent-slots@1, framework/cli/agent-slots.mjs).
- Settings: tab agent-slots.
- 7 API routes under /api/plugins/agent-slots.
- 2 plugin commands callable from the CLI, MCP and voice: hard-limit, set-hard-limit.
- Provides 1 service other plugins can look up: axf.agent-slots@1.
- Fills slots: activity.summary, build.queue.top, builds.top, swarm.agent.status and 1 more.

**What breaks if disabled**
- Gone from the console: a Settings tab, 7 API routes, 2 commands (CLI, MCP, voice).
- Loses a feature: Build orchestrator (build-orchestrator): axf.agent-slots@1 (optional).
- Loses a feature: Claude sessions (claude-session): axf.agent-slots@1 (optional).
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Systems check banner (systems-check): axf.health@1 (optional).

**Used by**
- Build orchestrator (build-orchestrator): axf.agent-slots@1 (optional).
- Claude sessions (claude-session): axf.agent-slots@1 (optional).

### agent-swarm

**What it does**
- Headless specialist agents for the Build orchestrator.
- 1 screen: agent-swarm.
- Settings: tab agent-swarm.
- 2 console actions (MCP console_action, CLI axf console action): agent-swarm.open, agent-swarm.profile.
- 10 API routes under /api/plugins/agent-swarm.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 5 services other plugins can look up: agent-jobs@1, axf.crew@1, axf.swarm-roster@1, crew-sections@1, axf.crew-sections@1.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 2 actions (agent-swarm.open, agent-swarm.profile), 10 API routes.
- Loses a feature: Claude sessions (claude-session): axf.crew@1 (optional).
- Loses a feature: Crew (crew-live): axf.swarm-roster@1 (optional).
- Loses a feature: Notifications (notify-control): axf.crew-sections@1 (undeclared).
- Loses a feature: Systems check banner (systems-check): axf.crew-sections@1 (undeclared).

**Depends on**
- No other plugin: it stands alone.

**Used by**
- Claude sessions (claude-session): axf.crew@1 (optional).
- Crew (crew-live): axf.swarm-roster@1 (optional).
- Notifications (notify-control): axf.crew-sections@1 (undeclared).
- Systems check banner (systems-check): axf.crew-sections@1 (undeclared).

### agent-voice

**What it does**
- Agents speak: a per-agent voice and narrator console (device voices on the phone or browser, cloud voices from OpenAI or ElevenLabs with keys kept on the server; speed, pitch, volume, presets, read modes, code / link / number / emoji rules, pauses, emphasis,…
- 1 screen: agent-voice.
- Settings: tab agent-voice.
- 6 console actions (MCP console_action, CLI axf console action): agent-voice.configure, agent-voice.open, agent-voice.pause, agent-voice.resume, agent-voice.settings, agent-voice.stop.
- 13 API routes under /api/plugins/agent-voice.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 2 services other plugins can look up: axf.agent-voice@1, axf.speech@1.
- Emits 4 events: axf:agent-voice.configure, axf:agent-voice.listen, axf:agent-voice.say, axf:assistant.focus.
- Fills slots: assistant.head, assistant.mic, assistant.reply.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 6 actions (agent-voice.configure, agent-voice.open, agent-voice.pause and 3 more), 13 API routes.
- Loses a feature: AI assistant (ai-assistant): event axf:assistant.focus.
- Loses a feature: Demonstration Designer (demonstration-designer): axf.speech@1 (optional).
- Loses a feature: Plan Studio (plan-studio): axf.agent-voice@1 (optional).
- Goes unheard: Plan Studio (plan-studio): event axf:agent-voice.say.

**Depends on**
- Agent manager (agent-manager): axf.agents@1 (optional).
- AI assistant (ai-assistant): action ai-assistant.open.
- Plan Studio (plan-studio): event axf:agent-voice.say.

**Used by**
- AI assistant (ai-assistant): event axf:assistant.focus.
- Demonstration Designer (demonstration-designer): axf.speech@1 (optional).
- Plan Studio (plan-studio): axf.agent-voice@1 (optional).

### ai-assistant ⚠ core: never disable
> Core because: named by the console shell / framework: apps/console-web/src/axf/core/assistant.ts; hard dependents: agent-voice; used by 8 plugins.

**What it does**
- The framework's assistant (assistant@1) in the Dev Console: every provider in the shared registry (Anthropic, Claude Code subscription, OpenAI, xAI Grok, Gemini, Mistral, Groq, DeepSeek, OpenRouter, Together, Fireworks, Perplexity, Cohere, Cerebras, Azure Ope…
- 1 screen: ai-assistant.
- 1 dialog: ai-assistant.chat.
- Settings: tab ai-assistant.
- 2 console actions (MCP console_action, CLI axf console action): ai-assistant.open, ai.chat.start.
- 39 API routes under /api/plugins/ai-assistant.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 2 services other plugins can look up: axf.llm@1, axf.live-sessions@1.
- Emits 2 events: axf:assistant.agent, axf:assistant.reply.

**What breaks if disabled**
- Gone from the console: 1 screen, 1 dialog, a Settings tab, 2 actions (ai-assistant.open, ai.chat.start), 39 API routes.
- Stops working: Agent voice (agent-voice): action ai-assistant.open.
- Loses a feature: Activity banner (activity): axf.live-sessions@1 (optional).
- Loses a feature: Agent manager (agent-manager): axf.llm@1 (optional).
- Loses a feature: Badges (claude-badge): axf.llm@1 (optional).
- Loses a feature: Feature assistant (feature-assist): axf.llm@1 (optional).
- Loses a feature: Maintenance (maintenance): axf.llm@1 (undeclared).
- Loses a feature: Plan Studio (plan-studio): axf.llm@1 (optional).
- Loses a feature: Systems check banner (systems-check): axf.llm@1 (optional).
- Goes unheard: Agent voice (agent-voice): event axf:assistant.focus.
- Named by the console shell or framework: apps/console-web/src/axf/core/assistant.ts.

**Depends on**
- Agent manager (agent-manager): axf.agents@1 (optional).
- AI keys (ai-keys): axf.ai-keys@1 (undeclared).
- Container access (container-access): axf.containers@1 (optional).
- Plugin switches (plugin-switches): action plugin-switches.open.
- Agent voice (agent-voice): event axf:assistant.focus.
- Framework code: axf, axf.assistant_host, axf.contracts, axf.contracts.assistant.

**Used by**
- Activity banner (activity): axf.live-sessions@1 (optional).
- Agent manager (agent-manager): axf.llm@1 (optional).
- Agent voice (agent-voice): action ai-assistant.open.
- Badges (claude-badge): axf.llm@1 (optional).
- Feature assistant (feature-assist): axf.llm@1 (optional).
- Maintenance (maintenance): axf.llm@1 (undeclared).
- Plan Studio (plan-studio): axf.llm@1 (optional).
- Systems check banner (systems-check): axf.llm@1 (optional).

### ai-keys

**What it does**
- A dialog that keeps several Anthropic keys (API keys in any Anthropic format, sk-ant-api03… or sk-ant-usr…, checked live, and Claude subscription tokens sk-ant-oat… from `claude setup-token`) and picks the active one of each kind for the AI assistant.
- 2 dialogs: ai-keys, ai-keys.accounts.
- Settings: tab ai-keys.
- 2 console actions (MCP console_action, CLI axf console action): ai-keys.accounts, ai-keys.open.
- 11 API routes under /api/plugins/ai-keys.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: axf.ai-keys@1.

**What breaks if disabled**
- Gone from the console: 2 dialogs, a Settings tab, 2 actions (ai-keys.accounts, ai-keys.open), 11 API routes.
- Loses a feature: AI assistant (ai-assistant): axf.ai-keys@1 (undeclared).
- Loses a feature: Badges (claude-badge): axf.ai-keys@1 (optional).
- Loses a feature: Systems check banner (systems-check): axf.ai-keys@1 (undeclared).

**Depends on**
- Claude accounts (claude-accounts): axf.claude-accounts@1 (optional).
- Agent manager (agent-manager): axf.vinny@1 (optional).
- Framework code: axf.

**Used by**
- AI assistant (ai-assistant): axf.ai-keys@1 (undeclared).
- Badges (claude-badge): axf.ai-keys@1 (optional).
- Systems check banner (systems-check): axf.ai-keys@1 (undeclared).

### alerts-bell

**What it does**
- The developer alerts bell on the banner (it used to sit on the toolbar): a bell button that opens the Alerts view and, next to it, the number of unread alerts (hidden at zero, 99+ past 99).
- Settings: tab alerts-bell.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: a Settings tab.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### amberx-listeners

**What it does**
- Every AmberX device's background listeners in the Dev Console (listener@1): the hands-free wake word, the command after it, the Speak button, Gizmo's talk mode, the recorder mic, the axHub watch, the veto alarm and the page's own listeners, with their live st…
- 1 screen: amberx-listeners.
- Settings: tab amberx-listeners.
- 1 console action (MCP console_action, CLI axf console action): amberx-listeners.open.
- 6 API routes under /api/plugins/amberx-listeners.
- 6 plugin commands callable from the CLI, MCP and voice: devices, policies, registry, state, set-policy, restart.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 action (amberx-listeners.open), 6 API routes, 6 commands (CLI, MCP, voice).
- No other plugin, banner or voice command depends on it.
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### approvals-banner ⚠ core: never disable
> Core because: named core by Brett in the build brief.

**What it does**
- The veto banner: a banner at the top of the app whenever axHub holds a call on its countdown (veto@1: it runs by itself after 90 s unless you stop it) or has one waiting for approval.
- 1 dialog: approvals.veto.
- A banner strip in the console chrome.
- Settings: tab approvals-banner.
- 6 console actions (MCP console_action, CLI axf console action): approvals.check, approvals.notice, approvals.open, approvals.review, approvals.veto, approvals.view.
- 2 API routes under /api/plugins/approvals-banner.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Banner items: approvals, approvals-banner.alarm.

**What breaks if disabled**
- Gone from the console: 1 dialog, a banner strip, a Settings tab, 6 actions (approvals.check, approvals.notice, approvals.open and 3 more), 2 API routes.
- No other plugin, banner or voice command depends on it.
- Its banner items disappear from the console chrome and from the phone.

**Depends on**
- Systems check banner (systems-check): axf.health@1 (undeclared).

**Used by**
- No other plugin uses it.

### audio-extract

**What it does**
- Pulls the audio out of videos on the phone into audio files (screen recordings first): the original AAC copied out as .m4a with no re-encode, or WAV when picked.
- 1 screen: audio-extract.
- Settings: tab audio-extract.
- 6 console actions (MCP console_action, CLI axf console action): audio-extract.latest, audio-extract.pause, audio-extract.pick, audio-extract.record, audio-extract.resume, audio-extract.stop.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Off by default.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 6 actions (audio-extract.latest, audio-extract.pause, audio-extract.pick and 3 more).
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### basic-filter

**What it does**
- A sort & filter dialog (search, rules on any column, match all / any, multi-level sort) you can attach to any dataset — every grid is one.
- 1 dialog: basic-filter.
- Settings: tab basic-filter.
- 1 console action (MCP console_action, CLI axf console action): basic-filter.open.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Fills slots: plugin-switches.row.

**What breaks if disabled**
- Gone from the console: 1 dialog, a Settings tab, 1 action (basic-filter.open).
- No other plugin, banner or voice command depends on it.

**Depends on**
- Plugin switches (plugin-switches): action plugin-switches.open.

**Used by**
- No other plugin uses it.

### brand-library

**What it does**
- Browse the framework's brand library: 250 logos, 250 animated logos, 100 icon packs and 50 branding packages for AmberX and GizmoX, in tabs with search, brand and style filters and a virtualised grid.
- 1 screen: brand-library.
- Settings: tab brand-library.
- 1 console action (MCP console_action, CLI axf console action): brand-library.open.
- 5 API routes under /api/plugins/brand-library.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 action (brand-library.open), 5 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### build-breaker

**What it does**
- Everything Brett ever asked for, in plain English (build-asks@1): one compact row per ask with its date and time, a status badge (built, in progress, pending, planned, held, removed, waiting for push / pull / deploy / approval), build time, cost and model.
- 1 screen: build-breaker.
- Settings: tab build-breaker.
- 1 console action (MCP console_action, CLI axf console action): build-breaker.open.
- 1 API route under /api/plugins/build-breaker.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 action (build-breaker.open), 1 API route.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### build-manager

**What it does**
- No folder apps/console-web/plugins/build-manager at the time of the review: already removed, not analysed.

**What breaks if disabled**
- Nothing to analyse.

**Depends on**
- Nothing to analyse.

**Used by**
- Nothing to analyse.

### build-orchestrator ⚠ core: never disable
> Core because: hard dependents: systems-check; named core by Brett in the build brief.

**What it does**
- Breaks every build into small steps (30 min or less), each pinned to Fable or Opus, and runs the build pipeline (Brett, Nov 8 2026): every build gets an id and a Claude split (Fable only where needed) and sits in Pending; Brett moves it to the Queue; the disp…
- 1 screen: build-orchestrator.
- Settings: tab build-orchestrator.
- 4 console actions (MCP console_action, CLI axf console action): build-orchestrator.focus, build-orchestrator.open, build-orchestrator.start, build-orchestrator.tab.
- 24 API routes under /api/plugins/build-orchestrator.
- 20 plugin commands callable from the CLI, MCP and voice: priority-list, priority-get, headless-runs, priority-set, origin, origin-set, origin-addendum, pipeline-status, pipeline-selfcheck, pipeline-tab and 10 more.
- Provides 3 services other plugins can look up: orchestrator@1, axf.build-dispatch@1, console-focus@1.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 4 actions (build-orchestrator.focus, build-orchestrator.open, build-orchestrator.start and 1 more), 24 API routes, 20 commands (CLI, MCP, voice).
- Stops working: Systems check banner (systems-check): action build-orchestrator.open.
- Loses a feature: Console commands (console-commands): console-focus@1 (undeclared).
- Loses a feature: Feature assistant (feature-assist): axf.build-dispatch@1 (undeclared).
- Loses a feature: Push banner (push-banner): axf.build-dispatch@1 (undeclared).
- Loses a feature: Systems check banner (systems-check): axf.build-dispatch@1 (undeclared).
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Agent cap (agent-slots): axf.agent-slots@1 (optional).
- Systems check banner (systems-check): axf.health@1 (undeclared).
- Push banner (push-banner): axf.merge-queue@1 (optional).
- Plan Studio (plan-studio): plans@1 (optional).
- UI Review (ui-review): ui-review@1 (optional).

**Used by**
- Console commands (console-commands): console-focus@1 (undeclared).
- Feature assistant (feature-assist): axf.build-dispatch@1 (undeclared).
- Push banner (push-banner): axf.build-dispatch@1 (undeclared).
- Systems check banner (systems-check): axf.build-dispatch@1 (undeclared), action build-orchestrator.open.

### build-profiles

**What it does**
- Pick and save the build profile the console works on.
- 1 dialog: build-profiles.
- Settings: tab build-profiles.
- 1 console action (MCP console_action, CLI axf console action): build-profiles.open.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 dialog, a Settings tab, 1 action (build-profiles.open).
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### builds-page

**What it does**
- One Builds page over the one builds store (builds@1, owned by the Build orchestrator): every build of the active build profile, with switchable views.
- 1 screen: builds.
- Settings: tab builds-page.
- 2 console actions (MCP console_action, CLI axf console action): builds.open, builds.view.
- 9 API routes under /api/plugins/builds-page.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 2 actions (builds.open, builds.view), 9 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### changes-grid

**What it does**
- One grid of every change (the Codebase changes log, read through axf.changes@1) and every feature (the plan).
- 1 screen: changes-grid.
- Settings: tab changes-grid.
- 1 console action (MCP console_action, CLI axf console action): changes-grid.open.
- 2 API routes under /api/plugins/changes-grid.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 action (changes-grid.open), 2 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- Codebase changes banner (codebase-changes): axf.changes@1 (optional).

**Used by**
- No other plugin uses it.

### chat-viewer

**What it does**
- Every session we have, stored as transcripts (session@1) in one searchable store: claude.ai text and voice chats (from the data export Brett uploads, or the hub drop folder claude.ai sessions write to when he says "sync my chats"), Claude Code sessions (~/.cl…
- 1 screen: chat-viewer.
- Settings: tab chat-viewer.
- 22 API routes under /api/plugins/chat-viewer.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 22 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### claude-accounts

**What it does**
- Claude accounts on the VPS: lists the saved logins and API keys, switches the console's account, and routes headless jobs: every subscription login is a worker (the console's account takes jobs after them), 3 build and 5 wait per account, and API-key accounts…
- 1 screen: claude-accounts.
- 1 dialog: claude-accounts.switch.
- Settings: tab claude-accounts, panel claude-accounts.routing.
- 3 console actions (MCP console_action, CLI axf console action): claude-accounts.open, claude-accounts.routing, claude-accounts.switch.
- 14 API routes under /api/plugins/claude-accounts.
- 14 plugin commands callable from the CLI, MCP and voice: list, who, use, role, signin, remove, save, routing, routing-test, routing-settings and 4 more.
- Provides 1 service other plugins can look up: axf.claude-accounts@1.

**What breaks if disabled**
- Gone from the console: 1 screen, 1 dialog, a Settings tab, 3 actions (claude-accounts.open, claude-accounts.routing, claude-accounts.switch), 14 API routes, 14 commands (CLI, MCP, voice).
- Loses a feature: AI keys (ai-keys): axf.claude-accounts@1 (optional).
- Loses a feature: Badges (claude-badge): axf.claude-accounts@1 (optional).
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Terminal (console-terminal): axf.headless@1 (required), action terminal.claude.
- Systems check banner (systems-check): axf.health@1 (undeclared).
- Agent manager (agent-manager): axf.vinny@1 (required).

**Used by**
- AI keys (ai-keys): axf.claude-accounts@1 (optional).
- Badges (claude-badge): axf.claude-accounts@1 (optional).

### claude-badge

**What it does**
- Five banner badges in one plugin.
- Settings: tab claude-badge.
- 5 API routes under /api/plugins/claude-badge.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Fills slots: app.frame.cover.

**What breaks if disabled**
- Gone from the console: a Settings tab, 5 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- AI keys (ai-keys): axf.ai-keys@1 (optional).
- Claude accounts (claude-accounts): axf.claude-accounts@1 (optional).
- Terminal (console-terminal): axf.headless@1 (optional).
- AI assistant (ai-assistant): axf.llm@1 (optional).
- Agent manager (agent-manager): axf.vinny@1 (optional).

**Used by**
- No other plugin uses it.

### claude-handoff

**What it does**
- Moves AmberX AXF to a new Claude account.
- 2 screens: claude-handoff, claude-handoff-preview.
- A banner strip in the console chrome.
- Settings: tab claude-handoff.
- 8 console actions (MCP console_action, CLI axf console action): claude-handoff.assemble, claude-handoff.files, claude-handoff.last, claude-handoff.look, claude-handoff.open, claude-handoff.preview, claude-handoff.publish, claude-handoff.session.
- 21 API routes under /api/plugins/claude-handoff.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Banner items: claude-handoff, claude-handoff.lifecycle, claude-handoff.prefs.

**What breaks if disabled**
- Gone from the console: 2 screens, a banner strip, a Settings tab, 8 actions (claude-handoff.assemble, claude-handoff.files, claude-handoff.last and 5 more), 21 API routes.
- No other plugin, banner or voice command depends on it.
- Its banner items disappear from the console chrome and from the phone.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### claude-session

**What it does**
- Every Claude session (voice and chat Amber, Claude Code, headless builds) works as a crew agent Brett assigns (agent-pick@1).
- 1 dialog: claude.picker.
- Settings: tab claude-session.
- 2 console actions (MCP console_action, CLI axf console action): claude.assign, claude.pick.
- 10 API routes under /api/plugins/claude-session.
- 3 plugin commands callable from the CLI, MCP and voice: agent, start, answer.
- Fills slots: app.frame.cover, swarm.agent.actions.

**What breaks if disabled**
- Gone from the console: 1 dialog, a Settings tab, 2 actions (claude.assign, claude.pick), 10 API routes, 3 commands (CLI, MCP, voice).
- No other plugin, banner or voice command depends on it.
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Agent cap (agent-slots): axf.agent-slots@1 (optional).
- Claude (claude-settings): axf.claude-settings@1 (undeclared).
- Agent swarm (agent-swarm): axf.crew@1 (optional).

**Used by**
- No other plugin uses it.

### claude-settings

**What it does**
- Claude settings (claude-settings@1): settings for Claude itself, kept on axHub (/projects/_shared/_data/claude/settings.json) so every Claude session (voice, chat, Claude Code, headless agents) reads the same values at its start and before acting (MCP claude_…
- 1 screen: claude-settings.
- A banner strip in the console chrome.
- Settings: tab claude-settings.
- 1 console action (MCP console_action, CLI axf console action): claude-settings.open.
- 4 API routes under /api/plugins/claude-settings.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: axf.claude-settings@1.
- Banner items: claude-no-wait, claude-settings.lifecycle.

**What breaks if disabled**
- Gone from the console: 1 screen, a banner strip, a Settings tab, 1 action (claude-settings.open), 4 API routes.
- Loses a feature: Claude sessions (claude-session): axf.claude-settings@1 (undeclared).
- Loses a feature: Notifications (notify-control): axf.claude-settings@1 (optional).
- Loses a feature: Audio Output Recorder (output-recorder): axf.claude-settings@1 (undeclared).
- Loses a feature: UI Review (ui-review): axf.claude-settings@1 (undeclared).
- Its banner items disappear from the console chrome and from the phone.

**Depends on**
- Token control (token-control): control@1 (required).

**Used by**
- Claude sessions (claude-session): axf.claude-settings@1 (undeclared).
- Notifications (notify-control): axf.claude-settings@1 (optional).
- Audio Output Recorder (output-recorder): axf.claude-settings@1 (undeclared).
- UI Review (ui-review): axf.claude-settings@1 (undeclared).

### codebase-changes ⚠ core: never disable
> Core because: used by 5 plugins.

**What it does**
- Every time Claude is asked to build, edit, remove or fix something, an entry is opened (by a Claude Code hook) with what was asked, broken into steps that Claude fills in as it works, and the result when it's done (branch, commits, files, tests, links).
- 1 screen: codebase-changes.
- A banner strip in the console chrome.
- Settings: tab codebase-changes.
- 1 console action (MCP console_action, CLI axf console action): codebase-changes.open.
- 10 API routes under /api/plugins/codebase-changes.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: axf.changes@1.
- Banner items: codebase-changes, codebase-changes.prefs.

**What breaks if disabled**
- Gone from the console: 1 screen, a banner strip, a Settings tab, 1 action (codebase-changes.open), 10 API routes.
- Loses a feature: Activity banner (activity): axf.changes@1 (optional).
- Loses a feature: Changes & features grid (changes-grid): axf.changes@1 (optional).
- Loses a feature: Feature matrix (feature-matrix): axf.changes@1 (optional).
- Loses a feature: Push banner (push-banner): axf.changes@1 (undeclared).
- Loses a feature: Systems check banner (systems-check): axf.changes@1 (undeclared).
- Its banner items disappear from the console chrome and from the phone.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- Activity banner (activity): axf.changes@1 (optional).
- Changes & features grid (changes-grid): axf.changes@1 (optional).
- Feature matrix (feature-matrix): axf.changes@1 (optional).
- Push banner (push-banner): axf.changes@1 (undeclared).
- Systems check banner (systems-check): axf.changes@1 (undeclared).

### console-commands ⚠ core: never disable
> Core because: provides framework contract console-commands@1.

**What it does**
- Tell Amber (any Claude session) to load a screen and your open console goes there: open any screen, dialog or settings tab (sub-tabs too) by id, title or a few words, run any registered action, go back or home, and list what the console has.
- Settings: tab console-commands.
- 21 API routes under /api/plugins/console-commands.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: console-commands@1.

**What breaks if disabled**
- Gone from the console: a Settings tab, 21 API routes.
- Loses a feature: Follow Amber (follow-amber): console-commands@1 (optional).
- Loses a feature: Plugin commands (plugin-commands): console-commands@1 (optional).
- Loses a feature: Reference links (ref-links): console-commands@1 (optional).
- Loses a feature: Token control (token-control): console-commands@1 (undeclared).

**Depends on**
- Build orchestrator (build-orchestrator): console-focus@1 (undeclared).

**Used by**
- Follow Amber (follow-amber): console-commands@1 (optional).
- Plugin commands (plugin-commands): console-commands@1 (optional).
- Reference links (ref-links): console-commands@1 (optional).
- Token control (token-control): console-commands@1 (undeclared).

### console-terminal ⚠ core: never disable
> Core because: hard dependents: claude-accounts.

**What it does**
- Windows-style terminal: a Windows Terminal window with its own tab strip (rename, colour, drag to reorder, duplicate, move to a new window), a command toolbar and Windows keys.
- 2 dialogs: terminal.connect, terminal.connection.
- Settings: tab terminal.
- 1 context-menu entry: *.
- 8 console actions (MCP console_action, CLI axf console action): terminal.attach, terminal.claude, terminal.jump, terminal.mirror, terminal.new, terminal.open, terminal.sessions, terminal.toolbar.
- 26 API routes under /api/plugins/console-terminal plus 2 websockets.
- 8 plugin commands callable from the CLI, MCP and voice: sessions-list, sessions-feed, sessions-note, sessions-stop, sessions-mirror, sessions-jump, new-session-get, new-session-set.
- Provides 2 services other plugins can look up: axf.headless@1, axf.session-feed@1.

**What breaks if disabled**
- Gone from the console: 2 dialogs, a Settings tab, 1 context-menu entry, 8 actions (terminal.attach, terminal.claude, terminal.jump and 5 more), 26 API routes + 2 websockets, 8 commands (CLI, MCP, voice).
- Stops working: Claude accounts (claude-accounts): axf.headless@1 (required), action terminal.claude.
- Loses a feature: Badges (claude-badge): axf.headless@1 (optional).
- Loses a feature: Crew (crew-live): axf.headless@1 (optional).
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Container access (container-access): axf.containers@1 (optional).
- Systems check banner (systems-check): axf.health@1 (undeclared).
- Agent manager (agent-manager): axf.hub-runs@1 (undeclared).

**Used by**
- Claude accounts (claude-accounts): axf.headless@1 (required), action terminal.claude.
- Badges (claude-badge): axf.headless@1 (optional).
- Crew (crew-live): axf.headless@1 (optional).

### container-access ⚠ core: never disable
> Core because: hard dependents: snapshot-manager; used by 6 plugins.

**What it does**
- The master switch for reaching other containers on the VPS.
- Settings: tab container-access.
- 13 API routes under /api/plugins/container-access.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: axf.containers@1.

**What breaks if disabled**
- Gone from the console: a Settings tab, 13 API routes.
- Stops working: Snapshot Manager (snapshot-manager): axf.containers@1 (required).
- Loses a feature: Agent manager (agent-manager): axf.containers@1 (optional).
- Loses a feature: AI assistant (ai-assistant): axf.containers@1 (optional).
- Loses a feature: Terminal (console-terminal): axf.containers@1 (optional).
- Loses a feature: Feature assistant (feature-assist): axf.containers@1 (optional).
- Loses a feature: Systems check banner (systems-check): axf.containers@1 (undeclared).

**Depends on**
- Snapshot Manager (snapshot-manager): axf.snapshots@1 (optional).

**Used by**
- Agent manager (agent-manager): axf.containers@1 (optional).
- AI assistant (ai-assistant): axf.containers@1 (optional).
- Terminal (console-terminal): axf.containers@1 (optional).
- Feature assistant (feature-assist): axf.containers@1 (optional).
- Snapshot Manager (snapshot-manager): axf.containers@1 (required).
- Systems check banner (systems-check): axf.containers@1 (undeclared).

### context-menu-designer

**What it does**
- Design context menus: create, edit, name, rename and save them, and make 'chunks' (reusable pieces of a menu, saved from any menu with Save as chunk) that you insert into menus by name; chunks can hold items, separators and other chunks.
- 1 screen: context-menu-designer.
- Settings: tab context-menu-designer.
- 3 console actions (MCP console_action, CLI axf console action): context-menu-designer.actions, context-menu-designer.filter, context-menu-designer.open.
- 3 API routes under /api/plugins/context-menu-designer.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 3 actions (context-menu-designer.actions, context-menu-designer.filter, context-menu-designer.open), 3 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### crew-live

**What it does**
- Every agent working right now, live: avatar, status (working / waiting on approval / stuck / idle), build and step in plain English, model, a timer since the job and the step started, live cost and tokens, files touched and the PR.
- 1 screen: crew.
- Settings: tab crew-live.
- 1 context-menu entry: agent.
- 8 console actions (MCP console_action, CLI axf console action): crew.agent, crew.assign, crew.chat, crew.history, crew.open, crew.session, crew.stop, crew.terminal.
- 6 API routes under /api/plugins/crew-live.
- 5 plugin commands callable from the CLI, MCP and voice: agents, agent, files, diff, stop.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 context-menu entry, 8 actions (crew.agent, crew.assign, crew.chat and 5 more), 6 API routes, 5 commands (CLI, MCP, voice).
- No other plugin, banner or voice command depends on it.
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Terminal (console-terminal): axf.headless@1 (optional).
- Agent swarm (agent-swarm): axf.swarm-roster@1 (optional).

**Used by**
- No other plugin uses it.

### demonstration-designer

**What it does**
- Pitch the product in three picks and one button.
- 1 screen: demonstration-designer.
- Settings: tab demonstration-designer.
- 9 console actions (MCP console_action, CLI axf console action): pitch.export, pitch.generate, pitch.next, pitch.open, pitch.pause, pitch.play, pitch.prev, pitch.resume, pitch.stop.
- 19 API routes under /api/plugins/demonstration-designer.
- 19 plugin commands callable from the CLI, MCP and voice: registry, demos, demo, generate, save, delete, script, script-apply, chain, walkthrough and 9 more.
- Provides 1 service other plugins can look up: demonstrations@1.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 9 actions (pitch.export, pitch.generate, pitch.next and 6 more), 19 API routes, 19 commands (CLI, MCP, voice).
- No other plugin, banner or voice command depends on it.
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Agent voice (agent-voice): axf.speech@1 (optional).

**Used by**
- No other plugin uses it.

### design-packs

**What it does**
- No folder apps/console-web/plugins/design-packs at the time of the review: already removed, not analysed.

**What breaks if disabled**
- Nothing to analyse.

**Depends on**
- Nothing to analyse.

**Used by**
- Nothing to analyse.

### fable-rebuilds

**What it does**
- Every build parked for Fable in one place: what each replaces (the Opus plugin and its uninstall command), its branch, differences report, Android before/after screenshots and rebuild-log line, plus a ready-to-paste brief for the Fable session.
- 1 screen: fable-rebuilds.
- 1 dialog: fable-rebuilds.report.
- Settings: tab fable-rebuilds.
- 3 console actions (MCP console_action, CLI axf console action): fable-rebuilds.open, fable-rebuilds.park-feature, fable-rebuilds.park-plugin.
- 3 API routes under /api/plugins/fable-rebuilds.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Emits 1 event: axf:pending-changed.
- Fills slots: pending.item, plan.feature.

**What breaks if disabled**
- Gone from the console: 1 screen, 1 dialog, a Settings tab, 3 actions (fable-rebuilds.open, fable-rebuilds.park-feature, fable-rebuilds.park-plugin), 3 API routes.
- Goes unheard: Feature assistant (feature-assist): event axf:plan-changed.

**Depends on**
- Feature assistant (feature-assist): event axf:plan-changed.

**Used by**
- No other plugin uses it.

### feature-assist

**What it does**
- Plain-English features for the Feature Planner: describe a feature in your own words, the AXF expert drafts proper plan entries (sub-features, dependencies, ports, model) and flags clashes; you edit and approve; they go to the plan and the pending list.
- 1 dialog: feature-assist.build.
- Settings: tab feature-assist.
- 1 console action (MCP console_action, CLI axf console action): feature-assist.build.
- 7 API routes under /api/plugins/feature-assist.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Emits 1 event: axf:plan-changed.
- Fills slots: plan.feature, plan.top.

**What breaks if disabled**
- Gone from the console: 1 dialog, a Settings tab, 1 action (feature-assist.build), 7 API routes.
- Loses a feature: Fable rebuilds (fable-rebuilds): event axf:plan-changed.

**Depends on**
- Agent manager (agent-manager): axf.agents@1 (optional).
- Build orchestrator (build-orchestrator): axf.build-dispatch@1 (undeclared).
- Container access (container-access): axf.containers@1 (optional).
- AI assistant (ai-assistant): axf.llm@1 (optional).
- Snapshot Manager (snapshot-manager): axf.snapshots@1 (optional).

**Used by**
- Fable rebuilds (fable-rebuilds): event axf:plan-changed.

### feature-matrix

**What it does**
- Every build gets a feature matrix (feature-matrix@1): grouped items, each with its minutes, model (Fable / Opus) and why; tick = keep, untick = skip; items can be added any time and are never deleted.
- 1 screen: feature-matrix.
- Settings: tab feature-matrix.
- 1 console action (MCP console_action, CLI axf console action): feature-matrix.open.
- 6 API routes under /api/plugins/feature-matrix.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 action (feature-matrix.open), 6 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- Codebase changes banner (codebase-changes): axf.changes@1 (optional).

**Used by**
- No other plugin uses it.

### follow-amber ⚠ core: never disable
> Core because: named by the console shell / framework: apps/console-web/server/mcp_server.py.

**What it does**
- One switch: Follow Amber.
- 1 dialog: follow-amber.approval.
- Settings: tab follow-amber.
- 2 console actions (MCP console_action, CLI axf console action): follow-amber.approvals, follow-amber.toggle.
- 6 API routes under /api/plugins/follow-amber.
- 5 plugin commands callable from the CLI, MCP and voice: state, switch, show, approval, recent.
- Provides 1 service other plugins can look up: follow-amber@1.
- Fills slots: app.frame.cover.

**What breaks if disabled**
- Gone from the console: 1 dialog, a Settings tab, 2 actions (follow-amber.approvals, follow-amber.toggle), 6 API routes, 5 commands (CLI, MCP, voice).
- Named by the console shell or framework: apps/console-web/server/mcp_server.py.
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Notifications (notify-control): axf.notify@1 (undeclared).
- Console commands (console-commands): console-commands@1 (optional).

**Used by**
- No other plugin uses it.

### github-app

**What it does**
- One-click GitHub App for the whole stack (github-app@1): Settings → Plugins → GitHub makes a private GitHub App on MossesX through GitHub's manifest flow (Create → Install on All repositories → Authorize as Brett).
- Settings: tab github-app.
- 8 API routes under /api/plugins/github-app.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: axf.github-app@1.

**What breaks if disabled**
- Gone from the console: a Settings tab, 8 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- Systems check banner (systems-check): axf.health@1 (optional).

**Used by**
- No other plugin uses it.

### glossary-index

**What it does**
- An encyclopedia of AmberX AXF and the demonstrations written from it.
- 3 screens: glossary-index, demo-designer, book-builder.
- 2 dialogs: glossary-index.book-wizard, glossary-index.add-to-book.
- Settings: tab glossary-index.
- 10 console actions (MCP console_action, CLI axf console action): book.add, book.new, book.open, demo.generate, demo.next, demo.play, demo.prev, demo.repeat, demo.replay, demo.stop.
- 20 API routes under /api/plugins/glossary-index.
- 19 plugin commands callable from the CLI, MCP and voice: stats, search, entry, changes, rebuild, demos, demo, demo-save, demo-delete, demo-generate and 9 more.
- Provides 1 service other plugins can look up: glossary@1.

**What breaks if disabled**
- Gone from the console: 3 screens, 2 dialogs, a Settings tab, 10 actions (book.add, book.new, book.open and 7 more), 20 API routes, 19 commands (CLI, MCP, voice).
- No other plugin, banner or voice command depends on it.
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### hub-sync ⚠ core: never disable
> Core because: named core by Brett in the build brief.

**What it does**
- Keeps the console's look, settings and (if picked) data on axHub, so every app and device matches: same colour theme, layout and settings on web, Android and everywhere else.
- Settings: tab hubsync.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: a Settings tab.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### main-build-status

**What it does**
- A dot on the banner, next to the clock, with the last CI result of the main branch of MossesX/AmberX-AXF (workflow “Android framework + console”): green “main ✓ 2m ago”, red “main ✗”, accent while it runs, grey when unknown.
- Settings: tab main-build-status.
- 3 console actions (MCP console_action, CLI axf console action): main-build-status.check, main-build-status.github, main-build-status.open.
- 3 API routes under /api/plugins/main-build-status.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: a Settings tab, 3 actions (main-build-status.check, main-build-status.github, main-build-status.open), 3 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### maintenance

**What it does**
- Server health and safe clean-up for the VPS (maintenance@1).
- 1 screen: maintenance.
- Settings: tab maintenance.
- 1 console action (MCP console_action, CLI axf console action): maintenance.profiles.
- 15 API routes under /api/plugins/maintenance.
- 15 plugin commands callable from the CLI, MCP and voice: status, summary, snapshot, jobs, preview, run, runs, settings, set-settings, check and 5 more.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 action (maintenance.profiles), 15 API routes, 15 commands (CLI, MCP, voice).
- No other plugin, banner or voice command depends on it.
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Systems check banner (systems-check): axf.health@1 (optional).
- AI assistant (ai-assistant): axf.llm@1 (undeclared).

**Used by**
- No other plugin uses it.

### mcp-client

**What it does**
- Connect the console to other MCP servers (Streamable HTTP) through the framework's MCP client library (ai.amberx.axf.mcp): browse their tools, resources and prompts, call tools, and keep a call log.
- 1 screen: mcp.
- Settings: tab mcp.
- 8 API routes under /api/plugins/mcp-client.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 8 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### md-studio

**What it does**
- A Markdown browser and editor for every .md file Brett works with, on the dock engine.
- 1 screen: md-studio.
- Settings: tab md-studio.
- 10 console actions (MCP console_action, CLI axf console action): md-studio.context, md-studio.edit, md-studio.notes, md-studio.open, md-studio.open-below, md-studio.open-right, md-studio.save, md-studio.show, md-studio.toggle-edit, md-studio.view.
- 8 API routes under /api/plugins/md-studio.
- 11 plugin commands callable from the CLI, MCP and voice: list-files, read-file, save-file, file-history, file-version, restore-version, context-chain, file-refs, open-file, edit-file and 1 more.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 10 actions (md-studio.context, md-studio.edit, md-studio.notes and 7 more), 8 API routes, 11 commands (CLI, MCP, voice).
- No other plugin, banner or voice command depends on it.
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Notes (notes-browser): axf.notes@1 (optional).

**Used by**
- No other plugin uses it.

### molly-guide

**What it does**
- Molly's narrated walkthroughs (walkthrough@1) in the console: ask her how to do something, or say it to AmberX, and a small floating window shows each step with Next and Previous while the console moves there, highlights it and reads the step out loud.
- Settings: tab molly-guide.
- 4 console actions (MCP console_action, CLI axf console action): molly.ask, molly.next, molly.prev, molly.replay.
- 4 API routes under /api/plugins/molly-guide.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: a Settings tab, 4 actions (molly.ask, molly.next, molly.prev and 1 more), 4 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- Agent manager (agent-manager): axf.agents@1 (undeclared), axf.vinny@1 (undeclared).

**Used by**
- No other plugin uses it.

### notes-browser

**What it does**
- Brett's saved notes in one place: handoffs, session logs, plans, install notes and saved commands, kept in the hub's shared Claude files (/projects/_shared/_claude/notes).
- 1 screen: notes.
- Settings: tab notes-browser.
- 8 API routes under /api/plugins/notes-browser.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: axf.notes@1.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 8 API routes.
- Loses a feature: MD Studio (md-studio): axf.notes@1 (optional).

**Depends on**
- No other plugin: it stands alone.

**Used by**
- MD Studio (md-studio): axf.notes@1 (optional).

### notify-control

**What it does**
- The one Notifications control panel: every notification the console, AmberX and axHub can send, in one registry that every sender checks.
- 1 screen: notify-control.
- Settings: tab notify-control.
- 1 console action (MCP console_action, CLI axf console action): notify-control.open.
- 17 API routes under /api/plugins/notify-control.
- 17 plugin commands callable from the CLI, MCP and voice: state, types, check, recent, master, app, set, quiet, test, reset and 7 more.
- Provides 1 service other plugins can look up: axf.notify@1.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 action (notify-control.open), 17 API routes, 17 commands (CLI, MCP, voice).
- Loses a feature: Activity banner (activity): axf.notify@1 (undeclared).
- Loses a feature: Follow Amber (follow-amber): axf.notify@1 (undeclared).
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Claude (claude-settings): axf.claude-settings@1 (optional).
- Agent swarm (agent-swarm): axf.crew-sections@1 (undeclared).
- Token control (token-control): control@1 (optional).

**Used by**
- Activity banner (activity): axf.notify@1 (undeclared).
- Follow Amber (follow-amber): axf.notify@1 (undeclared).

### output-recorder

**What it does**
- Records everything the phone plays while it is on (AudioPlaybackCapture; the mic only as an opt-in second track, Record my mic too, off by default), in timestamped 30-minute chunks sent to axHub; each chunk stays on the phone until axHub confirms it, queued a…
- 1 screen: output-recorder.
- Settings: tab output-recorder.
- 3 console actions (MCP console_action, CLI axf console action): output-recorder.start, output-recorder.stop, output-recorder.toggle.
- 2 API routes under /api/plugins/output-recorder.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 3 actions (output-recorder.start, output-recorder.stop, output-recorder.toggle), 2 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- Claude (claude-settings): axf.claude-settings@1 (undeclared).
- Systems check banner (systems-check): axf.health@1 (undeclared).

**Used by**
- No other plugin uses it.

### plan-studio

**What it does**
- Every plan in one place (plan@1: JSON + a Markdown body).
- 1 screen: plan-studio.
- Settings: tab plan-studio.
- 2 console actions (MCP console_action, CLI axf console action): plan-studio.capture, plan-studio.open.
- 5 API routes under /api/plugins/plan-studio.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: plans@1.
- Emits 1 event: axf:agent-voice.say.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 2 actions (plan-studio.capture, plan-studio.open), 5 API routes.
- Loses a feature: Agent voice (agent-voice): event axf:agent-voice.say.
- Loses a feature: Build orchestrator (build-orchestrator): plans@1 (optional).

**Depends on**
- AI assistant (ai-assistant): axf.llm@1 (optional).
- Agent voice (agent-voice): axf.agent-voice@1 (optional).

**Used by**
- Agent voice (agent-voice): event axf:agent-voice.say.
- Build orchestrator (build-orchestrator): plans@1 (optional).

### plugin-commands ⚠ core: never disable
> Core because: provides framework contract plugin-commands@1.

**What it does**
- Every plugin, existing and new, exposes all of its commands and reads automatically, so Claude (through axHub), the REST API and the CLI can do anything a plugin can.
- 1 screen: plugin-commands.
- Settings: tab plugin-commands.
- 1 console action (MCP console_action, CLI axf console action): plugin-commands.open.
- 7 API routes under /api/plugins/plugin-commands.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: plugin-commands@1.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 action (plugin-commands.open), 7 API routes.
- Loses a feature: Token control (token-control): plugin-commands@1 (undeclared).

**Depends on**
- Console commands (console-commands): console-commands@1 (optional).
- Token control (token-control): control@1 (optional).

**Used by**
- Token control (token-control): plugin-commands@1 (undeclared).

### plugin-manager ⚠ core: never disable
> Core because: named by the console shell / framework: apps/console-web/src/pluginLoader.tsx; named core by Brett in the build brief.

**What it does**
- Every console plugin in one place: info, health, enable / disable, logs, settings, its UI, install & uninstall, and its dependencies in detail (what it needs, who provides it, who needs it, what clashes).
- 1 screen: plugin-manager.
- 1 dialog: plugin-manager.window.
- Settings: tab plugin-manager.
- 1 context-menu entry: default/plugin-manager.
- 5 console actions (MCP console_action, CLI axf console action): plugin-manager.install, plugin-manager.layout, plugin-manager.open, plugin-manager.view, plugin-manager.window.
- 9 API routes under /api/plugins/plugin-manager.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Emits 1 event: axp-plugin-manager:select.

**What breaks if disabled**
- Gone from the console: 1 screen, 1 dialog, a Settings tab, 1 context-menu entry, 5 actions (plugin-manager.install, plugin-manager.layout, plugin-manager.open and 2 more), 9 API routes.
- Named by the console shell or framework: apps/console-web/src/pluginLoader.tsx.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### plugin-switches ⚠ core: never disable
> Core because: hard dependents: ai-assistant, basic-filter.

**What it does**
- A pop-up dialog with a simple list of every plugin and a switch to turn each one on or off.
- 1 dialog: plugin-switches.
- Settings: tab plugin-switches.
- 1 console action (MCP console_action, CLI axf console action): plugin-switches.open.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 dialog, a Settings tab, 1 action (plugin-switches.open).
- Stops working: AI assistant (ai-assistant): action plugin-switches.open.
- Stops working: Basic filter (basic-filter): action plugin-switches.open.
- Cascade: agent-voice break next.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- AI assistant (ai-assistant): action plugin-switches.open.
- Basic filter (basic-filter): action plugin-switches.open.

### plugin-update

**What it does**
- Every installed plugin with the model that built it, when it was built and its version, checked against the plugin catalog on axHub.
- 1 screen: plugin-update.
- Settings: tab plugin-update.
- 1 console action (MCP console_action, CLI axf console action): plugin-update.open.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 action (plugin-update.open).
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### plugins-menu

**What it does**
- Right-click (or long-press) anywhere → Plugins: Install… (a plugin browser over every archive location: axHub, the permanent one, needs its credentials; folders, https servers and other consoles can be added with their credentials, kept on the console server…
- 2 dialogs: plugins-menu.settings, plugins-menu.install.
- Settings: tab plugins-menu.
- 7 console actions (MCP console_action, CLI axf console action): plugins-menu.disable, plugins-menu.enable, plugins-menu.info, plugins-menu.install, plugins-menu.manage, plugins-menu.settings, plugins-menu.toggle.
- 9 API routes under /api/plugins/plugins-menu.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 2 dialogs, a Settings tab, 7 actions (plugins-menu.disable, plugins-menu.enable, plugins-menu.info and 4 more), 9 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### project-wizard

**What it does**
- Turns a GitHub repo, a VPS repo, a folder or a new AXF app into a Claude project: name and description, a home on GitHub, the VPS and/or a local git folder (existing or new), a validated project manifest and _claude/ files, and a Claude.ai project kit (instru…
- 1 screen: project-wizard.
- Settings: tab project-wizard.
- 8 API routes under /api/plugins/project-wizard.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 8 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### push-banner

**What it does**
- A banner listing every branch that isn't on main yet in AmberX-AXF and axHub (commits ahead/behind, age, last commit, its open PR and that PR's CI), with Open PR and Merge: every change reaches main only through its PR (one is opened for every branch), brough…
- A banner strip in the console chrome.
- Settings: tab push-banner.
- 2 console actions (MCP console_action, CLI axf console action): push-banner.check, push-banner.queue.
- 27 API routes under /api/plugins/push-banner.
- 10 plugin commands callable from the CLI, MCP and voice: land-list, land-blocked, land-now, land-hold, land-release, mergequeue-list, mergequeue-add, mergequeue-remove, mergequeue-move, mergequeue-settings.
- Provides 1 service other plugins can look up: axf.merge-queue@1.
- Banner items: push-banner, push-banner.prefs.

**What breaks if disabled**
- Gone from the console: a banner strip, a Settings tab, 2 actions (push-banner.check, push-banner.queue), 27 API routes, 10 commands (CLI, MCP, voice).
- Loses a feature: Build orchestrator (build-orchestrator): axf.merge-queue@1 (optional).
- Its banner items disappear from the console chrome and from the phone.
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Activity banner (activity): axf.activity@1 (optional).
- Agent manager (agent-manager): axf.agents@1 (undeclared), axf.vinny@1 (undeclared).
- Build orchestrator (build-orchestrator): axf.build-dispatch@1 (undeclared).
- Codebase changes banner (codebase-changes): axf.changes@1 (undeclared).
- Systems check banner (systems-check): axf.github@1 (undeclared), axf.health@1 (undeclared).
- UI Review (ui-review): ui-review@1 (undeclared).

**Used by**
- Build orchestrator (build-orchestrator): axf.merge-queue@1 (optional).

### ref-links

**What it does**
- Text in the banners (In progress, Ready to merge, Merged, Live, the build and status banners, Codebase changes) that mentions a real part of the app is a link: a screen, a settings tab, section or single setting, a plugin, dialog, toolbar, menu, component, bu…
- Settings: tab ref-links.
- 4 API routes under /api/plugins/ref-links.
- 4 plugin commands callable from the CLI, MCP and voice: targets, find, resolve, open.
- Provides 1 service other plugins can look up: ref-links@1.

**What breaks if disabled**
- Gone from the console: a Settings tab, 4 API routes, 4 commands (CLI, MCP, voice).
- No other plugin, banner or voice command depends on it.
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Agent manager (agent-manager): axf.agents@1 (optional).
- Console commands (console-commands): console-commands@1 (optional).
- UI Review (ui-review): ui-review@1 (optional).

**Used by**
- No other plugin uses it.

### session-checkin

**What it does**
- Every new Claude Code session opens with a short group of questions (location first, then repo, container, project, memory files read-only, model, effort with a fixed baseline cost) and is logged to a browsable session archive.
- 1 screen: sessions.
- Settings: tab session-checkin.
- 9 API routes under /api/plugins/session-checkin.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 9 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### shipped-features

**What it does**
- Every individual feature of AmberX-AXF and axHub in one sortable list, from the moment a build plans it to when it went live: status (Planned, Queued, Building, In PR, Merged, Live, Cancelled, Removed), the builds, PRs and commits behind it, Brett's verbatim…
- 1 screen: shipped-features.
- Settings: tab shipped-features.
- 3 console actions (MCP console_action, CLI axf console action): shipped-features.open, shipped-features.show, shipped-features.sync.
- 13 API routes under /api/plugins/shipped-features.
- 13 plugin commands callable from the CLI, MCP and voice: ledger, summary, feature, sync, import, export, search, manifests, manifest, manifest-put and 3 more.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 3 actions (shipped-features.open, shipped-features.show, shipped-features.sync), 13 API routes, 13 commands (CLI, MCP, voice).
- No other plugin, banner or voice command depends on it.
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### snapshot-manager

**What it does**
- Snapshots of container files, taken before every approved change and restorable in one step (restore snapshots the current state first, so an undo can be undone).
- Settings: tab snapshots.
- 1 console action (MCP console_action, CLI axf console action): snapshots.show.
- 12 API routes under /api/plugins/snapshot-manager.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: axf.snapshots@1.

**What breaks if disabled**
- Gone from the console: a Settings tab, 1 action (snapshots.show), 12 API routes.
- Loses a feature: Agent manager (agent-manager): axf.snapshots@1 (optional).
- Loses a feature: Container access (container-access): axf.snapshots@1 (optional).
- Loses a feature: Feature assistant (feature-assist): axf.snapshots@1 (optional).

**Depends on**
- Container access (container-access): axf.containers@1 (required).

**Used by**
- Agent manager (agent-manager): axf.snapshots@1 (optional).
- Container access (container-access): axf.snapshots@1 (optional).
- Feature assistant (feature-assist): axf.snapshots@1 (optional).

### systems-check ⚠ core: never disable
> Core because: used by 11 plugins.

**What it does**
- The systems check, Keys and What's new banners at the top of every view.
- 1 dialog: system-check.
- A banner strip in the console chrome.
- Settings: tab systems-check.
- 2 console actions (MCP console_action, CLI axf console action): keys-needed.open, system-check.open.
- 31 API routes under /api/plugins/systems-check.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 3 services other plugins can look up: axf.syscheck@1, axf.health@1, axf.github@1.
- Banner items: keys-needed, systems-check, whats-new.

**What breaks if disabled**
- Gone from the console: 1 dialog, a banner strip, a Settings tab, 2 actions (keys-needed.open, system-check.open), 31 API routes.
- Loses a feature: Activity banner (activity): axf.github@1 (undeclared), axf.health@1 (undeclared).
- Loses a feature: Agent cap (agent-slots): axf.health@1 (optional).
- Loses a feature: Approvals banner (approvals-banner): axf.health@1 (undeclared).
- Loses a feature: Build orchestrator (build-orchestrator): axf.health@1 (undeclared).
- Loses a feature: Claude accounts (claude-accounts): axf.health@1 (undeclared).
- Loses a feature: Terminal (console-terminal): axf.health@1 (undeclared).
- Loses a feature: GitHub (github-app): axf.health@1 (optional).
- Loses a feature: Maintenance (maintenance): axf.health@1 (optional).
- Loses a feature: Audio Output Recorder (output-recorder): axf.health@1 (undeclared).
- Loses a feature: Push banner (push-banner): axf.github@1 (undeclared), axf.health@1 (undeclared).
- Loses a feature: UI Review (ui-review): axf.health@1 (undeclared).
- Its banner items disappear from the console chrome and from the phone.

**Depends on**
- Agent manager (agent-manager): axf.agents@1 (optional), axf.vinny@1 (undeclared).
- AI keys (ai-keys): axf.ai-keys@1 (undeclared).
- Build orchestrator (build-orchestrator): axf.build-dispatch@1 (undeclared), action build-orchestrator.open.
- Codebase changes banner (codebase-changes): axf.changes@1 (undeclared).
- Container access (container-access): axf.containers@1 (undeclared).
- Agent swarm (agent-swarm): axf.crew-sections@1 (undeclared).
- AI assistant (ai-assistant): axf.llm@1 (optional).

**Used by**
- Activity banner (activity): axf.github@1 (undeclared), axf.health@1 (undeclared).
- Agent cap (agent-slots): axf.health@1 (optional).
- Approvals banner (approvals-banner): axf.health@1 (undeclared).
- Build orchestrator (build-orchestrator): axf.health@1 (undeclared).
- Claude accounts (claude-accounts): axf.health@1 (undeclared).
- Terminal (console-terminal): axf.health@1 (undeclared).
- GitHub (github-app): axf.health@1 (optional).
- Maintenance (maintenance): axf.health@1 (optional).
- Audio Output Recorder (output-recorder): axf.health@1 (undeclared).
- Push banner (push-banner): axf.github@1 (undeclared), axf.health@1 (undeclared).
- UI Review (ui-review): axf.health@1 (undeclared).

### theme-editor

**What it does**
- Edit colour and style themes token by token.
- 1 screen: theme-editor.
- Settings: tab theme-editor.
- 1 console action (MCP console_action, CLI axf console action): theme-editor.open.
- 3 API routes under /api/plugins/theme-editor.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 action (theme-editor.open), 3 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- Theme manager (theme-manager): axf.token-tree@1 (required).

**Used by**
- No other plugin uses it.

### theme-manager ⚠ core: never disable
> Core because: hard dependents: theme-editor.

**What it does**
- Roll colour, style and layout themes, or every themeable part at once.
- 1 screen: theme-manager.
- Settings: tab theme-manager.
- 1 console action (MCP console_action, CLI axf console action): theme-manager.open.
- 22 API routes under /api/plugins/theme-manager.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: axf.token-tree@1.
- Emits 1 event: axf:tm-saved.

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab, 1 action (theme-manager.open), 22 API routes.
- Stops working: Theme editor (theme-editor): axf.token-tree@1 (required).

**Depends on**
- No other plugin: it stands alone.

**Used by**
- Theme editor (theme-editor): axf.token-tree@1 (required).

### todo-manager

**What it does**
- Lists with nested groups holding notes, to-dos and tasks (subtasks, checklists, tags, due dates, custom fields per kind), shown as a tree (by lists, kind, status, priority, tag or due date) or a grid, with group actions and Markdown export.
- 1 screen: todo-manager.
- 1 dialog: todo-manager.entry.
- Settings: tab todo-manager.
- 7 console actions (MCP console_action, CLI axf console action): todo-manager.delete, todo-manager.done, todo-manager.edit, todo-manager.new, todo-manager.open, todo-manager.reload, todo-manager.subtask.
- 15 API routes under /api/plugins/todo-manager.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, 1 dialog, a Settings tab, 7 actions (todo-manager.delete, todo-manager.done, todo-manager.edit and 4 more), 15 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### token-control ⚠ core: never disable
> Core because: hard dependents: claude-settings; provides framework contract control@1.

**What it does**
- One API, MCP server and CLI for everything control@1 covers: every theme, style, layout, typography, density and sizing token (a set is an override that rides the axHub look, so every app follows), the active asset per slot, every AmberX note, to-do, task and…
- 1 screen: token-control.
- A banner strip in the console chrome.
- Settings: tab token-control.
- 21 API routes under /api/plugins/token-control.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).
- Provides 1 service other plugins can look up: control@1.

**What breaks if disabled**
- Gone from the console: 1 screen, a banner strip, a Settings tab, 21 API routes.
- Stops working: Claude (claude-settings): control@1 (required).
- Loses a feature: Notifications (notify-control): control@1 (optional).
- Loses a feature: Plugin commands (plugin-commands): control@1 (optional).
- Its banner items disappear from the console chrome and from the phone.

**Depends on**
- Console commands (console-commands): console-commands@1 (undeclared).
- Plugin commands (plugin-commands): plugin-commands@1 (undeclared).

**Used by**
- Claude (claude-settings): control@1 (required).
- Notifications (notify-control): control@1 (optional).
- Plugin commands (plugin-commands): control@1 (optional).

### ui-review

**What it does**
- Every UI a build makes comes here for Brett's approval, one section per kind (open registry: Design packs, Whole apps / programs, Screens & pages, Settings interfaces, Dialogs & popups, Menus & toolbars, Banners & cards, Other).
- 2 screens: ui-review, design-packs.
- Settings: tab ui-review.
- 3 console actions (MCP console_action, CLI axf console action): ui-review.design-packs, ui-review.open, ui-review.screenshots.
- 15 API routes under /api/plugins/ui-review.
- 15 plugin commands callable from the CLI, MCP and voice: choices-settings, choices-settings-set, choices-choose, choices-decision, choices-assets, choices-ask, choices-asks, choices-ask-read, choices-answer, predicted and 5 more.
- Provides 2 services other plugins can look up: ui-review@1, ui-screenshots@1.

**What breaks if disabled**
- Gone from the console: 2 screens, a Settings tab, 3 actions (ui-review.design-packs, ui-review.open, ui-review.screenshots), 15 API routes, 15 commands (CLI, MCP, voice).
- Loses a feature: Build orchestrator (build-orchestrator): ui-review@1 (optional).
- Loses a feature: Push banner (push-banner): ui-review@1 (undeclared).
- Loses a feature: Reference links (ref-links): ui-review@1 (optional).
- Its voice and CLI commands stop answering (AmberX, MCP, axf).

**Depends on**
- Claude (claude-settings): axf.claude-settings@1 (undeclared).
- Systems check banner (systems-check): axf.health@1 (undeclared).

**Used by**
- Build orchestrator (build-orchestrator): ui-review@1 (optional).
- Push banner (push-banner): ui-review@1 (undeclared).
- Reference links (ref-links): ui-review@1 (optional).

### voice-notes

**What it does**
- Sets up a voice-activated notes pusher and shows the notes it saved.
- 1 screen: voice-notes.
- Settings: tab voice-notes.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 screen, a Settings tab.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

### whats-shipped

**What it does**
- A What's new widget on the banner: a ticker of the newest features merged to main (and deployed), with an unread count.
- 1 dialog: whats-shipped.panel.
- Settings: tab whats-shipped.
- 4 console actions (MCP console_action, CLI axf console action): whats-new.open, whats-shipped.check, whats-shipped.open, whats-shipped.read-all.
- 3 API routes under /api/plugins/whats-shipped.
- Plugin commands are generated from its actions and settings (CLI, MCP, voice).

**What breaks if disabled**
- Gone from the console: 1 dialog, a Settings tab, 4 actions (whats-new.open, whats-shipped.check, whats-shipped.open and 1 more), 3 API routes.
- No other plugin, banner or voice command depends on it.

**Depends on**
- No other plugin: it stands alone.

**Used by**
- No other plugin uses it.

