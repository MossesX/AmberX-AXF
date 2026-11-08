<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=72-73 tokens=125 -->
## Oct 20 2026 — App catalog on axHub (app-catalog@1)

- **Oct 21 2026 — axHub settings/look: reads and emergency path (Brett).** Any signed-in hub account may read the shared appearance/settings document (writes stay admins + `data.write`). Turning the console's wall off (`AXF_WALL=off bash deploy/install-console.sh`) also turns the hub look source off, so the console runs on local settings while the hub is repaired; `AXF_WALL=on` brings both back; an explicit `AXF_APPEARANCE_HUB` always wins.
