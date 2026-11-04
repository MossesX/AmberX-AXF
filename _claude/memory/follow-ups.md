
## Nov 3 2026 - queued after the feature freeze (CI green + merge everything first)
- **Detach button on every settings interface** (Brett, voice: "I want to be able to detach settings interfaces."): pop any open settings page/pane/dialog out into its own floating, resizable window on the spot, and dock it back. Do right after `plugin-settings-placement` lands (it adds the floating-window placement this builds on).
- **Detach anything in the main area** (Brett, voice: "Yeah, I want to be able to detach anything in the main area."): every page/screen/plugin view open in main gets a Detach button (and context-menu 'Detach' + drag the tab/title out) that pops it into its own floating, resizable window, with 'Dock back'. Fold in pending item `plugin-floatable` (plugin@1 `floatable` field, ~55 min / ~$15) and make detach the framework default for every page, existing and future. Same build as the settings-interface detach above.
- **Main area tab group** (Brett, voice: "Give the main viewing area a tab group, and when you right click the tab group, you can open its settings and you can place it wherever you want, top, left, right, bottom. So you can have multiple things persistent in the main area."): the main area holds multiple open pages as persistent tabs (they stay alive when you switch); right-click the tab group = its settings (tab position top/left/right/bottom, look, theme, close/pin behaviour, max tabs); drag a tab out = detach to a floating window, drag a floating window onto the group = dock it as a tab. Build together with the detach items above (one 'main area' build), on the dock engine (#245) and the window host.
- **'All profiles' view on every builds table** (Brett, voice: "Put up an option to view all profiles, in every table where builds are listed."): a profile picker on every grid that lists builds (Pending, Queue, Orchestrator, Steps, Build manager, Builds page views, Build Breaker, What's New, Crew, Git status) with 'All profiles' + each profile; All shows a Profile column (chip with the profile's colour) and groups/filter by profile; remembered per table. Goes with `profile-manager` (stopped Nov 3, work on branch claude/profile-manager) when it's relaunched.
- **'Settings' in every context menu** (Brett, voice, Nov 3: "Why can't I access settings from the context menu?" -> "Yeah."): a plain 'Settings' item in every context menu across every app (framework runtime context item, pinned near the bottom, opens the settings for what was right-clicked if it has any, else main Settings), plus the plugin's own 'Settings' from plugin-settings-placement. Fold into the Menus plugin (smart-menus) if it's on main.

## Amber's sidekick chat (Brett, Nov 3 2026, voice)
Brett said (verbatim): "I need a companion assistant... a sidekick for you that allows me to chat to your partner through the console... Through AmberX, actually put the plug-in in AmberX."
- A plugin in the **AmberX app** (apps/amberx-droid): a chat with Amber's sidekick/partner. Brett talks or types there; the sidekick answers, and passes things on to Amber and the crew (queue a build, check status, open screens).
- Open questions: who the sidekick is (crew member or new name), and build now or after the freeze.

### UPDATE (same day): sidekick becomes its own app - full Claude companion
Brett said (verbatim): "Actually, replace the patches app, make it its own app, a full all-out Claude companion that is basically as full, powerful, as complete as the Claude app itself with everything, all the features, every setting, the connectors, plugins, a full Claude suite."
- Supersedes the AmberX-plugin idea above. A standalone app on amberx-axf taking the slot of the old (killed) Patches wrapper app: chat + voice, projects, memory, connectors (axHub/MCP), plugins, every setting, files, artifacts-style previews, talks to Amber and the crew.
- Reality notes for Brett: runs on the Anthropic API (pay per token, separate from his Claude subscription); a Claude-app-level suite is many builds, not one - plan it in phases (1 chat + voice + axHub connectors, 2 projects/memory/files, 3 plugins/settings/everything else).
- Open: app name (Patches? - Patches is now also the orchestrator cat), start after freeze/CI green or now.

### DECISION (same day): Claude companion = upgrade AmberX's assistant, Gizmo is the face
- Lives in the **AmberX app** (console is getting full). Not a new standalone app.
- Harvest the existing AmberX assistant code (voice, overlay, hands-free listening, command center, former agent Molly -> now Gizmo) plus the Terminal's Claude Code session code into a shared library; build the companion plugin on that. Brains stay on the VPS (Claude Code sessions), AmberX talks to them through axHub.
- Phase 1: chat + voice + history + axHub connectors, talks to Amber and the crew. Later phases: projects/memory/files, plugins, every setting. Rough phase 1: $15-30, 1-2 h. Some updates need a new APK.
- Open: launch now or after CI on main is green.

## PAUSED builds - resume later (Brett, Nov 3 2026 ~00:38 UTC Nov 4)
Paused to speed up the VPS (it was swapping with 8 builds); maxAgents set to 5. WIP committed + pushed to each branch, worktrees kept at /root/axf-builds/<name>/ with .brief.md:
- terminal-tabs-left
- git-status-board (PR #291 already up)
- molly-banners
Resume by relaunching each from its branch with its brief once slots/memory allow.
