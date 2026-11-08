<!-- memory-chunk@1 source=_claude/memory/docs/axhub-pages.md lines=29-35 tokens=114 -->
## Deploy order

The new web app needs the new hub API and the new hub redirects to the new web app. Merge AmberX-AXF first (the web
app updates itself within 5 minutes; on the old hub it says the hub hasn't got its new pages yet and links the old
approvals page), then axHub (Coolify redeploy). Pending approvals are kept across the redeploy (they live in the
hub's database), and `axhub confirmations approve <id>` in the hub's terminal works throughout.
