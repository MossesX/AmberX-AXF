<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=113-119 tokens=127 -->
## Oct 22 2026 — axhub.amberxai.com's UI is the AXF app (Brett)

The live axHub site gets its UI from the AXF app `apps/axhub-web` (rebuilt with the Dev Console's and Patches' look
and layout). The hub server in `MossesX/axHub` keeps its API, sign-in wall and data; AXF stays out of the axHub
repo's code, so "axHub never depends on AXF" still holds for the server. Reusable parts of the hub's pages
(approvals, app catalog, session handling, admin lists) are harvested into AXF web libraries along the way.
