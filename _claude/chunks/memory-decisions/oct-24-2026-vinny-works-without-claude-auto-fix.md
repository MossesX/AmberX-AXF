<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=184 -->
## Oct 24 2026 — Vinny works without Claude; Auto fix tries Vinny first (Gizmo/Brett)

Brett: "Make the agent Vinny able to work without an active Claude connection." Vinny gets a skill holding a managed
list of VPS commands, each mapped to triggers (keywords or commands sent to him through code); when a trigger appears
anywhere in a message he receives (even inside a paragraph, in any state), he runs the mapped command on the VPS
through axHub, with no model involved. The same for GitHub: mapped git/GitHub commands he can run without Claude.
A settings dialog adds, removes, edits and manages the commands and triggers. **Every live banner's Auto fix tries
Vinny first; if Vinny fails, it falls back to Mosses, then to Claude.**
