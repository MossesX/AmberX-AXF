<!-- memory-chunk@1 source=_claude/memory/follow-ups.md tokens=186 -->
### DECISION (same day): Claude companion = upgrade AmberX's assistant, Gizmo is the face
- Lives in the **AmberX app** (console is getting full). Not a new standalone app.
- Harvest the existing AmberX assistant code (voice, overlay, hands-free listening, command center, former agent Molly -> now Gizmo) plus the Terminal's Claude Code session code into a shared library; build the companion plugin on that. Brains stay on the VPS (Claude Code sessions), AmberX talks to them through axHub.
- Phase 1: chat + voice + history + axHub connectors, talks to Amber and the crew. Later phases: projects/memory/files, plugins, every setting. Rough phase 1: $15-30, 1-2 h. Some updates need a new APK.
- Open: launch now or after CI on main is green.
