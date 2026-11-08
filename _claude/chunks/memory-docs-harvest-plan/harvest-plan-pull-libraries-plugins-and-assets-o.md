<!-- memory-chunk@1 source=_claude/memory/docs/harvest-plan.md tokens=246 -->
# Harvest plan — pull libraries, plugins and assets out of AXF apps (Oct 20 2026)

> Build Pilot was retired Nov 3 2026 (`_claude/builds/reports/kill-patches-pilot.md`); its mentions below are history.

Brett asked (Oct 20 2026) to take every app built on AXF and contribute back to the framework. Order: the six
overlapping Fable rebuilds first (banner+widgets, plugin-manager, ai-assistant, agent-manager, lib-mcp, then Build Pilot
agents), then this harvest on Opus. PilotX, ShipX, ActiveX stay out (not AXF apps).

Decisions (Oct 20 2026):
- Shared Python server helpers go in a new package `framework/python/axf_server/` (kept apart from `axf_libs`, which
  holds kernel-registered app libraries).
- lib-hub: Opus first slice now (axHub approvals feed `GET /auth/admin/approvals.json` as defined by axHub decision #85,
  hub address rules, session state, approval/app URLs, origin-locked web view; web + Android). The full hub protocol
  contract (AXPP) stays parked for Fable.
