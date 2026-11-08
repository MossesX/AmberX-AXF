<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=176 -->
## Oct 24 2026 — Vinny works without Claude; Auto fix tries Vinny first (Gizmo/Brett)

- **Push notifications come from the AmberX Android app (Oct 28 2026, Brett):** every axHub push (approvals, merge approvals, alerts, anything) is delivered by AmberX (`apps/amberx-droid`), replacing the AXHub app. Shared rule added. Built Oct 28 (`claude/amberx-push`): AmberX's watcher (on by default) alerts on hub approvals and on the Dev Console's errors/warnings (`GET console.amberxai.com/api/alerts`, tap opens the console in the browser); Patches and the AXHub app stay quiet while AmberX (`ai.amberx.droid`) is installed — Brett okayed that small AXHub app change despite the Android hold (card, Oct 28).
