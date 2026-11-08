<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=155 -->
## Dev Console

- **Oct 20 2026 — AXHub Android app (Opus).** Brett wants approvals to open on his phone without him hunting for links, and an app named **AXHub**, on AmberX AXF, that will grow into managing the whole hub. `apps/axhub-android`: in-app hub sign-in, foreground watcher polling the hub's approvals feed, full-screen alert per approval that opens its hub page, approve on the hub's own page; placeholders for services/jobs/audit/vault/users/projects/devices. Hub-pushed alerts (`axhub.push`) are a later upgrade over polling. Also: rule saved in shared rules to always lead with the direct approval link.
